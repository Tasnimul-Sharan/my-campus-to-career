import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

// Only invented credentials and in-memory database/storage doubles are used here.
Object.assign(process.env, {
  NODE_ENV: 'development', DATABASE_URL: 'postgresql://isolated:isolated@127.0.0.1:1/never-connect',
  SESSION_SECRET: 'isolated-document-tests-session-secret-0123456789', APP_ORIGIN: 'http://127.0.0.1:3000',
  SESSION_DRIVER: 'postgres', MAIL_MODE: 'file',
  DOTENV_CONFIG_PATH: fileURLToPath(new URL(`.documents-tests-no-env-${process.pid}`, import.meta.url)),
});
for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[key];
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { DocumentsService, DocumentsController, DocumentUploadGuard, UploadDocumentDto, DOCUMENT_LIMITS } = require('../dist/documents.js');
const { config, loadConfig } = require('../dist/config.js');
const { DocumentStorageError } = require('../dist/document-storage.js');
const { Logger, Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { SessionGuard, StudentGuard } = require('../dist/security.js');
const { Database } = require('../dist/database.js');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { PDFDocument } = require('pdf-lib');
const loopbackFetch = globalThis.fetch;
const pdf = await PDFDocument.create(); pdf.addPage();
const validPdf = Buffer.from(await pdf.save());
const owner = { id: randomUUID(), role: 'STUDENT', status: 'ACTIVE', authVersion: 0, emailVerifiedAt: new Date(), name: 'Document Student', email: 'document-owner@example.test' };
const another = { ...owner, id: randomUUID() };
const administrator = { ...owner, id: randomUUID(), role: 'ADMIN' };
const dto = { title: 'My project report', category: 'PROJECT' };
const uploadFile = overrides => ({ buffer: validPdf, size: validPdf.length, originalname: 'Project report.pdf', mimetype: 'application/pdf', ...overrides });

function document(overrides = {}) {
  const id = randomUUID();
  return { id, userId: owner.id, title: dto.title, category: dto.category, originalFilename: 'Project report.pdf',
    cloudinaryPublicId: `student-documents/${owner.id}/${id}.pdf`, sizeBytes: validPdf.length, status: 'READY',
    createdAt: new Date(), updatedAt: new Date(), ...overrides };
}

function database(initial = []) {
  const rows = new Map(initial.map(row => [row.id, row]));
  let transactionQueue = Promise.resolve();
  let locked = false;
  const calls = [];
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return true; // Search query shape is separately checked below.
    return row[key] === value;
  });
  const db = {
    rows, calls,
    studentDocument: {
      async count({ where } = {}) { calls.push(['count', where, locked]); return [...rows.values()].filter(row => matches(row, where)).length; },
      async create({ data }) { const row = { ...data, createdAt: new Date(), updatedAt: new Date() }; rows.set(row.id, row); calls.push(['create', row]); return row; },
      async findMany(options) { calls.push(['findMany', options]); return [...rows.values()].filter(row => matches(row, options.where)).map(row => ({ ...row, ...(options.include ? { user: { id: owner.id, name: owner.name, email: owner.email } } : {}) })); },
      async findFirst({ where }) { calls.push(['findFirst', where]); return [...rows.values()].find(row => matches(row, where)) || null; },
      async update({ where, data }) { const row = [...rows.values()].find(row => matches(row, where)); if (!row) throw Error('Record not found'); Object.assign(row, data, { updatedAt: new Date() }); calls.push(['update', where, data]); return row; },
      async updateMany({ where, data }) { let count = 0; for (const row of rows.values()) if (matches(row, where)) { Object.assign(row, data, { updatedAt: new Date() }); count++; } calls.push(['updateMany', where, data]); return { count }; },
      async deleteMany({ where }) { let count = 0; for (const row of rows.values()) if (matches(row, where)) { rows.delete(row.id); count++; } calls.push(['deleteMany', where]); return { count }; },
    },
    async $queryRaw(strings, ...values) {
      assert.match(strings.join('?'), /FROM "User".*FOR UPDATE/s);
      assert.equal(values[0], owner.id);
      locked = true; calls.push(['lock', values[0]]); return [owner];
    },
    $transaction(operation) {
      if (Array.isArray(operation)) return Promise.all(operation);
      const result = transactionQueue.then(() => operation(db)).finally(() => { locked = false; });
      transactionQueue = result.catch(() => undefined);
      return result;
    },
  };
  return db;
}

