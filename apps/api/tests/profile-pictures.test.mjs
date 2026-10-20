import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

// These tests use invented credentials, in-memory state and loopback HTTP only.
Object.assign(process.env, { NODE_ENV: 'development', DATABASE_URL: 'postgresql://isolated:isolated@127.0.0.1:1/never-connect',
  SESSION_SECRET: 'isolated-profile-picture-tests-session-secret-0123456789', APP_ORIGIN: 'http://127.0.0.1:3000',
  SESSION_DRIVER: 'postgres', MAIL_MODE: 'file', DOTENV_CONFIG_PATH: fileURLToPath(new URL(`.picture-tests-no-env-${process.pid}`, import.meta.url)) });
for (const name of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[name];
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { ProfilePicturesService, ProfilePicturesController, ProfilePictureUploadGuard } = require('../dist/profile-pictures.js');
const imageStorage = require('../dist/profile-picture-storage.js');
const { Logger, Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { Database } = require('../dist/database.js');
const { SessionGuard, StudentGuard, csrfProtection } = require('../dist/security.js');
const loopbackFetch = globalThis.fetch;
const owner = { id: randomUUID(), name: 'Picture Student', email: 'picture-owner@example.test', role: 'STUDENT',
  status: 'ACTIVE', authVersion: 0, emailVerifiedAt: new Date(), profilePictureId: null };
const another = { ...owner, id: randomUUID() };
const administrator = { ...owner, id: randomUUID(), role: 'ADMIN' };
const normalized = Buffer.from('isolated-normalized-webp-output');
const input = Buffer.from('isolated-source-image');
const file = overrides => ({ buffer: input, size: input.length, mimetype: 'image/jpeg', ...overrides });
const clone = value => value == null ? value : structuredClone(value);
function asset(overrides = {}) {
  const id = randomUUID();
  return { id, userId: owner.id, cloudinaryPublicId: `profile-pictures/${owner.id}/${id}`, status: 'READY',
    createdAt: new Date(), updatedAt: new Date(), ...overrides };
}

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('not' in value && row[key] === value.not) return false;
      if ('in' in value && !value.in.includes(row[key])) return false;
      if ('lte' in value && row[key] > value.lte) return false;
      return true;
    }
    return row[key] === value;
  });
}

function database(initial = [], current = null) {
  const rows = new Map(initial.map(item => [item.id, clone(item)]));
  const users = new Map([owner, another, administrator].map(user => [user.id, clone({ ...user, ...(user.id === owner.id ? { profilePictureId: current } : {}) })]));
  const calls = [];
  let transactionQueue = Promise.resolve();
  let locked = false;
  const db = { rows, users, calls, get locked() { return locked; },
    user: {
      async findUnique({ where }) { calls.push(['user.findUnique', where]); return clone(users.get(where.id)) || null; },
      async update({ where, data }) { const row = users.get(where.id); if (!row) throw Error('Missing user'); Object.assign(row, data); calls.push(['user.update', clone(data)]); return clone(row); },
    },
    profilePictureAsset: {
      async count({ where }) { calls.push(['count', clone(where), locked]); return [...rows.values()].filter(row => matches(row, where)).length; },
      async create({ data }) { const row = { ...data, createdAt: new Date(), updatedAt: new Date() }; rows.set(row.id, row); calls.push(['create', clone(row)]); return clone(row); },
      async findMany(options) { calls.push(['findMany', clone(options)]); return [...rows.values()].filter(row => matches(row, options.where)).slice(0, options.take).map(clone); },
      async findFirst({ where }) { calls.push(['findFirst', clone(where)]); return clone([...rows.values()].find(row => matches(row, where))) || null; },
      async update({ where, data }) { const row = [...rows.values()].find(row => matches(row, where)); if (!row) throw Error('Missing asset'); Object.assign(row, data, { updatedAt: new Date() }); calls.push(['update', clone(where), clone(data)]); return clone(row); },
      async updateMany({ where, data }) { let count = 0; for (const row of rows.values()) if (matches(row, where)) { Object.assign(row, data, { updatedAt: new Date() }); count++; } calls.push(['updateMany', clone(where), clone(data)]); return { count }; },
      async deleteMany({ where }) { let count = 0; for (const row of rows.values()) if (matches(row, where)) { rows.delete(row.id); count++; } calls.push(['deleteMany', clone(where)]); return { count }; },
    },
    async $queryRaw(strings, ...values) { assert.match(strings.join('?'), /FROM "User".*FOR UPDATE/); locked = true; calls.push(['lock', values[0]]); return users.has(values[0]) ? [clone(users.get(values[0]))] : []; },
    $transaction(operation) {
      const result = transactionQueue.then(async () => {
        const previousRows = clone([...rows]), previousUsers = clone([...users]);
        try { return await operation(db); }
        catch (error) { rows.clear(); users.clear(); for (const [id, row] of previousRows) rows.set(id, row); for (const [id, user] of previousUsers) users.set(id, user); throw error; }
        finally { locked = false; }
      });
      transactionQueue = result.catch(() => undefined);
      return result;
    },
  };
  return db;
}

