import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';

export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export const DOCUMENT_DOWNLOAD_TTL_SECONDS = 5 * 60;
const API_TIMEOUT_MS = 20_000;
const RESPONSE_LIMIT_BYTES = 32_768;
const KEY_PATTERN = /^student-documents\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/;

type StorageSettings = { cloudName: string; apiKey: string; apiSecret: string };
type StorageErrorCode = 'INVALID_PDF' | 'FILE_TOO_LARGE' | 'INVALID_DOCUMENT_KEY'
  | 'INVALID_FILENAME' | 'INVALID_DOWNLOAD_EXPIRY' | 'STORAGE_CONFIGURATION'
  | 'STORAGE_UNAVAILABLE' | 'INVALID_STORAGE_RESPONSE' | 'UPLOAD_OUTCOME_UNKNOWN'
  | 'STORAGE_AUTH_REJECTED' | 'STORAGE_PERMISSION_DENIED';

// All error messages are fixed and safe to log. Provider bodies and credentials stay private.
export class DocumentStorageError extends Error {
  constructor(readonly code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'DocumentStorageError';
  }
}

function invalidPdf(): DocumentStorageError {
  return new DocumentStorageError('INVALID_PDF', 'Upload a valid, unencrypted PDF containing at least one page.');
}

function validatePdfBoundaries(buffer: Buffer): void {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) throw invalidPdf();
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new DocumentStorageError('FILE_TOO_LARGE', 'PDF files must be 4 MB or smaller.');
  }
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(buffer.subarray(0, 12).toString('latin1'))
    || !/%%EOF[\x00\t\n\f\r ]*$/.test(buffer.subarray(-1024).toString('latin1'))) {
    throw invalidPdf();
  }
}

