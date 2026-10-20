import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const workers = require('node:worker_threads');
const { ProfilePictureStorage, ProfilePictureStorageError, normalizeProfilePicture, MAX_PROFILE_PICTURE_BYTES } = require('../dist/profile-picture-storage.js');
// Invented credentials and synthetic pixels only. No database or provider traffic.
const settings = { cloudName: 'campus-picture-test', apiKey: '123456789012345', apiSecret: 'isolated-picture-secret-only' };
const publicId = 'profile-pictures/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';
const endpoint = `https://api.cloudinary.com/v1_1/${settings.cloudName}/image`;
const providerSecret = 'private-provider-response-and-url';
const storage = () => new ProfilePictureStorage(settings);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const signature = fields => createHash('sha256').update(Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('&') + settings.apiSecret).digest('hex');
const validUpload = () => ({ public_id: publicId, resource_type: 'image', type: 'authenticated', format: 'webp', width: 512, height: 512, bytes: webp.length });
let png, jpeg, originalWebp, webp;
test.before(async () => {
  const pixels = { create: { width: 720, height: 480, channels: 3, background: '#135d72' } };
  png = await sharp(pixels).png().toBuffer();
  jpeg = await sharp(pixels).jpeg().toBuffer();
  originalWebp = await sharp(pixels).webp().toBuffer();
  webp = await normalizeProfilePicture(png, 'image/png');
});
test.beforeEach(t => t.mock.method(globalThis, 'fetch', () => assert.fail('Picture storage tests must never contact a provider.')));

function safeError(code) {
  return error => {
    assert.ok(error instanceof ProfilePictureStorageError);
    if (code) assert.equal(error.code, code);
    const details = `${error.message} ${error.stack} ${JSON.stringify(error)}`;
    for (const value of [settings.apiKey, settings.apiSecret, publicId, providerSecret, 'api.cloudinary.com']) assert.ok(!details.includes(value));
    assert.equal(error.cause, undefined);
    return true;
  };
}