function setup(initial = [], current = null, overrides = {}) {
  const db = database(initial, current), storageCalls = [];
  const storage = {
    async upload(options) { assert.equal(db.locked, false); storageCalls.push(['upload', options]); },
    async download(publicId) { assert.equal(db.locked, false); storageCalls.push(['download', publicId]); return normalized; },
    async destroy(publicId) { assert.equal(db.locked, false); storageCalls.push(['destroy', publicId]); },
    ...overrides,
  };
  const service = new ProfilePicturesService(db); service.storage = storage;
  return { db, service, storage, storageCalls };
}

test.beforeEach(t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Profile picture tests cannot contact external services.'));
  t.mock.method(Logger.prototype, 'error', () => undefined);
  t.mock.method(imageStorage, 'normalizeProfilePicture', async () => normalized);
});

test('verified upload normalizes bytes, reserves an owner UUID key and exposes only the private relative URL', async () => {
  const { db, service, storageCalls } = setup();
  const result = await service.upload(owner, file());
  const [item] = db.rows.values();
  assert.equal(item.status, 'READY'); assert.equal(db.users.get(owner.id).profilePictureId, item.id);
  assert.equal(result.user.profilePictureUrl, `/api/v1/profile/picture/${owner.id}?v=${item.id}`);
  assert.equal(JSON.stringify(result).includes('cloudinaryPublicId'), false);
  assert.equal(storageCalls[0][0], 'upload'); assert.deepEqual(storageCalls[0][1].buffer, normalized);
  assert.match(storageCalls[0][1].publicId, new RegExp(`^profile-pictures/${owner.id}/[a-f0-9-]{36}$`));
  assert.ok(db.calls.filter(call => call[0] === 'count').every(call => call[2] === true));
  assert.deepEqual(imageStorage.normalizeProfilePicture.mock.calls[0].arguments, [input, 'image/jpeg']);
});

test('unverified, suspended and administrator uploads are rejected before any database or image work', async () => {
  for (const change of [{ emailVerifiedAt: null }, { status: 'SUSPENDED' }, { role: 'ADMIN' }]) {
    const { service, db, storageCalls } = setup();
    await assert.rejects(service.upload({ ...owner, ...change }, file()), error => error.getStatus() === 403);
    assert.equal(db.calls.length, 0); assert.equal(storageCalls.length, 0);
  }
  assert.equal(imageStorage.normalizeProfilePicture.mock.calls.length, 0);
});