// Parse untrusted PDFs off the API event loop with memory and time limits. This validates
// the PDF structure; it is not a virus scan or a promise that every PDF viewer is safe.
export async function validatePdfBuffer(buffer: Buffer): Promise<void> {
  validatePdfBoundaries(buffer);
  await new Promise<void>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        (async () => {
          try {
            // pdf-lib is pinned to 1.17.1. Worker heap limits do not cover typed-array
            // buffers, so bound every decoder allocation before parsing object streams.
            // Fail closed if a dependency update changes this internal decoder hook.
            const DecodeStream = require(workerData.decoder).default;
            const ensureBuffer = DecodeStream?.prototype?.ensureBuffer;
            if (typeof ensureBuffer !== 'function') throw Error();
            let decodedAllocations = 0;
            DecodeStream.prototype.ensureBuffer = function(requested) {
              const streamLimit = 8 * 1024 * 1024;
              if (!Number.isSafeInteger(requested) || requested < 0 || requested > streamLimit) throw Error();
              if (requested > this.buffer.byteLength) {
                let size = this.minBufferLength;
                if (!Number.isSafeInteger(size) || size < 1 || size > streamLimit) throw Error();
                while (size < requested) size *= 2;
                if (size > streamLimit || decodedAllocations + size > 32 * 1024 * 1024) throw Error();
                decodedAllocations += size;
              }
              return ensureBuffer.call(this, requested);
            };
            const { PDFDocument, PDFDict, PDFArray, PDFName } = require(workerData.library);
            const doc = await PDFDocument.load(workerData.bytes, {
              ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: true,
            });
            if (doc.isEncrypted || doc.getPageCount() < 1 || doc.getPageCount() > 1000) throw Error();
            const blockedKeys = new Set(['JavaScript', 'JS', 'Launch', 'EmbeddedFiles', 'EmbeddedFile', 'EF', 'RichMedia', 'XFA', 'OpenAction', 'AA']);
            const seen = new Set();
            const visit = (object) => {
              if (!object || seen.has(object)) return;
              seen.add(object);
              if (seen.size > 100000) throw Error();
              if (object instanceof PDFDict) {
                for (const key of object.keys()) if (blockedKeys.has(key.decodeText())) throw Error();
                const action = object.get(PDFName.of('S'));
                if (action instanceof PDFName && ['JavaScript', 'Launch', 'GoToR', 'SubmitForm', 'ImportData'].includes(action.decodeText())) throw Error();
                const type = object.get(PDFName.of('Type'));
                const subtype = object.get(PDFName.of('Subtype'));
                if (type instanceof PDFName && type.decodeText() === 'EmbeddedFile') throw Error();
                if (subtype instanceof PDFName && subtype.decodeText() === 'FileAttachment') throw Error();
                for (const [, value] of object.entries()) visit(value);
              } else if (object instanceof PDFArray) {
                for (const value of object.asArray()) visit(value);
              } else if (object.dict instanceof PDFDict) visit(object.dict);
            };
            for (const [, object] of doc.context.enumerateIndirectObjects()) {
              visit(object);
            }
            parentPort.postMessage(true);
          } catch { parentPort.postMessage(false); }
        })();
      `, { eval: true, workerData: { library: require.resolve('pdf-lib'),
          decoder: require.resolve('pdf-lib/cjs/core/streams/DecodeStream.js'), bytes: buffer },
        resourceLimits: { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 8, stackSizeMb: 4 },
        stdout: true, stderr: true });
    } catch { reject(invalidPdf()); return; }
    worker.stdout?.resume();
    worker.stderr?.resume();
    let settled = false;
    const finish = (valid: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (valid) resolve(); else reject(invalidPdf());
    };
    const timer = setTimeout(() => finish(false), 5000);
    worker.once('message', value => finish(value === true));
    worker.once('error', () => finish(false));
    worker.once('exit', () => finish(false));
  });
}

function assertKey(publicId: string): void {
  if (typeof publicId !== 'string' || !KEY_PATTERN.test(publicId)) {
    throw new DocumentStorageError('INVALID_DOCUMENT_KEY', 'The document storage key is invalid.');
  }
}

function sign(parameters: Record<string, string>, secret: string): string {
  const payload = Object.keys(parameters).sort().map(key => `${key}=${parameters[key]}`).join('&');
  return createHash('sha256').update(payload + secret).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > RESPONSE_LIMIT_BYTES) return;
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch { return; }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export class DocumentStorage {
  private readonly endpoint: string;
  private readonly settings: Readonly<StorageSettings>;

  constructor(settings: StorageSettings) {
    if (!settings || typeof settings.cloudName !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(settings.cloudName)
      || typeof settings.apiKey !== 'string' || !/^\d{5,30}$/.test(settings.apiKey)
      || typeof settings.apiSecret !== 'string' || settings.apiSecret.length < 10
      || settings.apiSecret.length > 200 || /[\x00-\x20\x7f]/.test(settings.apiSecret)) {
      throw new DocumentStorageError('STORAGE_CONFIGURATION', 'Document storage configuration is invalid.');
    }
    this.settings = Object.freeze({ ...settings });
    this.endpoint = `https://api.cloudinary.com/v1_1/${settings.cloudName}/raw`;
  }

  private async request(action: 'upload' | 'destroy', parameters: Record<string, string>, file?: Buffer): Promise<unknown> {
    const signed = { ...parameters, timestamp: String(Math.floor(Date.now() / 1000)) };
    const fields = { ...signed, api_key: this.settings.apiKey, signature: sign(signed, this.settings.apiSecret) };
    let body: FormData | URLSearchParams;
    if (file) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      form.set('file', new Blob([new Uint8Array(file)], { type: 'application/pdf' }), 'document.pdf');
      body = form;
    } else body = new URLSearchParams(fields);
    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/${action}`, { method: 'POST', body,
        headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    } catch {
      throw new DocumentStorageError('STORAGE_UNAVAILABLE', 'Document storage could not be reached. Please try again later.');
    }
    const result = await readJson(response);
    if (response.status === 401) {
      throw new DocumentStorageError('STORAGE_AUTH_REJECTED', 'Document storage credentials were rejected. Contact the administrator.');
    }
    if (response.status === 403) {
      throw new DocumentStorageError('STORAGE_PERMISSION_DENIED', 'Document storage does not permit this operation. Contact the administrator.');
    }
    if (!response.ok) {
      throw new DocumentStorageError('STORAGE_UNAVAILABLE', 'Document storage rejected the request. Please try again later.');
    }
    return result;
  }

  async upload({ publicId, buffer }: { publicId: string; buffer: Buffer }): Promise<{
    publicId: string; bytes: number; resourceType: 'raw'; deliveryType: 'authenticated';
  }> {
    assertKey(publicId);
    // The service parses the file before reserving a document row. Recheck cheap
    // boundaries here without parsing the same untrusted input in a second worker.
    validatePdfBoundaries(buffer);
    try {
      const result = await this.request('upload', {
        public_id: publicId, type: 'authenticated', overwrite: 'false', use_filename: 'false',
        unique_filename: 'false', allowed_formats: 'pdf',
      }, buffer);
      if (!isRecord(result) || result.public_id !== publicId || result.resource_type !== 'raw'
        || result.type !== 'authenticated' || result.bytes !== buffer.byteLength
        || result.existing === true) throw Error();
    } catch (error) {
      if (error instanceof DocumentStorageError
        && (error.code === 'STORAGE_AUTH_REJECTED' || error.code === 'STORAGE_PERMISSION_DENIED')) throw error;
      // Once a request might have left the server, a timeout/error does not prove
      // Cloudinary failed to save it. Retain a cleanup record even if an immediate
      // destroy reports "not found": the original upload may still be completing.
      throw new DocumentStorageError('UPLOAD_OUTCOME_UNKNOWN', 'The upload could not be confirmed. Refresh your documents before trying again.');
    }
    return { publicId, bytes: buffer.byteLength, resourceType: 'raw', deliveryType: 'authenticated' };
  }

  createDownloadUrl(publicId: string, filename: string, expiresAtSeconds: number): string {
    assertKey(publicId);
    if (typeof filename !== 'string' || !filename || filename.length > 255 || !/\.pdf$/i.test(filename)
      || /[\x00-\x1f\x7f/\\]/.test(filename)) {
      throw new DocumentStorageError('INVALID_FILENAME', 'The document filename is invalid.');
    }
    const timestamp = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= timestamp
      || expiresAtSeconds > timestamp + DOCUMENT_DOWNLOAD_TTL_SECONDS) {
      throw new DocumentStorageError('INVALID_DOWNLOAD_EXPIRY', 'The document download expiry is invalid.');
    }
    // Raw asset IDs already contain their extension. Supplying format=pdf would
    // request a different key; omit format exactly as the SDK does for an empty value.
    // The private-download endpoint supports attachment=true, not a filename override.
    const signed = { public_id: publicId, type: 'authenticated', attachment: 'true',
      expires_at: String(expiresAtSeconds), timestamp: String(timestamp) };
    const parameters = new URLSearchParams({ ...signed, api_key: this.settings.apiKey,
      signature: sign(signed, this.settings.apiSecret) });
    return `${this.endpoint}/download?${parameters}`;
  }

  async destroy(publicId: string): Promise<void> {
    assertKey(publicId);
    const result = await this.request('destroy', { public_id: publicId, type: 'authenticated', invalidate: 'true' });
    if (!isRecord(result) || (result.result !== 'ok' && result.result !== 'not found')) {
      throw new DocumentStorageError('INVALID_STORAGE_RESPONSE', 'Document storage returned an invalid deletion response.');
    }
  }
}