test('enforces the 2 MiB input contract', () => assert.equal(MAX_PROFILE_PICTURE_BYTES, 2097152));
for (const [name, getBytes, mime] of [['PNG', () => png, 'image/png'], ['JPEG', () => jpeg, 'image/jpeg'], ['WebP', () => originalWebp, 'image/webp']]) {
  test(`normalizes real ${name} pixels into a 512 square metadata-free WebP`, async () => {
    const result = await normalizeProfilePicture(getBytes(), mime);
    const metadata = await sharp(result).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    assert.ok(result.length <= 1048576);
    for (const key of ['exif', 'icc', 'iptc', 'xmp']) assert.equal(metadata[key], undefined);
    assert.equal((metadata.pages ?? 1), 1);
  });
}
test('applies EXIF rotation before the square crop and strips identifying metadata', async () => {
  const left = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const right = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#0000ff' } }).png().toBuffer();
  const input = await sharp({ create: { width: 200, height: 50, channels: 3, background: '#ffffff' } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 100, top: 0 }])
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await normalizeProfilePicture(input, 'image/jpeg');
  const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
  const top = (128 * info.width + 256) * info.channels;
  const bottom = (384 * info.width + 256) * info.channels;
  assert.ok(data[top] > data[top + 2]);
  assert.ok(data[bottom + 2] > data[bottom]);
  assert.equal((await sharp(result).metadata()).exif, undefined);
});
for (const [name, bytes, mime, code] of [
  ['empty bytes', Buffer.alloc(0), undefined, 'INVALID_IMAGE'],
  ['non-buffer', new Uint8Array([1, 2]), undefined, 'INVALID_IMAGE'],
  ['oversized image', Buffer.alloc(2097153), 'image/png', 'FILE_TOO_LARGE'],
  ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml', 'INVALID_IMAGE'],
  ['GIF', Buffer.from('GIF89a synthetic fixture'), 'image/gif', 'INVALID_IMAGE'],
  ['fake JPEG', Buffer.from([255, 216, 255, 1, 2]), 'image/jpeg', 'INVALID_IMAGE'],
  ['spoofed WebP header', Buffer.from('RIFF\x04\x00\x00\x00WEBP'), 'image/webp', 'INVALID_IMAGE'],
]) test(`rejects ${name}`, async () => assert.rejects(normalizeProfilePicture(bytes, mime), safeError(code)));
test('rejects a MIME/decoded format mismatch', async () => assert.rejects(normalizeProfilePicture(png, 'image/jpeg'), safeError('INVALID_IMAGE')));
test('allows omitted MIME but still checks magic and real decoding', async () => assert.equal((await sharp(await normalizeProfilePicture(png)).metadata()).format, 'webp'));
test('rejects a compressed still image above 12 megapixels', async () => {
  const bytes = await sharp({ create: { width: 4000, height: 3001, channels: 3, background: '#1f2222' } }).png().toBuffer();
  assert.ok(bytes.length < 2097152);
  await assert.rejects(normalizeProfilePicture(bytes, 'image/png'), safeError('INVALID_IMAGE'));
});
test('rejects a PNG declaring APNG animation even if the decoder only supports its first frame', async () => {
  // A synthetic animation-control chunk is enough to prove explicit rejection.
  const chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8, 0); chunk.write('acTL', 4); chunk.writeUInt32BE(2, 8);
  const animated = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
  await assert.rejects(normalizeProfilePicture(animated, 'image/png'), safeError('INVALID_IMAGE'));
});
test('rejects a real multi-frame WebP', async () => {
  const frames = [{ create: { width: 32, height: 32, channels: 3, background: '#ff0000' } }, { create: { width: 32, height: 32, channels: 3, background: '#0000ff' } }];
  const bytes = await sharp(frames, { join: { animated: true } }).webp({ loop: 0, delay: [50, 50] }).toBuffer();
  await assert.rejects(normalizeProfilePicture(bytes, 'image/webp'), safeError('INVALID_IMAGE'));
});
test('rejects truncated image data after its header', async () => assert.rejects(normalizeProfilePicture(png.subarray(0, png.length - 20), 'image/png'), safeError('INVALID_IMAGE')));
test('bounds worker memory and rejects worker crashes safely', async t => {
  let options;
  t.mock.method(workers, 'Worker', function (_code, opts) {
    options = opts;
    const worker = new EventEmitter();
    worker.terminate = async () => 0;
    queueMicrotask(() => worker.emit('error', new Error(providerSecret)));
    return worker;
  });
  await assert.rejects(normalizeProfilePicture(png), safeError('INVALID_IMAGE'));
  assert.equal(options.workerData.maxPixels, 12000000);
  assert.equal(options.resourceLimits.maxOldGenerationSizeMb, 32);
  assert.equal(options.stdout, true); assert.equal(options.stderr, true);
});
test('terminates a stalled image worker after five seconds without accepting an unfinished decode', async t => {
  let terminated = 0;
  t.mock.method(workers, 'Worker', function () {
    const worker = new EventEmitter(); worker.terminate = async () => ++terminated; return worker;
  });
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { assert.equal(delay, 5000); queueMicrotask(callback); return 1; });
  t.mock.method(globalThis, 'clearTimeout', () => undefined);
  await assert.rejects(normalizeProfilePicture(png), safeError('INVALID_IMAGE'));
  assert.equal(terminated, 1);
});

