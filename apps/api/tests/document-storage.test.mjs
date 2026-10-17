import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

// Invented credentials only. These tests forbid all provider and database traffic.
const require = createRequire(import.meta.url);
const workerThreads = require('node:worker_threads');
const { PDFDocument, PDFName, PDFString } = require('pdf-lib');
const { DocumentStorage, DocumentStorageError, MAX_PDF_BYTES, DOCUMENT_DOWNLOAD_TTL_SECONDS, validatePdfBuffer } = require('../dist/document-storage.js');
const settings = { cloudName: 'campus-storage-test', apiKey: '123456789012345', apiSecret: 'isolated-storage-secret-only' };
const publicId = 'student-documents/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.pdf';
const endpoint = `https://api.cloudinary.com/v1_1/${settings.cloudName}/raw`;
const privateProviderData = 'private-provider-body-with-student-link-and-secret';
const storage = () => new DocumentStorage(settings);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const validUpload = buffer => ({ public_id: publicId, bytes: buffer.byteLength, resource_type: 'raw', type: 'authenticated' });
const signature = fields => createHash('sha256').update(Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('&') + settings.apiSecret).digest('hex');
let pdf;
test.before(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  pdf = Buffer.from(await doc.save());
});
test.beforeEach(t => t.mock.method(globalThis, 'fetch', () => assert.fail('Storage unit tests must never contact a provider.')));

function safeError(code) {
  return error => {
    assert.ok(error instanceof DocumentStorageError);
    if (code) assert.equal(error.code, code);
    const details = `${error.message} ${error.stack} ${JSON.stringify(error)}`;
    for (const secret of [settings.apiSecret, settings.apiKey, privateProviderData, publicId, 'api.cloudinary.com']) assert.ok(!details.includes(secret));
    assert.equal(error.cause, undefined);
    return true;
  };
}

test('limits are compatible with the 4 MiB upload and five minute download contracts', () => {
  assert.equal(MAX_PDF_BYTES, 4194304);
  assert.equal(DOCUMENT_DOWNLOAD_TTL_SECONDS, 300);
});

test('parses a real single-page PDF without contacting storage', async () => {
  await validatePdfBuffer(pdf);
});

for (const [name, value, code] of [
  ['empty bytes', Buffer.alloc(0), 'INVALID_PDF'],
  ['non-buffer input', new Uint8Array([1, 2]), 'INVALID_PDF'],
  ['renamed HTML', Buffer.from('<html>student</html>'), 'INVALID_PDF'],
  ['spoofed header and EOF', Buffer.from('%PDF-1.7\nThis is not a PDF\n%%EOF'), 'INVALID_PDF'],
  ['oversized bytes', Buffer.alloc(4194305), 'FILE_TOO_LARGE'],
]) {
  test(`rejects ${name} with a safe validation error`, async () => {
    await assert.rejects(validatePdfBuffer(value), safeError(code));
  });
}

test('rejects missing EOF, a trailing payload, and a prefixed executable', async () => {
  for (const bytes of [pdf.subarray(0, pdf.length - 12), Buffer.concat([pdf, Buffer.from('<script>bad</script>')]), Buffer.concat([Buffer.from('MZ'), pdf])]) {
    await assert.rejects(validatePdfBuffer(bytes), safeError('INVALID_PDF'));
  }
});

test('rejects a structurally valid PDF with no pages', async () => {
  const doc = await PDFDocument.create();
  const bytes = Buffer.from(await doc.save({ addDefaultPage: false }));
  await assert.rejects(validatePdfBuffer(bytes), safeError('INVALID_PDF'));
});

test('rejects a structurally valid PDF with an embedded JavaScript action', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.addJavaScript('startup', 'app.alert("test")');
  await assert.rejects(validatePdfBuffer(Buffer.from(await doc.save())), safeError('INVALID_PDF'));
});

