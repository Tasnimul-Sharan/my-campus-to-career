import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';

export const MAX_PROFILE_PICTURE_BYTES = 2 * 1024 * 1024;
const MAX_STORED_BYTES = 1024 * 1024;
const MAX_INPUT_PIXELS = 12_000_000;
const API_TIMEOUT_MS = 20_000;
const KEY_PATTERN = /^profile-pictures\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type StorageSettings = { cloudName: string; apiKey: string; apiSecret: string };
type ErrorCode = 'INVALID_IMAGE' | 'FILE_TOO_LARGE' | 'INVALID_PICTURE_KEY'
  | 'STORAGE_CONFIGURATION' | 'STORAGE_UNAVAILABLE' | 'INVALID_STORAGE_RESPONSE'
  | 'UPLOAD_OUTCOME_UNKNOWN' | 'STORAGE_AUTH_REJECTED' | 'STORAGE_PERMISSION_DENIED';

// Fixed messages only: never expose provider responses, private URLs or credentials.
export class ProfilePictureStorageError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'ProfilePictureStorageError';
  }
}

function invalidImage(): ProfilePictureStorageError {
  return new ProfilePictureStorageError('INVALID_IMAGE', 'Upload a valid, still JPEG, PNG or WebP image of at most 12 megapixels.');
}

function storageBusy(): ProfilePictureStorageError {
  return new ProfilePictureStorageError('STORAGE_UNAVAILABLE', 'Profile picture storage is busy. Please try again shortly.');
}

type QueuedAdmission = { resolve: (release: () => void) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };

// Limits apply across every storage instance and both read and write requests.
// Waiting work is bounded too; a large directory must not create unlimited native
// image decoders or hold an unlimited number of provider responses in memory.
class AdmissionPool {
  private active = 0;
  private readonly waiting: QueuedAdmission[] = [];

  constructor(private readonly capacity: number, private readonly maxWaiting: number) {}

  private lease(): () => void {
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const next = this.waiting.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(this.lease());
      }
    };
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.capacity) return this.lease();
    if (this.waiting.length >= this.maxWaiting) throw storageBusy();
    return new Promise<() => void>((resolve, reject) => {
      const queued: QueuedAdmission = { resolve, reject, timer: setTimeout(() => {
        const index = this.waiting.indexOf(queued);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        reject(storageBusy());
      }, 5000) };
      this.waiting.push(queued);
    });
  }
}

const imageWorkers = new AdmissionPool(2, 16);
const pictureDownloads = new AdmissionPool(4, 32);

function imageFormat(buffer: Buffer): 'jpeg' | 'png' | 'webp' | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP' && buffer.readUInt32LE(4) === buffer.length - 8) return 'webp';
}

function animatedContainer(buffer: Buffer, format: string): boolean {
  // APNG animation is not decoded by every libvips build, so reject its control
  // chunk explicitly rather than accidentally accepting only its first frame.
  if (format === 'png') {
    let offset = 8;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      if (length > buffer.length - offset - 12) return true;
      if (buffer.toString('ascii', offset + 4, offset + 8) === 'acTL') return true;
      offset += length + 12;
    }
  } else if (format === 'webp') {
    let offset = 12;
    while (offset + 8 <= buffer.length) {
      const length = buffer.readUInt32LE(offset + 4);
      if (length > buffer.length - offset - 8) return true;
      if (['ANIM', 'ANMF'].includes(buffer.toString('ascii', offset, offset + 4))) return true;
      offset += length + 8 + (length % 2);
    }
  }
  return false;
}