test('uploads a canonical WebP only as an authenticated non-overwriting image with a SHA256 signature', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `${endpoint}/upload`); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const form = options.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('api_key'), settings.apiKey);
    assert.equal(form.get('public_id'), publicId); assert.equal(form.get('type'), 'authenticated');
    assert.equal(form.get('overwrite'), 'false'); assert.equal(form.get('allowed_formats'), 'webp');
    assert.equal(form.get('file').type, 'image/webp');
    assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()), webp);
    const signed = Object.fromEntries([...form].filter(([key]) => !['api_key', 'signature', 'file'].includes(key)));
    assert.equal(form.get('signature'), signature(signed));
    return json(validUpload());
  });
  await storage().upload({ publicId, buffer: webp });
});
test('rejects unnormalized upload bytes before contacting the provider', async () => {
  for (const buffer of [png, originalWebp]) await assert.rejects(storage().upload({ publicId, buffer }), safeError('INVALID_IMAGE'));
});
for (const [name, override] of [['a public asset', { type: 'upload' }], ['a different key', { public_id: `${publicId}changed` }], ['a raw file', { resource_type: 'raw' }], ['a wrong format', { format: 'png' }], ['wrong dimensions', { width: 128 }], ['different byte count', { bytes: 1 }], ['an existing asset', { existing: true }]]) {
  test(`keeps the upload outcome uncertain when the provider reports ${name}`, async t => {
    t.mock.method(globalThis, 'fetch', async () => json({ ...validUpload(), ...override }));
    await assert.rejects(storage().upload({ publicId, buffer: webp }), safeError('UPLOAD_OUTCOME_UNKNOWN'));
  });
}
for (const [status, code] of [[401, 'STORAGE_AUTH_REJECTED'], [403, 'STORAGE_PERMISSION_DENIED'], [500, 'UPLOAD_OUTCOME_UNKNOWN']]) {
  test(`sanitizes provider upload HTTP ${status}`, async t => {
    t.mock.method(globalThis, 'fetch', async () => json({ error: { message: `${providerSecret} ${settings.apiSecret}` } }, status));
    await assert.rejects(storage().upload({ publicId, buffer: webp }), safeError(code));
  });
}
test('keeps network upload failure uncertain for cleanup and hides network details', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error(`${providerSecret} ${settings.apiSecret}`); });
  await assert.rejects(storage().upload({ publicId, buffer: webp }), safeError('UPLOAD_OUTCOME_UNKNOWN'));
});
test('treats malformed or oversized successful upload replies as uncertain outcomes', async t => {
  for (const body of ['not json', JSON.stringify({ padded: 'x'.repeat(32769) })]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(body));
    await assert.rejects(storage().upload({ publicId, buffer: webp }), safeError('UPLOAD_OUTCOME_UNKNOWN'));
  }
});
test('downloads private WebP bytes server-side with a signed expiry of 60 seconds', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, `${endpoint}/download`);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(parsed.searchParams.get('type'), 'authenticated');
    assert.equal(parsed.searchParams.get('format'), 'webp'); assert.equal(parsed.searchParams.get('attachment'), 'false');
    assert.equal(Number(parsed.searchParams.get('expires_at')) - Number(parsed.searchParams.get('timestamp')), 60);
    const signed = Object.fromEntries([...parsed.searchParams].filter(([key]) => !['api_key', 'signature'].includes(key)));
    assert.equal(parsed.searchParams.get('signature'), signature(signed));
    return new Response(webp, { headers: { 'content-type': 'image/webp' } });
  });
  assert.deepEqual(await storage().download(publicId), webp);
});
for (const [name, body, headers] of [['HTML', '<html>provider</html>', { 'content-type': 'text/html' }], ['empty bytes', '', { 'content-type': 'image/webp' }], ['spoofed WebP', 'not an image', { 'content-type': 'image/webp' }], ['stream over 1 MiB', Buffer.alloc(1048577), { 'content-type': 'image/webp' }], ['declared oversized length', webp, { 'content-type': 'image/webp', 'content-length': '1048577' }]]) {
  test(`does not deliver ${name} from storage`, async t => {
    t.mock.method(globalThis, 'fetch', async () => new Response(body, { headers }));
    await assert.rejects(storage().download(publicId), safeError());
  });
}
test('rejects real WebP delivery with dimensions other than the saved 512 square', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(originalWebp, { headers: { 'content-type': 'image/webp' } }));
  await assert.rejects(storage().download(publicId), safeError('STORAGE_UNAVAILABLE'));
});
test('rejects a provider redirect and strips its location from errors', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => { assert.equal(options.redirect, 'error'); throw new Error(providerSecret); });
  await assert.rejects(storage().download(publicId), safeError('STORAGE_UNAVAILABLE'));
});
for (const result of ['ok', 'not found']) test(`accepts idempotent deletion result ${result}`, async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `${endpoint}/destroy`); assert.equal(options.method, 'POST');
    const fields = options.body;
    assert.ok(fields instanceof URLSearchParams); assert.equal(fields.get('public_id'), publicId);
    assert.equal(fields.get('type'), 'authenticated'); assert.equal(fields.get('invalidate'), 'true');
    const signed = Object.fromEntries([...fields].filter(([key]) => !['api_key', 'signature'].includes(key)));
    assert.equal(fields.get('signature'), signature(signed));
    return json({ result });
  });
  await storage().destroy(publicId);
});
test('rejects an unconfirmed deletion so its cleanup key can be retained', async t => {
  t.mock.method(globalThis, 'fetch', async () => json({ result: 'pending' }));
  await assert.rejects(storage().destroy(publicId), safeError('INVALID_STORAGE_RESPONSE'));
});
test('rejects traversal, absolute URLs and keys outside the profile picture namespace for every action', async () => {
  for (const key of ['https://example.com/avatar', '../avatar', publicId + '.webp', publicId.replace('profile-pictures/', 'student-documents/'), 'profile-pictures/abc/def']) {
    await assert.rejects(storage().upload({ publicId: key, buffer: webp }), safeError('INVALID_PICTURE_KEY'));
    await assert.rejects(storage().download(key), safeError('INVALID_PICTURE_KEY'));
    await assert.rejects(storage().destroy(key), safeError('INVALID_PICTURE_KEY'));
  }
});
test('validates all storage settings before building a fixed Cloudinary endpoint', () => {
  for (const value of [undefined, {}, { ...settings, cloudName: '../escape' }, { ...settings, apiKey: 'not-numeric' }, { ...settings, apiSecret: 'short' }, { ...settings, apiSecret: 'contains\ncontrols' }]) {
    assert.throws(() => new ProfilePictureStorage(value), safeError('STORAGE_CONFIGURATION'));
  }
});