test('missing, forged, oversized and unsupported inputs fail before reserving an asset', async () => {
  const invalid = [undefined, file({ buffer: Buffer.alloc(0), size: 0 }), file({ size: input.length + 1 }),
    file({ buffer: Buffer.alloc(imageStorage.MAX_PROFILE_PICTURE_BYTES + 1), size: imageStorage.MAX_PROFILE_PICTURE_BYTES + 1 }),
    file({ mimetype: 'image/svg+xml' }), file({ mimetype: 'text/html' })];
  for (const value of invalid) {
    const { service, db, storageCalls } = setup();
    await assert.rejects(service.upload(owner, value), error => error.getStatus() === 400);
    assert.equal(db.rows.size, 0); assert.equal(storageCalls.length, 0); assert.equal(db.calls.length, 0);
  }
});

test('an image rejected by the decoder releases its reservation without contacting Cloudinary', async t => {
  t.mock.method(imageStorage, 'normalizeProfilePicture', async () => { throw Object.assign(Error('private decoder details'), { code: 'INVALID_IMAGE' }); });
  const { service, db, storageCalls } = setup();
  await assert.rejects(service.upload(owner, file()), error => error.getStatus() === 400 && !error.message.includes('private decoder details'));
  assert.equal(db.rows.size, 0); assert.equal(storageCalls.length, 0);
});

test('busy and unexpected decoder failures return safe service errors and release reservations without Cloudinary calls', async t => {
  for (const error of [Object.assign(Error('private worker queue details'), { code: 'STORAGE_UNAVAILABLE' }), Error('private unexpected decoder details')]) {
    t.mock.method(imageStorage, 'normalizeProfilePicture', async () => { throw error; });
    const { service, db, storageCalls } = setup();
    await assert.rejects(service.upload(owner, file()), failure => failure.getStatus() === 503 && !failure.message.includes('private'));
    assert.equal(db.rows.size, 0); assert.equal(storageCalls.length, 0);
  }
});

test('unconfigured storage fails without creating a reservation', async () => {
  const { service, db } = setup(); service.storage = undefined;
  await assert.rejects(service.upload(owner, file()), error => error.getStatus() === 503);
  assert.equal(db.calls.length, 0);
});

test('the current picture remains available until the replacement is published and storage cleanup follows the swap', async () => {
  const previous = asset(); let newId;
  const { service, db, storage } = setup([previous], previous.id);
  storage.upload = async ({ publicId }) => { assert.equal(db.locked, false); newId = publicId.split('/').at(-1); assert.equal(db.users.get(owner.id).profilePictureId, previous.id); };
  storage.destroy = async publicId => {
    assert.equal(db.locked, false); assert.equal(publicId, previous.cloudinaryPublicId);
    assert.equal(db.users.get(owner.id).profilePictureId, newId); assert.equal(db.rows.get(previous.id).status, 'DELETING');
  };
  await service.upload(owner, file()); assert.equal(db.rows.size, 1); assert.equal(db.rows.has(previous.id), false);
});

test('two simultaneous requests can reserve only one pending upload for the same student', async () => {
  const { service, db, storage } = setup(); let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  storage.upload = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
  const first = service.upload(owner, file()); await started;
  await assert.rejects(service.upload(owner, file()), error => error.getStatus() === 409);
  assert.equal(db.rows.size, 1); release(); await first;
});

test('failed replacement cleanup preserves the old key and reports cleanup pending without rolling back the new picture', async () => {
  const previous = asset(); const { service, db } = setup([previous], previous.id, { async destroy() { throw Error('private provider body'); } });
  const result = await service.upload(owner, file());
  assert.match(result.message, /Cleanup.*pending/); assert.notEqual(db.users.get(owner.id).profilePictureId, previous.id);
  assert.equal(db.rows.get(previous.id).status, 'DELETING'); assert.equal(db.rows.size, 2);
  await assert.rejects(service.upload(owner, file()), error => error.getStatus() === 409);
});