test('rejects a nested direct-dictionary script action', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const annotation = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 100, 100],
    A: { S: 'JavaScript', JS: PDFString.of('app.alert("test")') } });
  page.node.set(PDFName.of('Annots'), doc.context.obj([annotation]));
  await assert.rejects(validatePdfBuffer(Buffer.from(await doc.save())), safeError('INVALID_PDF'));
});

test('rejects a PDF with an automatic launch action', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'Launch', F: PDFString.of('file.exe') }));
  await assert.rejects(validatePdfBuffer(Buffer.from(await doc.save())), safeError('INVALID_PDF'));
});

test('rejects PDFs declaring encryption rather than ignoring encryption', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 1, R: 2 }));
  await assert.rejects(validatePdfBuffer(Buffer.from(await doc.save())), safeError('INVALID_PDF'));
});

test('accepts a bounded compressed object stream with the same structure as expansion fixtures', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.context.register(doc.context.flateStream(Buffer.alloc(1024 * 1024, 32), {
    Type: 'ObjStm', N: 0, First: 0,
  }));
  await validatePdfBuffer(Buffer.from(await doc.save({ useObjectStreams: false })));
});

test('rejects embedded-file streams, file-attachment annotations and EF dictionaries', async () => {
  for (const kind of ['stream', 'annotation', 'dictionary']) {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    if (kind === 'stream') doc.context.register(doc.context.stream(Buffer.from('private attachment'), { Type: 'EmbeddedFile' }));
    if (kind === 'annotation') page.node.set(PDFName.of('Annots'), doc.context.obj([{ Type: 'Annot', Subtype: 'FileAttachment' }]));
    if (kind === 'dictionary') doc.catalog.set(PDFName.of('Custom'), doc.context.obj({ EF: {} }));
    await assert.rejects(validatePdfBuffer(Buffer.from(await doc.save())), safeError('INVALID_PDF'));
  }
});

test('rejects a small compressed object stream that expands past the decoder cap', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.context.register(doc.context.flateStream(Buffer.alloc(8 * 1024 * 1024 + 1, 32), {
    Type: 'ObjStm', N: 0, First: 0,
  }));
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  assert.ok(bytes.byteLength < 100000, 'Fixture compresses a large stream into a small upload.');
  await assert.rejects(validatePdfBuffer(bytes), safeError('INVALID_PDF'));
});

test('rejects multiple compressed object streams exceeding the total decoder allocation cap', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  for (let index = 0; index < 4; index++) {
    doc.context.register(doc.context.flateStream(Buffer.alloc(5 * 1024 * 1024, 32), {
      Type: 'ObjStm', N: 0, First: 0,
    }));
  }
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  assert.ok(bytes.byteLength < 100000);
  await assert.rejects(validatePdfBuffer(bytes), safeError('INVALID_PDF'));
});

