import {
  BadRequestException, CanActivate, ConflictException, Controller, Delete, ExecutionContext, ForbiddenException,
  Get, HttpException, HttpStatus, Injectable, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res,
  ServiceUnavailableException, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Prisma, ProfilePictureAsset, User } from '@prisma/client';
import { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from './config';
import { Database } from './database';
import { MAX_PROFILE_PICTURE_BYTES, normalizeProfilePicture, ProfilePictureStorage } from './profile-picture-storage';
import { SessionGuard, StudentGuard } from './security';
import { AuthenticatedRequest, publicUser } from './session-types';

const CLEANUP_DELAY_MS = 2 * 60_000;
type PictureRequest = AuthenticatedRequest & { pictureUploadProcessing?: boolean; pictureUploadRelease?: () => void };
export interface ProfilePictureUpload { buffer: Buffer; size: number; mimetype: string; }

function storageCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

@Injectable()
export class ProfilePictureUploadGuard implements CanActivate {
  private activeUploads = 0;
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<PictureRequest>();
    if (!request.currentUser.emailVerifiedAt) throw new ForbiddenException('Verify your email address before uploading a profile picture.');
    if (this.activeUploads >= 2) throw new HttpException('Two profile picture uploads are in progress. Please try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
    this.activeUploads++;
    let released = false;
    const release = () => { if (!released) { released = true; this.activeUploads--; } };
    request.pictureUploadRelease = release;
    const response = context.switchToHttp().getResponse();
    response.once('finish', release);
    response.once('close', () => { if (!request.pictureUploadProcessing) release(); });
    return true;
  }
}

@Injectable()
export class ProfilePicturesService {
  private readonly logger = new Logger(ProfilePicturesService.name);
  private readonly storage = config.documents ? new ProfilePictureStorage(config.documents) : undefined;
  constructor(private readonly db: Database) {}

  private configuredStorage() {
    if (!this.storage) throw new ServiceUnavailableException('Profile picture storage is not available yet. Please try again later.');
    return this.storage;
  }

  private student(user: Pick<User, 'role' | 'status' | 'emailVerifiedAt'>, verified = false) {
    if (user.role !== 'STUDENT' || user.status !== 'ACTIVE') throw new ForbiddenException('An active student account is required.');
    if (verified && !user.emailVerifiedAt) throw new ForbiddenException('Verify your email address before uploading a profile picture.');
  }

  private async owner(tx: Prisma.TransactionClient, userId: string) {
    const owners = await tx.$queryRaw<User[]>`SELECT * FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
    if (!owners[0]) throw new ForbiddenException('An active student account is required.');
    return owners[0];
  }

  private async removeRetired(asset: ProfilePictureAsset) {
    try {
      await this.configuredStorage().destroy(asset.cloudinaryPublicId);
      await this.db.profilePictureAsset.deleteMany({ where: { id: asset.id, userId: asset.userId, status: 'DELETING' } });
      return true;
    } catch {
      this.logger.error('Retired profile picture cleanup did not complete. Its private asset reservation is retained for retry.');
      return false;
    }
  }

  private async cleanupStale(userId: string) {
    const retired = await this.db.$transaction(async tx => {
      const user = await this.owner(tx, userId);
      // An abandoned upload must first lose UPLOADING status while holding the same user lock used to publish it.
      const assets = await tx.profilePictureAsset.findMany({ where: { userId,
        ...(user.profilePictureId ? { id: { not: user.profilePictureId } } : {}),
        status: { in: ['UPLOADING', 'DELETING'] }, updatedAt: { lte: new Date(Date.now() - CLEANUP_DELAY_MS) } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 3 });
      for (const asset of assets) await tx.profilePictureAsset.updateMany({ where: { id: asset.id, userId }, data: { status: 'DELETING' } });
      return assets.map(asset => ({ ...asset, status: 'DELETING' as const }));
    });
    // Storage requests never hold a PostgreSQL transaction or its user lock open.
    for (const asset of retired) await this.removeRetired(asset);
  }

  async upload(user: User, file?: ProfilePictureUpload) {
    this.student(user, true);
    const storage = this.configuredStorage();
    if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) throw new BadRequestException('Choose a JPG, PNG or WebP profile picture.');
    if (file.size !== file.buffer.length || file.buffer.length > MAX_PROFILE_PICTURE_BYTES) throw new BadRequestException('Your profile picture must be no larger than 2 MB.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw new BadRequestException('Choose a JPG, PNG or WebP profile picture.');
    await this.cleanupStale(user.id);
    const id = randomUUID();
    const publicId = `profile-pictures/${user.id}/${id}`;
    const reservation = await this.db.$transaction(async tx => {
      const current = await this.owner(tx, user.id);
      this.student(current, true);
      const pending = await tx.profilePictureAsset.count({ where: { userId: user.id,
        ...(current.profilePictureId ? { id: { not: current.profilePictureId } } : {}) } });
      if (pending) throw new ConflictException('A profile picture upload or cleanup is still pending. Wait two minutes and try again.');
      return tx.profilePictureAsset.create({ data: { id, userId: user.id, cloudinaryPublicId: publicId, status: 'UPLOADING' } });
    });

    let uploadStarted = false;
    try {
      let normalized: Buffer;
      try { normalized = await normalizeProfilePicture(file.buffer, file.mimetype); }
      catch (error) {
        if (['INVALID_IMAGE', 'FILE_TOO_LARGE'].includes(storageCode(error) || '')) {
          throw new BadRequestException('This image could not be read. Choose a valid JPG, PNG or WebP image no larger than 2 MB.');
        }
        throw error;
      }
      uploadStarted = true;
      await storage.upload({ publicId, buffer: normalized });
      const published = await this.db.$transaction(async tx => {
        const current = await this.owner(tx, user.id);
        this.student(current, true);
        const asset = await tx.profilePictureAsset.findFirst({ where: { id, userId: user.id, status: 'UPLOADING' } });
        if (!asset) throw new ConflictException('This profile picture upload is no longer active. Please try again.');
        await tx.profilePictureAsset.update({ where: { id, status: 'UPLOADING' }, data: { status: 'READY' } });
        const updated = await tx.user.update({ where: { id: user.id }, data: { profilePictureId: id } });
        let previous: ProfilePictureAsset | null = null;
        if (current.profilePictureId && current.profilePictureId !== id) {
          previous = await tx.profilePictureAsset.findFirst({ where: { id: current.profilePictureId, userId: user.id } });
          if (previous) await tx.profilePictureAsset.updateMany({ where: { id: previous.id, userId: user.id }, data: { status: 'DELETING' } });
        }
        return { user: updated, previous: previous ? { ...previous, status: 'DELETING' as const } : null };
      });
      const cleaned = !published.previous || await this.removeRetired(published.previous);
      return { user: publicUser(published.user), message: cleaned ? 'Your profile picture has been updated.'
        : 'Your profile picture has been updated. Cleanup of the previous picture is pending and will be retried.' };
    } catch (error) {
      // A transaction response can fail after committing. Confirm that this ID is not current before destroying it.
      let current: User | undefined;
      try {
        current = await this.db.$transaction(async tx => {
          const candidate = await this.owner(tx, user.id);
          if (candidate.profilePictureId !== id) await tx.profilePictureAsset.updateMany({ where: { id, userId: user.id }, data: { status: 'DELETING' } });
          return candidate;
        });
      } catch { this.logger.error('Profile picture upload state could not be confirmed. Its private asset reservation is retained for retry.'); }
      if (current?.profilePictureId === id) return { user: publicUser(current), message: 'Your profile picture has been updated.' };
      const uncertain = uploadStarted && storageCode(error) === 'UPLOAD_OUTCOME_UNKNOWN';
      if (current) {
        let removed = !uploadStarted;
        if (uploadStarted) { try { await storage.destroy(publicId); removed = true; } catch { /* Keep the durable reservation for a later cleanup retry. */ } }
        if (removed && !uncertain) {
          try { await this.db.profilePictureAsset.deleteMany({ where: { id: reservation.id, userId: user.id, status: 'DELETING' } }); }
          catch { this.logger.error('Profile picture upload cleanup could not remove its reservation. It is retained for retry.'); }
        }
      }
      if (error instanceof BadRequestException) throw error;
      this.logger.error('Profile picture upload did not complete. Any unresolved private asset remains reserved for cleanup.');
      throw new ServiceUnavailableException(uncertain
        ? 'The upload outcome could not be confirmed. Wait two minutes before trying again.'
        : ['STORAGE_AUTH_REJECTED', 'STORAGE_PERMISSION_DENIED'].includes(storageCode(error) || '')
          ? 'Profile picture storage is not accepting uploads yet. Please contact the administrator.'
          : 'Your profile picture could not be uploaded. Refresh your profile before trying again.');
    }
  }

  async delete(user: User) {
    this.student(user);
    this.configuredStorage();
    await this.cleanupStale(user.id);
    const removed = await this.db.$transaction(async tx => {
      const current = await this.owner(tx, user.id);
      this.student(current);
      const active = await tx.profilePictureAsset.count({ where: { userId: user.id, status: 'UPLOADING' } });
      if (active) throw new ConflictException('Your profile picture is still uploading. Please try removing it after the upload finishes.');
      const asset = current.profilePictureId
        ? await tx.profilePictureAsset.findFirst({ where: { id: current.profilePictureId, userId: user.id } }) : null;
      const updated = await tx.user.update({ where: { id: user.id }, data: { profilePictureId: null } });
      if (asset) await tx.profilePictureAsset.updateMany({ where: { id: asset.id, userId: user.id }, data: { status: 'DELETING' } });
      return { user: updated, asset: asset ? { ...asset, status: 'DELETING' as const } : null };
    });
    const cleaned = !removed.asset || await this.removeRetired(removed.asset);
    return { user: publicUser(removed.user), message: cleaned ? 'Your profile picture has been removed.'
      : 'Your profile picture has been removed. Storage cleanup is pending and will be retried.' };
  }

  async download(userId: string, viewer: User) {
    if (viewer.role !== 'ADMIN' && viewer.id !== userId) throw new NotFoundException('Profile picture not found.');
    const owner = await this.db.user.findUnique({ where: { id: userId } });
    if (!owner || !owner.profilePictureId) throw new NotFoundException('Profile picture not found.');
    const asset = await this.db.profilePictureAsset.findFirst({ where: { id: owner.profilePictureId, userId, status: 'READY' } });
    if (!asset) throw new NotFoundException('Profile picture not found.');
    try { return await this.configuredStorage().download(asset.cloudinaryPublicId); }
    catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error('Private profile picture could not be retrieved from storage.');
      throw new ServiceUnavailableException('This profile picture is temporarily unavailable. Please try again.');
    }
  }
}

@Controller('profile/picture')
@UseGuards(SessionGuard)
export class ProfilePicturesController {
  constructor(private readonly pictures: ProfilePicturesService) {}

  @Post() @UseGuards(StudentGuard, ProfilePictureUploadGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PROFILE_PICTURE_BYTES, files: 1, fields: 0, parts: 2 } }))
  upload(@Req() request: PictureRequest, @UploadedFile() file?: ProfilePictureUpload) {
    request.pictureUploadProcessing = true;
    return this.pictures.upload(request.currentUser, file).finally(() => {
      request.pictureUploadProcessing = false;
      request.pictureUploadRelease?.();
    });
  }

  @Delete() @UseGuards(StudentGuard)
  delete(@Req() request: AuthenticatedRequest) { return this.pictures.delete(request.currentUser); }

  @Get(':userId')
  async download(@Param('userId', ParseUUIDPipe) userId: string, @Req() request: AuthenticatedRequest, @Res() response: Response) {
    const picture = await this.pictures.download(userId, request.currentUser);
    response.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(picture.length), 'Content-Disposition': 'inline; filename="profile-picture.webp"' });
    response.send(picture);
  }
}