function setup(initial = [], overrides = {}) {
  const db = database(initial);
  const storageCalls = [];
  const storage = {
    async upload(options) { storageCalls.push(['upload', options]); return { publicId: options.publicId, bytes: options.buffer.length, resourceType: 'raw', deliveryType: 'authenticated' }; },
    createDownloadUrl(publicId, filename, expiresAt) { storageCalls.push(['download', publicId, filename, expiresAt]); return 'https://storage.example.test/private-download'; },
    async destroy(publicId) { storageCalls.push(['destroy', publicId]); },
    ...overrides,
  };
  const service = new DocumentsService(db);
  service.storage = storage;
  return { db, service, storageCalls, storage };
}

test.beforeEach(t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Document unit tests must not contact external services.'));
  t.mock.method(Logger.prototype, 'error', () => undefined);
});

test('Cloudinary configuration is optional but validates every field when enabled', t => {
  const names = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } });
  for (const name of names) delete process.env[name];
  assert.equal(loadConfig().documents, undefined);
  const valid = { CLOUDINARY_CLOUD_NAME: 'isolated-documents', CLOUDINARY_API_KEY: '123456789012345', CLOUDINARY_API_SECRET: 'isolated-document-secret' };
  Object.assign(process.env, valid);
  assert.deepEqual(loadConfig().documents, { cloudName: valid.CLOUDINARY_CLOUD_NAME, apiKey: valid.CLOUDINARY_API_KEY, apiSecret: valid.CLOUDINARY_API_SECRET });
  for (const name of names) {
    delete process.env[name];
    assert.throws(() => loadConfig(), new RegExp(name));
    Object.assign(process.env, valid);
  }
  for (const change of [{ CLOUDINARY_CLOUD_NAME: '../wrong-host' }, { CLOUDINARY_API_KEY: 'invalid' }, { CLOUDINARY_API_SECRET: 'short' }, { CLOUDINARY_API_SECRET: 'private\nsecret-value' }]) {
    Object.assign(process.env, valid, change);
    assert.throws(() => loadConfig(), /Invalid Cloudinary document storage configuration/);
  }
});

test('verified upload reserves an owner-only UUID key and returns no storage identifier', async () => {
  const { service, db, storageCalls } = setup();
  const result = await service.upload(owner, dto, uploadFile({ originalname: 'C:\\fakepath\\Project report.pdf' }));
  assert.equal(result.document.status, 'READY');
  assert.equal(result.document.originalFilename, 'Project report.pdf');
  assert.equal(result.document.cloudinaryPublicId, undefined);
  assert.equal(result.document.userId, undefined);
  assert.equal(result.document.title, dto.title);
  assert.equal(db.calls[0][0], 'lock');
  assert.equal(db.calls.find(call => call[0] === 'count')[2], true);
  assert.equal(db.rows.size, 1);
  const key = storageCalls[0][1].publicId;
  assert.match(key, new RegExp(`^student-documents/${owner.id}/[a-f0-9-]{36}\\.pdf$`));
  assert.ok(!key.includes('report'));
});

test('unverified, inactive and non-student accounts are rejected before storage or a reservation', async () => {
  for (const change of [{ emailVerifiedAt: null }, { status: 'SUSPENDED' }, { role: 'ADMIN' }]) {
    const { service, db, storageCalls } = setup();
    await assert.rejects(service.upload({ ...owner, ...change }, dto, uploadFile()), error => error.getStatus() === 403);
    assert.equal(db.calls.length, 0); assert.equal(storageCalls.length, 0);
  }
});

test('missing, oversized, forged, encrypted or non-PDF content is rejected before creating a reservation', async () => {
  const inputs = [undefined, uploadFile({ buffer: Buffer.alloc(0), size: 0 }),
    uploadFile({ size: validPdf.length + 1 }), uploadFile({ buffer: Buffer.alloc(DOCUMENT_LIMITS.maxBytes + 1), size: DOCUMENT_LIMITS.maxBytes + 1 }),
    uploadFile({ originalname: 'fake.exe' }), uploadFile({ mimetype: 'application/javascript' }),
    uploadFile({ buffer: Buffer.from('%PDF-1.7\nnot a real PDF\n%%EOF'), size: 33 })];
  for (const file of inputs) {
    const { service, db, storageCalls } = setup();
    await assert.rejects(service.upload(owner, dto, file), error => error.getStatus() === 400);
    assert.equal(db.calls.length, 0); assert.equal(storageCalls.length, 0);
  }
});