// Parsing is isolated from the API event loop. Pixel, file, libvips concurrency/cache,
// JavaScript heap and wall-clock limits bound work for untrusted compressed images.
async function processImage(buffer: Buffer, expectedFormat: string, normalize: boolean): Promise<Buffer> {
  const release = await imageWorkers.acquire();
  return new Promise<Buffer>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        (async () => {
          try {
            const sharp = require(workerData.library);
            sharp.cache(false);
            sharp.concurrency(1);
            const bytes = Buffer.from(workerData.bytes);
            const options = { failOn: 'warning', limitInputPixels: workerData.maxPixels, sequentialRead: true };
            const metadata = await sharp(bytes, options).metadata();
            if (metadata.format !== workerData.format || !Number.isSafeInteger(metadata.width)
              || !Number.isSafeInteger(metadata.height) || metadata.width < 1 || metadata.height < 1
              || metadata.width * metadata.height > workerData.maxPixels || (metadata.pages ?? 1) !== 1) throw Error();
            if (!workerData.normalize) {
              if (metadata.format !== 'webp' || metadata.width !== 512 || metadata.height !== 512
                || metadata.exif || metadata.icc || metadata.iptc || metadata.xmp) throw Error();
              // Decode pixels too: metadata alone accepts truncated/corrupt payloads.
              await sharp(bytes, options).raw().toBuffer();
              parentPort.postMessage({ ok: true, bytes });
              return;
            }
            const output = await sharp(bytes, options).rotate()
              .resize(512, 512, { fit: 'cover', position: 'centre' })
              .webp({ quality: 82, effort: 4 }).toBuffer();
            if (!output.length || output.length > workerData.maxStoredBytes) throw Error();
            // Sharp strips EXIF, ICC, IPTC and XMP by default; never preserve input metadata.
            parentPort.postMessage({ ok: true, bytes: output });
          } catch { parentPort.postMessage({ ok: false }); }
        })();
      `, { eval: true, workerData: { library: require.resolve('sharp'), bytes: buffer,
        format: expectedFormat, normalize, maxPixels: MAX_INPUT_PIXELS, maxStoredBytes: MAX_STORED_BYTES },
        resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 4 },
        stdout: true, stderr: true });
    } catch { release(); reject(invalidImage()); return; }
    worker.stdout?.resume();
    worker.stderr?.resume();
    let settled = false;
    const finish = (value?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A timed-out native decoder can outlive its JavaScript promise. Keep its
      // admission slot until termination/exit is confirmed, including on errors.
      try { void worker.terminate().then(release).catch(() => undefined); }
      catch { /* Fail closed; the exit listener will release only after exit. */ }
      if (isRecord(value) && value.ok === true && value.bytes instanceof Uint8Array
        && value.bytes.byteLength > 0 && value.bytes.byteLength <= MAX_STORED_BYTES) {
        const output = Buffer.from(value.bytes);
        if (imageFormat(output) === 'webp') { resolve(output); return; }
      }
      reject(invalidImage());
    };
    const timer = setTimeout(() => finish(), 5000);
    worker.once('message', value => finish(value));
    worker.once('error', () => finish());
    worker.once('exit', () => { release(); finish(); });
  });
}

export async function normalizeProfilePicture(buffer: Buffer, mimetype?: string): Promise<Buffer> {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw invalidImage();
  if (buffer.byteLength > MAX_PROFILE_PICTURE_BYTES) {
    throw new ProfilePictureStorageError('FILE_TOO_LARGE', 'Profile pictures must be 2 MB or smaller.');
  }
  const format = imageFormat(buffer);
  if (!format || animatedContainer(buffer, format)
    || (mimetype !== undefined && mimetype !== `image/${format}`)) throw invalidImage();
  return processImage(buffer, format, true);
}

function assertKey(publicId: string): void {
  if (typeof publicId !== 'string' || !KEY_PATTERN.test(publicId)) {
    throw new ProfilePictureStorageError('INVALID_PICTURE_KEY', 'The profile picture storage key is invalid.');
  }
}

function sign(parameters: Record<string, string>, secret: string): string {
  return createHash('sha256').update(Object.keys(parameters).sort()
    .map(key => `${key}=${parameters[key]}`).join('&') + secret).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function readBytes(response: Response, limit: number): Promise<Buffer> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProfilePictureStorageError('INVALID_STORAGE_RESPONSE', 'Profile picture storage returned an invalid response.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProfilePictureStorageError('INVALID_STORAGE_RESPONSE', 'Profile picture storage returned an invalid response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error();
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch {
    throw new ProfilePictureStorageError('INVALID_STORAGE_RESPONSE', 'Profile picture storage returned an invalid response.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function rejectStatus(status: number): void {
  if (status === 401) throw new ProfilePictureStorageError('STORAGE_AUTH_REJECTED', 'Profile picture storage credentials were rejected. Contact the administrator.');
  if (status === 403) throw new ProfilePictureStorageError('STORAGE_PERMISSION_DENIED', 'Profile picture storage does not permit this operation. Contact the administrator.');
  throw new ProfilePictureStorageError('STORAGE_UNAVAILABLE', 'Profile picture storage is unavailable. Please try again later.');
}

export class ProfilePictureStorage {
  private readonly endpoint: string;
  private readonly settings: Readonly<StorageSettings>;
  private readonly downloads = new Map<string, Promise<Buffer>>();

  constructor(settings: StorageSettings) {
    if (!settings || typeof settings.cloudName !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(settings.cloudName)
      || typeof settings.apiKey !== 'string' || !/^\d{5,30}$/.test(settings.apiKey)
      || typeof settings.apiSecret !== 'string' || settings.apiSecret.length < 10
      || settings.apiSecret.length > 200 || /[\x00-\x20\x7f]/.test(settings.apiSecret)) {
      throw new ProfilePictureStorageError('STORAGE_CONFIGURATION', 'Profile picture storage configuration is invalid.');
    }
    this.settings = Object.freeze({ ...settings });
    this.endpoint = `https://api.cloudinary.com/v1_1/${settings.cloudName}/image`;
  }

  private async request(action: 'upload' | 'destroy', parameters: Record<string, string>, buffer?: Buffer): Promise<unknown> {
    const signed = { ...parameters, timestamp: String(Math.floor(Date.now() / 1000)) };
    const fields = { ...signed, api_key: this.settings.apiKey, signature: sign(signed, this.settings.apiSecret) };
    let body: FormData | URLSearchParams;
    if (buffer) {
      body = new FormData();
      for (const [key, value] of Object.entries(fields)) body.set(key, value);
      body.set('file', new Blob([new Uint8Array(buffer)], { type: 'image/webp' }), 'profile-picture.webp');
    } else body = new URLSearchParams(fields);
    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/${action}`, { method: 'POST', body,
        headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(API_TIMEOUT_MS) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        rejectStatus(response.status);
      }
      const bytes = await readBytes(response, 32_768);
      return JSON.parse(bytes.toString('utf8')) as unknown;
    } catch (error) {
      if (error instanceof ProfilePictureStorageError) throw error;
      throw new ProfilePictureStorageError('STORAGE_UNAVAILABLE', 'Profile picture storage could not be reached. Please try again later.');
    }
  }

  async upload({ publicId, buffer }: { publicId: string; buffer: Buffer }): Promise<void> {
    assertKey(publicId);
    if (!Buffer.isBuffer(buffer) || buffer.length > MAX_STORED_BYTES || imageFormat(buffer) !== 'webp'
      || animatedContainer(buffer, 'webp')) throw invalidImage();
    await processImage(buffer, 'webp', false);
    try {
      const result = await this.request('upload', { public_id: publicId, type: 'authenticated',
        overwrite: 'false', use_filename: 'false', unique_filename: 'false', allowed_formats: 'webp' }, buffer);
      if (!isRecord(result) || result.public_id !== publicId || result.resource_type !== 'image'
        || result.type !== 'authenticated' || result.format !== 'webp' || result.width !== 512 || result.height !== 512
        || result.bytes !== buffer.byteLength || result.existing === true) throw Error();
    } catch (error) {
      if (error instanceof ProfilePictureStorageError
        && (error.code === 'STORAGE_AUTH_REJECTED' || error.code === 'STORAGE_PERMISSION_DENIED')) throw error;
      // A timeout or malformed reply may follow a saved asset; keep its key for cleanup.
      throw new ProfilePictureStorageError('UPLOAD_OUTCOME_UNKNOWN', 'The picture upload could not be confirmed. Refresh your profile before trying again.');
    }
  }

  async download(publicId: string): Promise<Buffer> {
    assertKey(publicId);
    const existing = this.downloads.get(publicId);
    if (existing) return existing;
    if (this.downloads.size >= 36) throw storageBusy();
    const pending = this.downloadOnce(publicId);
    this.downloads.set(publicId, pending);
    try { return await pending; }
    finally { if (this.downloads.get(publicId) === pending) this.downloads.delete(publicId); }
  }

  private async downloadOnce(publicId: string): Promise<Buffer> {
    // Admission includes provider fetch, body buffering and image validation.
    const release = await pictureDownloads.acquire();
    try { return await this.fetchPicture(publicId); }
    finally { release(); }
  }

  private async fetchPicture(publicId: string): Promise<Buffer> {
    const timestamp = Math.floor(Date.now() / 1000);
    const signed = { public_id: publicId, type: 'authenticated', format: 'webp', attachment: 'false',
      expires_at: String(timestamp + 60), timestamp: String(timestamp) };
    const query = new URLSearchParams({ ...signed, api_key: this.settings.apiKey, signature: sign(signed, this.settings.apiSecret) });
    let bytes: Buffer;
    try {
      const response = await fetch(`${this.endpoint}/download?${query}`, { method: 'GET', redirect: 'error',
        headers: { accept: 'image/webp' }, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        rejectStatus(response.status);
      }
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/webp') {
        await response.body?.cancel().catch(() => undefined);
        throw new ProfilePictureStorageError('INVALID_STORAGE_RESPONSE', 'Profile picture storage returned an invalid response.');
      }
      bytes = await readBytes(response, MAX_STORED_BYTES);
      if (!bytes.length || imageFormat(bytes) !== 'webp' || animatedContainer(bytes, 'webp')) throw Error();
      await processImage(bytes, 'webp', false);
    } catch (error) {
      if (error instanceof ProfilePictureStorageError && error.code !== 'INVALID_IMAGE') throw error;
      throw new ProfilePictureStorageError('STORAGE_UNAVAILABLE', 'The profile picture could not be loaded. Please try again later.');
    }
    return bytes;
  }

  async destroy(publicId: string): Promise<void> {
    assertKey(publicId);
    const result = await this.request('destroy', { public_id: publicId, type: 'authenticated', invalidate: 'true' });
    if (!isRecord(result) || (result.result !== 'ok' && result.result !== 'not found')) {
      throw new ProfilePictureStorageError('INVALID_STORAGE_RESPONSE', 'Profile picture storage returned an invalid deletion response.');
    }
  }
}
