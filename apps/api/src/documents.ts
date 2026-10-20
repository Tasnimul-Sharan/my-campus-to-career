import {
  BadRequestException, Body, CanActivate, ConflictException, Controller, Delete, ExecutionContext, ForbiddenException, Get, HttpException, HttpStatus, Injectable, Logger,
  NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, ServiceUnavailableException, UploadedFile,
  UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { DocumentCategory, Prisma, StudentDocument, User } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { config } from './config';
import { Database } from './database';
import { DocumentStorage, DocumentStorageError, MAX_PDF_BYTES, validatePdfBuffer } from './document-storage';
import { StudentListDto } from './dto';
import { AdminGuard, SessionGuard, StudentGuard } from './security';
import { AuthenticatedRequest } from './session-types';

export const DOCUMENT_LIMITS = Object.freeze({ maxBytes: MAX_PDF_BYTES, maxDocuments: 10 });
const UPLOAD_DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [DocumentCategory.CERTIFICATE, DocumentCategory.PROJECT];
const UPLOAD_DELETE_DELAY_MS = 2 * 60_000;
const DOWNLOAD_LIFETIME_MS = 5 * 60_000;

type DocumentRequest = AuthenticatedRequest & { documentUploadProcessing?: boolean; documentUploadRelease?: () => void };

@Injectable()
export class DocumentUploadGuard implements CanActivate {
  private activeUploads = 0;
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<DocumentRequest>();
    if (!request.currentUser.emailVerifiedAt) throw new ForbiddenException('Verify your email address before uploading documents.');
    if (this.activeUploads >= 2) throw new HttpException('Two document uploads are in progress. Please try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
    this.activeUploads++;
    let released = false;
    const release = () => { if (!released) { released = true; this.activeUploads--; } };
    request.documentUploadRelease = release;
    const response = context.switchToHttp().getResponse();
    response.once('finish', release);
    // Keep the slot while PDF parsing or a provider call continues after a browser disconnect.
    response.once('close', () => { if (!request.documentUploadProcessing) release(); });
    return true;
  }
}

export class UploadDocumentDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(150) title!: string;
  @IsIn(UPLOAD_DOCUMENT_CATEGORIES) category!: DocumentCategory;
}