test('a structurally invalid PDF with a matching size still fails content validation', async () => {
  const bytes = Buffer.from('%PDF-1.7\nnot a real PDF\n%%EOF');
  const { service, db } = setup();
  await assert.rejects(service.upload(owner, dto, uploadFile({ buffer: bytes, size: bytes.length })), error => error.getStatus() === 400);
  assert.equal(db.calls.length, 0);
});

test('disabled storage is explicitly reported and uploads fail without external calls', async () => {
  const { service, db } = setup(); service.storage = undefined;
  assert.equal((await service.list(owner.id)).available, false);
  await assert.rejects(service.upload(owner, dto, uploadFile()), error => error.getStatus() === 503);
  assert.equal(db.rows.size, 0);
});

test('quota counts pending and deleting reservations as well as completed files', async () => {
  const initial = Array.from({ length: 10 }, (_, index) => document({ status: ['READY', 'UPLOADING', 'DELETING'][index % 3] }));
  const { service, db, storageCalls } = setup(initial);
  await assert.rejects(service.upload(owner, dto, uploadFile()), error => error.getStatus() === 409);
  assert.equal(db.rows.size, 10); assert.equal(storageCalls.length, 0);
});

test('two concurrent uploads cannot claim the last available document slot', async () => {
  const { service, db, storageCalls } = setup(Array.from({ length: 9 }, () => document()));
  const results = await Promise.allSettled([service.upload(owner, dto, uploadFile()), service.upload(owner, dto, uploadFile())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.getStatus(), 409);
  assert.equal(db.rows.size, 10);
  assert.equal(storageCalls.filter(call => call[0] === 'upload').length, 1);
});

test('upload failure destroys the minted asset even if the provider never returned a response', async () => {
  const privateError = 'provider-secret-private-document-url';
  const { service, db, storageCalls } = setup([], { async upload() { throw Error(privateError); } });
  await assert.rejects(service.upload(owner, dto, uploadFile()), error => error.getStatus() === 503 && !JSON.stringify(error).includes(privateError));
  assert.equal(db.rows.size, 0);
  assert.equal(storageCalls.length, 1); assert.equal(storageCalls[0][0], 'destroy');
});

test('inconsistent upload metadata is cleaned up instead of being exposed as READY', async () => {
  const { service, db, storageCalls } = setup([], { async upload() { return { publicId: 'untrusted-key', bytes: 1, resourceType: 'image', deliveryType: 'upload' }; } });
  await assert.rejects(service.upload(owner, dto, uploadFile()), error => error.getStatus() === 503);
  assert.equal(db.rows.size, 1); assert.equal([...db.rows.values()][0].status, 'DELETING'); assert.equal(storageCalls[0][0], 'destroy');
});

test('an ambiguous timed-out upload keeps its asset key even if immediate deletion reports success', async () => {
  const { service, db, storageCalls } = setup([], { async upload() { throw new DocumentStorageError('UPLOAD_OUTCOME_UNKNOWN', 'The upload outcome is unknown.'); } });
  await assert.rejects(service.upload(owner, dto, uploadFile()), error => error.getStatus() === 503 && /two minutes/.test(error.message));
  const item = [...db.rows.values()][0];
  assert.equal(item.status, 'DELETING'); assert.equal(storageCalls[0][0], 'destroy');
  await assert.rejects(service.delete(item.id, owner), error => error.getStatus() === 409);
  item.createdAt = new Date(Date.now() - 121_000);
  await service.delete(item.id, owner); assert.equal(db.rows.size, 0);
});

test('failed storage cleanup preserves a visible document for deletion retry', async () => {
  const { service, db } = setup([], { async upload() { throw Error('private provider body'); }, async destroy() { throw Error('private deletion body'); } });
  await assert.rejects(service.upload(owner, dto, uploadFile()), error => error.getStatus() === 503);
  assert.equal(db.rows.size, 1); assert.equal([...db.rows.values()][0].status, 'DELETING');
});

test('provider authentication and permission failures produce an administrator action without exposing credentials', async () => {
  for (const code of ['STORAGE_AUTH_REJECTED', 'STORAGE_PERMISSION_DENIED']) {
    const { service } = setup([], { async upload() { throw new DocumentStorageError(code, 'Document storage configuration requires administrator attention.'); } });
    await assert.rejects(service.upload(owner, dto, uploadFile()), error => error.getStatus() === 503 && /administrator/.test(error.message));
  }
});

test('a database finalization failure also cleans up the uploaded asset', async () => {
  const { service, db, storageCalls } = setup(); db.studentDocument.update = async () => { throw Error('private database error'); };
  await assert.rejects(service.upload(owner, dto, uploadFile()), error => error.getStatus() === 503);
  assert.equal(db.rows.size, 0); assert.equal(storageCalls.at(-1)[0], 'destroy');
});

test('student lists contain only their own metadata and include limits', async () => {
  const mine = document(), theirs = document({ userId: another.id });
  const { service } = setup([mine, theirs]);
  const result = await service.list(owner.id);
  assert.equal(result.documents.length, 1); assert.equal(result.documents[0].id, mine.id);
  assert.deepEqual(result.limits, { maxBytes: 4194304, maxDocuments: 10 });
  assert.equal(result.documents[0].cloudinaryPublicId, undefined);
});

test('other students cannot obtain signed downloads or delete a document', async () => {
  const item = document(); const { service, db, storageCalls } = setup([item]);
  await assert.rejects(service.download(item.id, another), error => error.getStatus() === 404);
  await assert.rejects(service.delete(item.id, another), error => error.getStatus() === 404);
  assert.equal(storageCalls.length, 0); assert.equal(db.rows.size, 1);
});

test('owner and administrator downloads use a fresh link with at most five minutes of validity', async () => {
  const item = document(); const { service, storageCalls } = setup([item]); const before = Date.now();
  for (const user of [owner, administrator]) {
    const result = await service.download(item.id, user);
    assert.equal(result.url, 'https://storage.example.test/private-download');
    assert.ok(Date.parse(result.expiresAt) >= before + 299_000);
    assert.ok(Date.parse(result.expiresAt) <= Date.now() + 300_000);
    assert.equal(storageCalls.at(-1)[1], item.cloudinaryPublicId);
  }
});

test('incomplete documents cannot issue download links', async () => {
  for (const status of ['UPLOADING', 'DELETING']) {
    const item = document({ status }); const { service, storageCalls } = setup([item]);
    await assert.rejects(service.download(item.id, owner), error => error.getStatus() === 409);
    assert.equal(storageCalls.length, 0);
  }
});

test('download signing failures do not reveal provider details', async () => {
  const item = document(); const { service } = setup([item], { createDownloadUrl() { throw Error('secret-key-and-private-url'); } });
  await assert.rejects(service.download(item.id, owner), error => error.getStatus() === 503 && !JSON.stringify(error).includes('secret-key-and-private-url'));
});

test('delete removes the storage asset before its database record', async () => {
  const item = document(); const { service, db, storageCalls } = setup([item], { async destroy() {
    assert.equal(db.rows.get(item.id).status, 'DELETING');
    storageCalls.push(['destroy', item.cloudinaryPublicId]);
  } });
  assert.match((await service.delete(item.id, owner)).message, /deleted/);
  assert.equal(db.rows.size, 0); assert.equal(storageCalls.length, 1);
});

test('failed delete keeps the reservation and a later retry completes removal', async () => {
  const item = document(); const { service, db, storage } = setup([item], { async destroy() { throw Error('private provider body'); } });
  await assert.rejects(service.delete(item.id, owner), error => error.getStatus() === 503 && !JSON.stringify(error).includes('private provider body'));
  assert.equal(db.rows.get(item.id).status, 'DELETING');
  item.createdAt = new Date(Date.now() - 121_000);
  storage.destroy = async () => undefined;
  await service.delete(item.id, owner); assert.equal(db.rows.size, 0);
});

test('active uploads cannot be deleted but abandoned reservations can be cleaned up after two minutes', async () => {
  const item = document({ status: 'UPLOADING' }); const { service, db, storageCalls } = setup([item]);
  await assert.rejects(service.delete(item.id, owner), error => error.getStatus() === 409);
  assert.equal(storageCalls.length, 0);
  item.createdAt = new Date(Date.now() - 121_000);
  await service.delete(item.id, owner); assert.equal(db.rows.size, 0);
});

test('administrator listing searches students and document titles without returning storage keys', async () => {
  const item = document(); const { service, db } = setup([item]);
  const result = await service.adminList({ page: 2, search: 'student' });
  assert.equal(result.page, 2); assert.equal(result.pageSize, 15);
  assert.deepEqual(result.documents[0].user, { id: owner.id, name: owner.name, email: owner.email });
  assert.equal(result.documents[0].cloudinaryPublicId, undefined);
  const query = db.calls.find(call => call[0] === 'findMany')[1];
  assert.equal(query.skip, 15); assert.equal(query.take, 15);
  assert.equal(query.where.OR.length, 4);
  assert.deepEqual(query.include.user.select, { id: true, name: true, email: true });
});

test('upload DTO rejects unknown ownership and invalid category fields', async () => {
  const invalid = plainToInstance(UploadDocumentDto, { title: ' ', category: 'OTHER', userId: another.id });
  const errors = await validate(invalid, { whitelist: true, forbidNonWhitelisted: true });
  assert.deepEqual(errors.map(error => error.property).sort(), ['category', 'title', 'userId']);
});

function guardRequest(user = owner) {
  const request = { currentUser: user };
  const response = new EventEmitter();
  const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) };
  return { request, response, context };
}