test('isolates parsing in a worker with bounded memory, drained output and a five second deadline', async t => {
  let configuration;
  let terminated = 0;
  let drained = 0;
  t.mock.method(workerThreads, 'Worker', function (_source, options) {
    configuration = options;
    const worker = new EventEmitter();
    worker.terminate = async () => { terminated++; return 0; };
    worker.stdout = worker.stderr = { resume: () => drained++ };
    return worker;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = validatePdfBuffer(pdf);
  const rejected = assert.rejects(pending, safeError('INVALID_PDF'));
  assert.equal(configuration.eval, true);
  assert.deepEqual(configuration.resourceLimits, { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 8, stackSizeMb: 4 });
  assert.deepEqual(configuration.workerData.bytes, pdf);
  assert.equal(configuration.stdout, true);
  assert.equal(configuration.stderr, true);
  assert.equal(drained, 2);
  t.mock.timers.tick(5000);
  await rejected;
  assert.equal(terminated, 1);
});

test('worker parse errors become safe invalid-PDF errors without leaking the cause', async t => {
  t.mock.method(workerThreads, 'Worker', function () {
    const worker = new EventEmitter();
    worker.terminate = async () => 0;
    queueMicrotask(() => worker.emit('error', new Error(privateProviderData)));
    return worker;
  });
  await assert.rejects(validatePdfBuffer(pdf), safeError('INVALID_PDF'));
});

for (const [name, invalid] of [
  ['missing', undefined], ['malicious cloud host', { ...settings, cloudName: 'evil.test/path' }],
  ['missing cloud', { ...settings, cloudName: undefined }], ['missing API key', { ...settings, apiKey: '' }],
  ['short secret', { ...settings, apiSecret: 'test' }], ['secret newline', { ...settings, apiSecret: 'private-secret\nline' }],
]) {
  test(`rejects ${name} configuration before network use`, () => assert.throws(() => new DocumentStorage(invalid), safeError('STORAGE_CONFIGURATION')));
}

test('server uploads PDF bytes only to the fixed HTTPS raw endpoint with signed authenticated parameters', async t => {
  const now = 1792200000000;
  t.mock.method(Date, 'now', () => now);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return json(validUpload(pdf));
  });
  const result = await storage().upload({ publicId, buffer: pdf });
  assert.deepEqual(result, { publicId, bytes: pdf.byteLength, resourceType: 'raw', deliveryType: 'authenticated' });
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, `${endpoint}/upload`);
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  assert.ok(options.body instanceof FormData);
  assert.equal(options.headers.accept, 'application/json');
  const fields = Object.fromEntries(options.body);
  assert.equal(fields.type, 'authenticated');
  assert.equal(fields.public_id, publicId);
  assert.equal(fields.overwrite, 'false');
  assert.equal(fields.use_filename, 'false');
  assert.equal(fields.unique_filename, 'false');
  assert.equal(fields.allowed_formats, 'pdf');
  assert.equal(fields.timestamp, String(now / 1000));
  assert.equal(fields.api_key, settings.apiKey);
  assert.equal(fields.file.name, 'document.pdf');
  assert.equal(fields.file.type, 'application/pdf');
  assert.deepEqual(Buffer.from(await fields.file.arrayBuffer()), pdf);
  const { api_key, signature: signed, file, ...toSign } = fields;
  assert.equal(signed, signature(toSign));
  assert.equal(fields.api_secret, undefined);
  assert.equal(fields.upload_preset, undefined);
});

for (const key of ['https://evil.test/a.pdf', '../private.pdf', 'student-documents/file.pdf', publicId.replace('.pdf', '.exe'), publicId.toUpperCase()]) {
  test('rejects an untrusted or malformed document storage key', async () => {
    await assert.rejects(storage().upload({ publicId: key, buffer: pdf }), safeError('INVALID_DOCUMENT_KEY'));
    await assert.rejects(storage().destroy(key), safeError('INVALID_DOCUMENT_KEY'));
    assert.throws(() => storage().createDownloadUrl(key, 'cv.pdf', Math.floor(Date.now() / 1000) + 300), safeError('INVALID_DOCUMENT_KEY'));
  });
}

test('upload rejects oversized and non-PDF input before any HTTPS call', async () => {
  await assert.rejects(storage().upload({ publicId, buffer: Buffer.alloc(MAX_PDF_BYTES + 1) }), safeError('FILE_TOO_LARGE'));
  await assert.rejects(storage().upload({ publicId, buffer: Buffer.from('not PDF') }), safeError('INVALID_PDF'));
});