export interface DocumentUpload {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

function serialize(document: StudentDocument) {
  return {
    id: document.id, title: document.title, category: document.category, originalFilename: document.originalFilename,
    sizeBytes: document.sizeBytes, status: document.status, createdAt: document.createdAt, updatedAt: document.updatedAt,
  };
}

function originalFilename(value: string) {
  const name = value.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (!name || name.length > 255 || !/\.pdf$/i.test(name)) throw new BadRequestException('Choose a PDF file with a filename of at most 255 characters.');
  return name;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly storage = config.documents ? new DocumentStorage(config.documents) : undefined;

  constructor(private readonly db: Database) {}

  private configuredStorage() {
    if (!this.storage) throw new ServiceUnavailableException('Document storage is not available yet. Please try again later.');
    return this.storage;
  }

  private verifiedStudent(user: Pick<User, 'role' | 'status' | 'emailVerifiedAt'>) {
    if (user.role !== 'STUDENT' || user.status !== 'ACTIVE') throw new ForbiddenException('An active student account is required.');
    if (!user.emailVerifiedAt) throw new ForbiddenException('Verify your email address before uploading documents.');
  }

  async list(userId: string) {
    const documents = await this.db.studentDocument.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
    return { documents: documents.map(serialize), limits: DOCUMENT_LIMITS, available: !!this.storage };
  }

  async adminList(query: StudentListDto) {
    const page = query.page || 1, pageSize = 15;
    const where: Prisma.StudentDocumentWhereInput = query.search ? { OR: [
      { title: { contains: query.search, mode: 'insensitive' } },
      { originalFilename: { contains: query.search, mode: 'insensitive' } },
      { user: { name: { contains: query.search, mode: 'insensitive' } } },
      { user: { email: { contains: query.search, mode: 'insensitive' } } },
    ] } : {};
    const [documents, total] = await this.db.$transaction([
      this.db.studentDocument.findMany({ where, include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.db.studentDocument.count({ where }),
    ]);
    return { documents: documents.map(document => ({ ...serialize(document), user: document.user })),
      total, page, pageSize, limits: DOCUMENT_LIMITS, available: !!this.storage };
  }

  async upload(user: User, dto: UploadDocumentDto, file?: DocumentUpload) {
    this.verifiedStudent(user);
    if (!UPLOAD_DOCUMENT_CATEGORIES.includes(dto.category)) throw new BadRequestException('Only certificates and project PDFs can be uploaded.');
    const storage = this.configuredStorage();
    if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) throw new BadRequestException('Choose a PDF file to upload.');
    if (file.size !== file.buffer.length || file.buffer.length > MAX_PDF_BYTES) throw new BadRequestException('Each PDF must be no larger than 4 MB.');
    const filename = originalFilename(file.originalname);
    if (file.mimetype && !['application/pdf', 'application/octet-stream'].includes(file.mimetype)) throw new BadRequestException('Only PDF documents are accepted.');
    try { await validatePdfBuffer(file.buffer); }
    catch (error) {
      if (error instanceof DocumentStorageError && ['FILE_TOO_LARGE', 'INVALID_PDF'].includes(error.code)) {
        throw new BadRequestException(error.message);
      }
      throw new BadRequestException('This PDF could not be read. Choose a valid, unencrypted PDF.');
    }

    const id = randomUUID();
    const publicId = `student-documents/${user.id}/${id}.pdf`;
    // Lock the owning user before counting reservations. Concurrent requests cannot exceed the quota.
    // The network upload happens after this short transaction, so no database lock waits on Cloudinary.
    const reservation = await this.db.$transaction(async tx => {
      const owners = await tx.$queryRaw<Pick<User, 'id' | 'role' | 'status' | 'emailVerifiedAt'>[]>`
        SELECT "id", "role", "status", "emailVerifiedAt" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      if (!owners[0]) throw new ForbiddenException('An active student account is required.');
      this.verifiedStudent(owners[0]);
      const count = await tx.studentDocument.count({ where: { userId: user.id } });
      if (count >= DOCUMENT_LIMITS.maxDocuments) throw new ConflictException('You can keep up to 10 documents. Delete a document before uploading another.');
      return tx.studentDocument.create({ data: { id, userId: user.id, title: dto.title, category: dto.category,
        originalFilename: filename, cloudinaryPublicId: publicId, sizeBytes: file.buffer.length, status: 'UPLOADING' } });
    });

    try {
      const uploaded = await storage.upload({ publicId, buffer: file.buffer });
      if (uploaded.publicId !== publicId || uploaded.bytes !== file.buffer.length || uploaded.resourceType !== 'raw' || uploaded.deliveryType !== 'authenticated') {
        throw new DocumentStorageError('UPLOAD_OUTCOME_UNKNOWN', 'The document upload could not be confirmed.');
      }
      const document = await this.db.studentDocument.update({ where: { id: reservation.id, status: 'UPLOADING' }, data: { status: 'READY' } });
      return { document: serialize(document), message: 'Your document has been uploaded.' };
    } catch (error) {
      const uncertainUpload = error instanceof DocumentStorageError && error.code === 'UPLOAD_OUTCOME_UNKNOWN';
      this.logger.error(error instanceof DocumentStorageError
        ? `Document upload did not complete. ${error.code}: ${error.message}`
        : 'Document upload did not complete. The reserved asset is being cleaned up.');
      // A timeout can occur after Cloudinary stores a file. Always destroy the minted ID, even without an upload response.
      let removed = false;
      try { await storage.destroy(publicId); removed = true; }
      catch { this.logger.error('Document upload cleanup could not reach storage. The document remains available for deletion retry.'); }
      try {
        if (removed && !uncertainUpload) await this.db.studentDocument.deleteMany({ where: { id: reservation.id } });
        else await this.db.studentDocument.updateMany({ where: { id: reservation.id }, data: { status: 'DELETING' } });
      } catch { this.logger.error('Document upload cleanup could not update its reservation. Refresh the document list and retry deletion.'); }
      throw new ServiceUnavailableException(uncertainUpload
        ? 'The upload outcome could not be confirmed. Wait two minutes, then delete the pending document before uploading again.'
        : error instanceof DocumentStorageError && ['STORAGE_AUTH_REJECTED', 'STORAGE_PERMISSION_DENIED'].includes(error.code)
          ? 'Document storage is not accepting uploads yet. Please contact the administrator.'
        : 'The PDF upload could not be completed. Refresh your documents before trying again.');
    }
  }

  private async accessible(id: string, user: User) {
    const document = await this.db.studentDocument.findFirst({ where: { id, ...(user.role === 'ADMIN' ? {} : { userId: user.id }) } });
    if (!document) throw new NotFoundException('Document not found.');
    return document;
  }

  async download(id: string, user: User) {
    const document = await this.accessible(id, user);
    if (document.status !== 'READY') throw new ConflictException('This document is not ready to download.');
    const expiresAt = new Date(Date.now() + DOWNLOAD_LIFETIME_MS);
    try {
      const url = this.configuredStorage().createDownloadUrl(document.cloudinaryPublicId, document.originalFilename, Math.floor(expiresAt.getTime() / 1000));
      return { url, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error('Document download link could not be created.');
      throw new ServiceUnavailableException('The document download is temporarily unavailable. Please try again.');
    }
  }

  async delete(id: string, user: User) {
    const document = await this.db.studentDocument.findFirst({ where: { id, userId: user.id } });
    if (!document) throw new NotFoundException('Document not found.');
    if (document.status !== 'READY' && Date.now() - document.createdAt.getTime() < UPLOAD_DELETE_DELAY_MS) {
      throw new ConflictException('This document may still be uploading or awaiting cleanup. Wait two minutes before retrying deletion.');
    }
    const storage = this.configuredStorage();
    await this.db.studentDocument.updateMany({ where: { id, userId: user.id }, data: { status: 'DELETING' } });
    try { await storage.destroy(document.cloudinaryPublicId); }
    catch {
      this.logger.error('Document deletion could not reach storage. The student can retry deletion.');
      throw new ServiceUnavailableException('The document could not be deleted from storage. Please try deleting it again.');
    }
    await this.db.studentDocument.deleteMany({ where: { id, userId: user.id } });
    return { message: 'Your document has been deleted.' };
  }
}

@Controller('documents')
@UseGuards(SessionGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}
  @Get() @UseGuards(StudentGuard)
  list(@Req() req: AuthenticatedRequest) { return this.documents.list(req.currentUser.id); }

  @Post() @UseGuards(StudentGuard, DocumentUploadGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 2, fieldSize: 1024, parts: 4 } }))
  upload(@Req() req: DocumentRequest, @Body() dto: UploadDocumentDto, @UploadedFile() file?: DocumentUpload) {
    req.documentUploadProcessing = true;
    return this.documents.upload(req.currentUser, dto, file).finally(() => {
      req.documentUploadProcessing = false;
      req.documentUploadRelease?.();
    });
  }

  @Get(':id/download')
  download(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) { return this.documents.download(id, req.currentUser); }

  @Delete(':id') @UseGuards(StudentGuard)
  delete(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) { return this.documents.delete(id, req.currentUser); }
}

@Controller('admin/documents')
@UseGuards(SessionGuard, AdminGuard)
export class AdminDocumentsController {
  constructor(private readonly documents: DocumentsService) {}
  @Get() list(@Query() query: StudentListDto) { return this.documents.adminList(query); }
}