test('upload admission rejects unverified students before allocating a multipart slot', () => {
  const guard = new DocumentUploadGuard();
  assert.throws(() => guard.canActivate(guardRequest({ ...owner, emailVerifiedAt: null }).context), error => error.getStatus() === 403);
  assert.equal(guard.activeUploads, 0);
});

test('upload admission is bounded to two requests and release handles finish and close once', () => {
  const guard = new DocumentUploadGuard(); const first = guardRequest(), second = guardRequest(), third = guardRequest();
  assert.equal(guard.canActivate(first.context), true); assert.equal(guard.canActivate(second.context), true);
  assert.throws(() => guard.canActivate(third.context), error => error.getStatus() === 429);
  first.response.emit('finish'); first.response.emit('close'); first.request.documentUploadRelease();
  assert.equal(guard.activeUploads, 1);
  assert.equal(guard.canActivate(third.context), true);
  second.response.emit('close'); third.response.emit('close');
  assert.equal(guard.activeUploads, 0);
});

test('a disconnected browser retains its slot until in-flight parsing or upload finishes', async () => {
  const guard = new DocumentUploadGuard(); const admitted = guardRequest();
  guard.canActivate(admitted.context);
  let finish; const work = new Promise(resolve => { finish = resolve; });
  const controller = new DocumentsController({ upload: () => work });
  const request = controller.upload(admitted.request, dto, uploadFile());
  admitted.response.emit('close'); assert.equal(guard.activeUploads, 1);
  finish({ message: 'Uploaded' }); await request;
  assert.equal(guard.activeUploads, 0);
});