const turn = () => new Promise(resolve => setImmediate(resolve));
const pictureKey = index => publicId.slice(0, -12) + index.toString(16).padStart(12, '0');

function controlledWorkers(t, { autoComplete = false, deferTermination = false } = {}) {
  const created = [];
  let running = 0;
  let maxRunning = 0;
  t.mock.method(workers, 'Worker', function () {
    const worker = new EventEmitter();
    worker.completed = false;
    worker.terminationRequested = false;
    worker.terminated = false;
    running++; maxRunning = Math.max(maxRunning, running);
    worker.terminate = () => {
      worker.terminationRequested = true;
      if (!worker.termination) worker.termination = new Promise(resolve => { worker.resolveTermination = resolve; });
      if (!deferTermination) worker.confirmTermination();
      return worker.termination;
    };
    worker.confirmTermination = () => {
      if (!worker.terminationRequested || worker.terminated) return;
      worker.terminated = true;
      running--;
      worker.resolveTermination(0);
    };
    worker.complete = () => {
      if (worker.completed) return;
      worker.completed = true;
      worker.emit('message', { ok: true, bytes: webp });
    };
    created.push(worker);
    if (autoComplete) queueMicrotask(() => worker.complete());
    return worker;
  });
  return { created, get maxRunning() { return maxRunning; }, get running() { return running; },
    async drain(expected) {
      for (let attempt = 0; attempt < expected + 5; attempt++) {
        for (const worker of created) { worker.complete(); worker.confirmTermination(); }
        await turn();
        if (created.length >= expected && running === 0) return;
      }
      assert.fail('All admitted synthetic workers should finish.');
    } };
}