test('abandoned noncurrent uploads are retired before retry and a stale current picture is never destroyed', async () => {
  const current = asset({ updatedAt: new Date(0) }); const abandoned = asset({ status: 'UPLOADING', updatedAt: new Date(0) });
  const { service, db, storageCalls } = setup([current, abandoned], current.id);
  await service.upload(owner, file());
  assert.equal(storageCalls[0][0], 'destroy'); assert.equal(storageCalls[0][1], abandoned.cloudinaryPublicId);
  assert.equal(storageCalls.filter(call => call[0] === 'destroy' && call[1] === current.cloudinaryPublicId).length, 1); // Retired only after replacement publication.
  assert.equal(db.rows.has(abandoned.id), false); assert.equal(db.rows.size, 1);
});

test('an uncertain upload retains its durable key despite immediate successful cleanup and waits before retry', async () => {
  const { service, db, storage, storageCalls } = setup([], null, { async upload() { throw Object.assign(Error('private provider URL'), { code: 'UPLOAD_OUTCOME_UNKNOWN' }); } });
  await assert.rejects(service.upload(owner, file()), error => error.getStatus() === 503 && /two minutes/.test(error.message));
  const pending = [...db.rows.values()][0]; assert.equal(pending.status, 'DELETING'); assert.equal(storageCalls[0][0], 'destroy');
  await assert.rejects(service.upload(owner, file()), error => error.getStatus() === 409);
  db.rows.get(pending.id).updatedAt = new Date(Date.now() - 121_000); storage.upload = async () => undefined;
  await service.upload(owner, file()); assert.equal(db.rows.has(pending.id), false); assert.equal(db.rows.size, 1);
});

test('failed upload cleanup preserves the durable asset key for a later retry', async () => {
  const { service, db } = setup([], null, { async upload() { throw Error('private upload body'); }, async destroy() { throw Error('private destroy body'); } });
  await assert.rejects(service.upload(owner, file()), error => error.getStatus() === 503 && !JSON.stringify(error).includes('private'));
  assert.equal(db.rows.size, 1); assert.equal([...db.rows.values()][0].status, 'DELETING'); assert.equal(db.users.get(owner.id).profilePictureId, null);
});

test('provider permission errors give safe administrator guidance and clear a confirmed failed reservation', async () => {
  for (const code of ['STORAGE_PERMISSION_DENIED', 'STORAGE_AUTH_REJECTED']) {
    const { service, db } = setup([], null, { async upload() { throw Object.assign(Error('secret API key'), { code }); } });
    await assert.rejects(service.upload(owner, file()), error => error.getStatus() === 503 && /administrator/.test(error.message) && !error.message.includes('secret'));
    assert.equal(db.rows.size, 0);
  }
});

test('a publication failure cleans up only the new asset and preserves the current picture', async () => {
  const previous = asset(); const { service, db, storageCalls } = setup([previous], previous.id);
  db.user.update = async () => { throw Error('private database body'); };
  await assert.rejects(service.upload(owner, file()), error => error.getStatus() === 503);
  assert.equal(db.users.get(owner.id).profilePictureId, previous.id); assert.equal(db.rows.size, 1);
  assert.equal(storageCalls.at(-1)[0], 'destroy'); assert.notEqual(storageCalls.at(-1)[1], previous.cloudinaryPublicId);
});

test('a lost response after the publication commit cannot destroy the newly current picture', async () => {
  const { service, db, storageCalls } = setup(); const original = db.$transaction.bind(db); let failed = false;
  db.$transaction = async operation => {
    const result = await original(operation);
    if (!failed && result?.user && 'previous' in result) { failed = true; throw Error('Response lost after commit'); }
    return result;
  };
  const result = await service.upload(owner, file());
  assert.ok(result.user.profilePictureUrl); assert.equal(db.rows.size, 1); assert.equal([...db.rows.values()][0].status, 'READY');
  assert.equal(storageCalls.filter(call => call[0] === 'destroy').length, 0);
});