test('failed uploads release admission in the controller finally handler', async () => {
  const guard = new DocumentUploadGuard(); const admitted = guardRequest(); guard.canActivate(admitted.context);
  const controller = new DocumentsController({ upload: async () => { throw Error('Failure'); } });
  await assert.rejects(controller.upload(admitted.request, dto, uploadFile()));
  assert.equal(guard.activeUploads, 0);
});

test('multipart controller accepts the three expected parts and rejects surplus fields and oversized files', async t => {
  const requests = [];
  class TestModule {}
  Module({ controllers: [DocumentsController], providers: [
    { provide: DocumentsService, useValue: { async upload(user, data, file) { requests.push({ user, data, file }); return { message: 'Accepted' }; } } },
    { provide: Database, useValue: { user: { findUnique: async () => owner } } },
    SessionGuard, StudentGuard, DocumentUploadGuard,
  ] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false, abortOnError: false });
  app.use((request, _response, next) => { request.session = { userId: owner.id, authVersion: 0 }; next(); });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const address = app.getHttpServer().address();
  function form(extra = false, bytes = validPdf) {
    const body = new FormData(); body.set('title', dto.title); body.set('category', dto.category);
    body.set('file', new Blob([bytes], { type: 'application/pdf' }), 'Project report.pdf');
    if (extra) body.set('userId', another.id);
    return body;
  }
  const url = `http://127.0.0.1:${address.port}/documents`;
  const accepted = await loopbackFetch(url, { method: 'POST', body: form() });
  assert.equal(accepted.status, 201); assert.equal(requests.length, 1);
  assert.equal(requests[0].user.id, owner.id); assert.equal(requests[0].file.buffer.length, validPdf.length);
  assert.equal((await loopbackFetch(url, { method: 'POST', body: form(true) })).status, 400);
  assert.equal((await loopbackFetch(url, { method: 'POST', body: form(false, Buffer.alloc(DOCUMENT_LIMITS.maxBytes + 1)) })).status, 413);
  assert.equal(requests.length, 1);
});