test('bounds all normalization workers to two active plus sixteen waiting jobs and rejects overflow as busy', async t => {
  const control = controlledWorkers(t);
  const start = () => normalizeProfilePicture(png).then(bytes => ({ bytes }), error => ({ error }));
  const tasks = [start(), start()];
  // A native worker from the previous decode may still be terminating. Wait for
  // the two controlled jobs to be admitted before filling their waiting queue.
  for (let attempt = 0; attempt < 40 && control.created.length < 2; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(control.created.length, 2);
  tasks.push(...Array.from({ length: 17 }, start));
  assert.equal((await tasks[18]).error.code, 'STORAGE_UNAVAILABLE');
  await control.drain(18);
  const results = await Promise.all(tasks);
  assert.equal(results.filter(result => result.bytes).length, 18);
  assert.equal(control.maxRunning, 2);
  assert.ok(safeError('STORAGE_UNAVAILABLE')(results[18].error));
});

test('does not release a worker admission slot until native worker termination is confirmed', async t => {
  const control = controlledWorkers(t, { deferTermination: true });
  const first = [normalizeProfilePicture(png), normalizeProfilePicture(png)];
  await turn();
  for (const worker of control.created) worker.complete();
  await Promise.all(first);
  const third = normalizeProfilePicture(png);
  await turn();
  assert.equal(control.created.length, 2);
  assert.equal(control.running, 2);
  control.created[0].confirmTermination();
  await turn();
  assert.equal(control.created.length, 3);
  assert.equal(control.maxRunning, 2);
  control.created[2].complete();
  await third;
  for (const worker of control.created) worker.confirmTermination();
  await turn();
  assert.equal(control.running, 0);
});

test('keeps timed-out native workers in their slots so repeated timeouts cannot accumulate decoders', async t => {
  const control = controlledWorkers(t, { deferTermination: true });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = [normalizeProfilePicture(png), normalizeProfilePicture(png)];
  const failed = Promise.all(first.map(task => assert.rejects(task, safeError('INVALID_IMAGE'))));
  await turn();
  assert.equal(control.created.length, 2);
  t.mock.timers.tick(5000);
  await failed;
  const later = normalizeProfilePicture(png);
  await turn();
  assert.equal(control.created.length, 2);
  assert.equal(control.running, 2);
  control.created[0].confirmTermination();
  await turn();
  assert.equal(control.created.length, 3);
  assert.equal(control.maxRunning, 2);
  control.created[2].complete();
  await later;
  for (const worker of control.created) worker.confirmTermination();
  await turn();
  assert.equal(control.running, 0);
});

test('expires a queued worker after five seconds with a busy error and admits later work', async t => {
  const control = controlledWorkers(t);
  const first = [normalizeProfilePicture(png), normalizeProfilePicture(png)];
  await turn();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const waiting = normalizeProfilePicture(png);
  const rejected = assert.rejects(waiting, safeError('STORAGE_UNAVAILABLE'));
  t.mock.timers.tick(5000);
  await rejected;
  assert.equal(control.created.length, 2);
  t.mock.timers.reset();
  for (const worker of control.created) worker.complete();
  await Promise.all(first);
  const later = normalizeProfilePicture(png);
  await turn();
  assert.equal(control.created.length, 3);
  control.created[2].complete();
  await later;
});

test('shares one in-flight fetch and decode for the same private asset without retaining completed buffers', async t => {
  const control = controlledWorkers(t, { autoComplete: true });
  let fetches = 0;
  let respond;
  t.mock.method(globalThis, 'fetch', () => {
    fetches++;
    return new Promise(resolve => { respond = () => resolve(new Response(webp, { headers: { 'content-type': 'image/webp' } })); });
  });
  const instance = storage();
  const tasks = Array.from({ length: 20 }, () => instance.download(publicId));
  await turn();
  assert.equal(fetches, 1);
  respond();
  const results = await Promise.all(tasks);
  for (const result of results) assert.deepEqual(result, webp);
  assert.equal(control.created.length, 1);
  const later = instance.download(publicId);
  await turn();
  assert.equal(fetches, 2);
  respond();
  await later;
});

test('includes fetch, response buffering and queued image decode in the four-download admission limit', async t => {
  const control = controlledWorkers(t);
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetches++;
    return new Response(webp, { headers: { 'content-type': 'image/webp' } });
  });
  const instance = storage();
  const tasks = Array.from({ length: 15 }, (_, index) => instance.download(pictureKey(index + 1)));
  await turn();
  assert.equal(fetches, 4);
  assert.equal(control.created.length, 2);
  await turn();
  assert.equal(fetches, 4, 'Provider responses awaiting decode must keep their download slots.');
  control.created[0].complete();
  await turn();
  assert.equal(fetches, 5, 'One completed decode should admit one waiting provider fetch.');
  await control.drain(15);
  const results = await Promise.all(tasks);
  assert.equal(results.length, 15);
  assert.equal(fetches, 15);
  assert.equal(control.maxRunning, 2);
});