test('a student suspended while storage is uploading cannot publish the new picture', async () => {
  const previous = asset(); const { service, db, storage } = setup([previous], previous.id);
  storage.upload = async () => { db.users.get(owner.id).status = 'SUSPENDED'; };
  await assert.rejects(service.upload(owner, file()), error => error.getStatus() === 503);
  assert.equal(db.users.get(owner.id).profilePictureId, previous.id); assert.equal(db.rows.size, 1);
});

test('remove clears the pointer before deleting storage and returns the updated user', async () => {
  const current = asset(); const { service, db, storage } = setup([current], current.id);
  storage.destroy = async publicId => { assert.equal(db.locked, false); assert.equal(publicId, current.cloudinaryPublicId); assert.equal(db.users.get(owner.id).profilePictureId, null); };
  const result = await service.delete(owner); assert.equal(result.user.profilePictureUrl, null); assert.equal(db.rows.size, 0);
});

test('failed storage deletion still removes the displayed picture and explicitly retains cleanup pending', async () => {
  const current = asset(); const { service, db } = setup([current], current.id, { async destroy() { throw Error('private provider response'); } });
  const result = await service.delete(owner);
  assert.equal(result.user.profilePictureUrl, null); assert.match(result.message, /Storage cleanup is pending/);
  assert.equal(db.rows.get(current.id).status, 'DELETING'); assert.equal(db.users.get(owner.id).profilePictureId, null);
});

test('remove conflicts with an active upload and cannot make an in-flight new picture reappear', async () => {
  const current = asset(), pending = asset({ status: 'UPLOADING' }); const { service, db } = setup([current, pending], current.id);
  await assert.rejects(service.delete(owner), error => error.getStatus() === 409);
  assert.equal(db.users.get(owner.id).profilePictureId, current.id);
});

test('only active students can mutate their picture, while an unverified owner may remove it', async () => {
  for (const change of [{ role: 'ADMIN' }, { status: 'SUSPENDED' }]) {
    const { service, db } = setup(); await assert.rejects(service.delete({ ...owner, ...change }), error => error.getStatus() === 403); assert.equal(db.calls.length, 0);
  }
  const { service } = setup(); assert.match((await service.delete({ ...owner, emailVerifiedAt: null })).message, /removed/);
});

test('other students cannot read a private picture and ownership is checked before any database query', async () => {
  const current = asset(); const { service, db, storageCalls } = setup([current], current.id);
  await assert.rejects(service.download(owner.id, another), error => error.getStatus() === 404);
  assert.equal(db.calls.length, 0); assert.equal(storageCalls.length, 0);
});

test('owner and administrator can retrieve only the current READY asset for that owner', async () => {
  const current = asset(); const { service, storageCalls } = setup([current], current.id);
  for (const viewer of [owner, administrator]) assert.deepEqual(await service.download(owner.id, viewer), normalized);
  assert.deepEqual(storageCalls, [['download', current.cloudinaryPublicId], ['download', current.cloudinaryPublicId]]);
  for (const invalid of [{ ...current, userId: another.id }, { ...current, status: 'UPLOADING' }, { ...current, status: 'DELETING' }]) {
    const forbidden = setup([invalid], current.id); await assert.rejects(forbidden.service.download(owner.id, owner), error => error.getStatus() === 404); assert.equal(forbidden.storageCalls.length, 0);
  }
});

test('missing pictures return not found and provider errors do not expose credentials or private URLs', async () => {
  const missing = setup(); await assert.rejects(missing.service.download(owner.id, owner), error => error.getStatus() === 404);
  const current = asset(); const { service } = setup([current], current.id, { async download() { throw Error('private secret signed URL'); } });
  await assert.rejects(service.download(owner.id, owner), error => error.getStatus() === 503 && !error.message.includes('secret'));
});