for (const [name, response, code = 'UPLOAD_OUTCOME_UNKNOWN'] of [
  ['HTTP 401 body', () => json({ error: { message: privateProviderData } }, 401), 'STORAGE_AUTH_REJECTED'],
  ['HTTP 403 body', () => json({ error: { message: privateProviderData } }, 403), 'STORAGE_PERMISSION_DENIED'],
  ['HTTP 500 body', () => json({ error: { message: privateProviderData } }, 500)],
  ['malformed JSON', () => new Response(privateProviderData)],
  ['oversized JSON', () => new Response(JSON.stringify({ message: privateProviderData, data: 'x'.repeat(40000) }))],
  ['wrong public ID', () => json({ ...validUpload(pdf), public_id: 'other-private-document.pdf' })],
  ['public upload response', () => json({ ...validUpload(pdf), type: 'upload' })],
  ['wrong resource type', () => json({ ...validUpload(pdf), resource_type: 'image' })],
  ['wrong byte size', () => json({ ...validUpload(pdf), bytes: 1 })],
  ['pre-existing asset', () => json({ ...validUpload(pdf), existing: true })],
]) {
  test(`rejects ${name} without leaking provider data or retrying`, async t => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return response(); });
    await assert.rejects(storage().upload({ publicId, buffer: pdf }), safeError(code));
    assert.equal(calls, 1);
  });
}

test('network and timeout failures do not leak their cause and are not retried', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error(privateProviderData + settings.apiSecret); });
  await assert.rejects(storage().upload({ publicId, buffer: pdf }), safeError('UPLOAD_OUTCOME_UNKNOWN'));
  assert.equal(calls, 1);
});

test('download URL uses the raw API endpoint and signs a five minute attachment expiry', t => {
  const now = 1792200000000;
  t.mock.method(Date, 'now', () => now);
  const url = new URL(storage().createDownloadUrl(publicId, 'My CV.pdf', now / 1000 + 300));
  assert.equal(url.origin, 'https://api.cloudinary.com');
  assert.equal(url.pathname, `/v1_1/${settings.cloudName}/raw/download`);
  const fields = Object.fromEntries(url.searchParams);
  assert.equal(fields.public_id, publicId);
  assert.equal(fields.format, undefined, 'Raw key already contains .pdf; format must not append another extension.');
  assert.equal(fields.type, 'authenticated');
  assert.equal(fields.attachment, 'true');
  assert.equal(fields.expires_at, String(now / 1000 + 300));
  assert.equal(fields.timestamp, String(now / 1000));
  assert.equal(fields.api_key, settings.apiKey);
  const { api_key, signature: signed, ...toSign } = fields;
  assert.equal(signed, signature(toSign));
  assert.ok(!url.href.includes(settings.apiSecret));
  assert.ok(!url.href.includes('res.cloudinary.com'));
});

test('rejects expired, overlong, non-integer download expiry or unsafe filenames', () => {
  const now = Math.floor(Date.now() / 1000);
  for (const expiry of [now - 1, now, now + 301, NaN, Infinity, now + 1.5, 'later']) {
    assert.throws(() => storage().createDownloadUrl(publicId, 'cv.pdf', expiry), safeError('INVALID_DOWNLOAD_EXPIRY'));
  }
  for (const filename of ['', '../cv.pdf', 'cv.pdf\r\nX-Test: 1', 'cv.html', '\\cv.pdf', 'x'.repeat(256) + '.pdf']) {
    assert.throws(() => storage().createDownloadUrl(publicId, filename, now + 300), safeError('INVALID_FILENAME'));
  }
});

test('destroy signs authenticated raw deletion with invalidation and accepts only known results', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return json({ result: calls.length === 1 ? 'ok' : 'not found' }); });
  await storage().destroy(publicId);
  await storage().destroy(publicId);
  assert.equal(calls.length, 2);
  for (const { url, options } of calls) {
    assert.equal(url, `${endpoint}/destroy`);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(options.body instanceof URLSearchParams);
    const fields = Object.fromEntries(options.body);
    assert.equal(fields.public_id, publicId);
    assert.equal(fields.type, 'authenticated');
    assert.equal(fields.invalidate, 'true');
    const { api_key, signature: signed, ...toSign } = fields;
    assert.equal(signed, signature(toSign));
  }
});

test('destroy failure is safe and is never retried', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json({ result: privateProviderData }); });
  await assert.rejects(storage().destroy(publicId), safeError('INVALID_STORAGE_RESPONSE'));
  assert.equal(calls, 1);
});