test('bounds downloads across instances to four active plus thirty-two waiting operations', async t => {
  controlledWorkers(t, { autoComplete: true });
  const respond = [];
  let immediate = false;
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', () => {
    fetches++;
    const response = () => new Response(webp, { headers: { 'content-type': 'image/webp' } });
    return immediate ? Promise.resolve(response()) : new Promise(resolve => respond.push(() => resolve(response())));
  });
  const first = storage();
  const second = storage();
  const tasks = Array.from({ length: 37 }, (_, index) => (index < 34 ? first : second)
    .download(pictureKey(index + 1)).then(bytes => ({ bytes }), error => ({ error })));
  await turn();
  assert.equal(fetches, 4);
  assert.ok(safeError('STORAGE_UNAVAILABLE')((await tasks[36]).error));
  immediate = true;
  for (const complete of respond) complete();
  const results = await Promise.all(tasks);
  assert.equal(results.filter(result => result.bytes).length, 36);
  assert.equal(fetches, 36);
});

test('caps per-instance in-flight asset keys at thirty-six while still joining an existing asset', async t => {
  controlledWorkers(t, { autoComplete: true });
  const respond = [];
  let immediate = false;
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', () => {
    fetches++;
    const response = () => new Response(webp, { headers: { 'content-type': 'image/webp' } });
    return immediate ? Promise.resolve(response()) : new Promise(resolve => respond.push(() => resolve(response())));
  });
  const instance = storage();
  const tasks = Array.from({ length: 36 }, (_, index) => instance.download(pictureKey(index + 1)));
  const shared = instance.download(pictureKey(1));
  await assert.rejects(instance.download(pictureKey(37)), safeError('STORAGE_UNAVAILABLE'));
  await turn();
  assert.equal(fetches, 4);
  immediate = true;
  for (const complete of respond) complete();
  await Promise.all([...tasks, shared]);
  assert.equal(fetches, 36);
});

test('expires a waiting download after five seconds without fetching it or retaining its deduplication key', async t => {
  controlledWorkers(t, { autoComplete: true });
  const respond = [];
  let immediate = false;
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', () => {
    fetches++;
    const response = () => new Response(webp, { headers: { 'content-type': 'image/webp' } });
    return immediate ? Promise.resolve(response()) : new Promise(resolve => respond.push(() => resolve(response())));
  });
  const instance = storage();
  const first = Array.from({ length: 4 }, (_, index) => instance.download(pictureKey(index + 1)));
  await turn();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const waiting = instance.download(pictureKey(5));
  const rejected = assert.rejects(waiting, safeError('STORAGE_UNAVAILABLE'));
  t.mock.timers.tick(5000);
  await rejected;
  assert.equal(fetches, 4);
  immediate = true;
  for (const complete of respond) complete();
  await Promise.all(first);
  await instance.download(pictureKey(5));
  assert.equal(fetches, 5);
});

test('clears an in-flight failed asset so a later request can retry without leaking provider details', async t => {
  controlledWorkers(t, { autoComplete: true });
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetches++;
    if (fetches === 1) throw new Error(`${providerSecret} ${settings.apiSecret}`);
    return new Response(webp, { headers: { 'content-type': 'image/webp' } });
  });
  const instance = storage();
  const failures = await Promise.allSettled(Array.from({ length: 8 }, () => instance.download(publicId)));
  assert.equal(fetches, 1);
  for (const failure of failures) {
    assert.equal(failure.status, 'rejected');
    assert.ok(safeError('STORAGE_UNAVAILABLE')(failure.reason));
  }
  assert.deepEqual(await instance.download(publicId), webp);
  assert.equal(fetches, 2);
});