function guardRequest(user = owner) {
  const request = { currentUser: user }, response = new EventEmitter();
  return { request, response, context: { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } };
}
test('upload admission rejects unverified accounts before multipart processing and permits only two concurrent requests', () => {
  const guard = new ProfilePictureUploadGuard();
  assert.throws(() => guard.canActivate(guardRequest({ ...owner, emailVerifiedAt: null }).context), error => error.getStatus() === 403);
  const first = guardRequest(), second = guardRequest(), third = guardRequest(); guard.canActivate(first.context); guard.canActivate(second.context);
  assert.throws(() => guard.canActivate(third.context), error => error.getStatus() === 429);
  first.response.emit('finish'); first.response.emit('close'); first.request.pictureUploadRelease(); assert.equal(guard.activeUploads, 1);
  guard.canActivate(third.context); second.response.emit('close'); third.response.emit('close'); assert.equal(guard.activeUploads, 0);
});

test('disconnects retain upload admission until processing completes and all failures release their slot', async () => {
  const guard = new ProfilePictureUploadGuard(), admitted = guardRequest(); guard.canActivate(admitted.context);
  let complete; const controller = new ProfilePicturesController({ upload: () => new Promise(resolve => { complete = resolve; }) });
  const request = controller.upload(admitted.request, file()); admitted.response.emit('close'); assert.equal(guard.activeUploads, 1);
  complete({ message: 'Uploaded' }); await request; assert.equal(guard.activeUploads, 0);
  const failed = guardRequest(); guard.canActivate(failed.context);
  await assert.rejects(new ProfilePicturesController({ upload: async () => { throw Error('Failure'); } }).upload(failed.request, file()));
  assert.equal(guard.activeUploads, 0);
});

test('HTTP routes enforce CSRF, student admission, file-only multipart, size limits, UUIDs and private image headers', async t => {
  const requests = [];
  class TestModule {}
  Module({ controllers: [ProfilePicturesController], providers: [
    { provide: ProfilePicturesService, useValue: {
      async upload(user, uploaded) { requests.push({ user, file: uploaded }); return { message: 'Accepted' }; },
      async delete() { return { message: 'Removed' }; }, async download() { return normalized; },
    } },
    { provide: Database, useValue: { user: { async findUnique({ where }) { return [owner, another, administrator].find(user => user.id === where.id); } } } },
    SessionGuard, StudentGuard, ProfilePictureUploadGuard,
  ] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false, abortOnError: false });
  app.use((request, _response, next) => { request.session = { userId: request.get('x-test-user') || owner.id, authVersion: 0, csrfToken: 'isolated-csrf' }; next(); });
  app.use(csrfProtection); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const url = `http://127.0.0.1:${app.getHttpServer().address().port}/profile/picture`;
  const form = (extra, bytes = input) => { const body = new FormData(); body.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'picture.jpg'); if (extra) body.append('userId', another.id); return body; };
  const headers = { 'x-csrf-token': 'isolated-csrf' };
  assert.equal((await loopbackFetch(url, { method: 'POST', body: form() })).status, 403);
  assert.equal((await loopbackFetch(url, { method: 'DELETE' })).status, 403);
  assert.equal((await loopbackFetch(url, { method: 'POST', headers: { ...headers, 'x-test-user': administrator.id }, body: form() })).status, 403);
  assert.equal((await loopbackFetch(url, { method: 'POST', headers, body: form(true) })).status, 400);
  assert.equal((await loopbackFetch(url, { method: 'POST', headers, body: form(false, Buffer.alloc(imageStorage.MAX_PROFILE_PICTURE_BYTES + 1)) })).status, 413);
  assert.equal((await loopbackFetch(url, { method: 'POST', headers, body: form() })).status, 201);
  assert.equal(requests.length, 1); assert.equal(requests[0].user.id, owner.id); assert.deepEqual(requests[0].file.buffer, input);
  assert.equal((await loopbackFetch(`${url}/invalid`)).status, 400);
  const image = await loopbackFetch(`${url}/${owner.id}`);
  assert.equal(image.status, 200); assert.match(image.headers.get('content-type'), /^image\/webp/);
  assert.equal(image.headers.get('cache-control'), 'private, no-store'); assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), normalized);
});
