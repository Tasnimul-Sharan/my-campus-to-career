import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

Object.assign(process.env, { NODE_ENV: 'development', DATABASE_URL: 'postgresql://isolated:isolated@127.0.0.1:1/never-connect',
  SESSION_SECRET: 'isolated-talent-picture-tests-session-secret-0123456789', APP_ORIGIN: 'http://127.0.0.1:3000',
  SESSION_DRIVER: 'postgres', MAIL_MODE: 'file', DOTENV_CONFIG_PATH: fileURLToPath(new URL('.talent-picture-tests-no-env', import.meta.url)) });
for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[key];
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { TalentPicturesService, TalentPicturesController } = require('../dist/talent-pictures.js');
const id = randomUUID(), pictureId = randomUUID();
const picture = Buffer.from('synthetic-processed-webp');
const owner = { id, role: 'STUDENT', status: 'ACTIVE', emailVerifiedAt: new Date(), profilePictureId: pictureId };

function setup(rows = [owner, { id }], download = async () => picture) {
  const calls = [], storageCalls = [];
  const db = { user: { async findFirst(query) { calls.push(structuredClone(query)); return rows.shift() ?? null; } } };
  const pictures = { async download(...args) { storageCalls.push(args); return download(...args); } };
  return { service: new TalentPicturesService(db, pictures), calls, storageCalls };
}

test.beforeEach(t => t.mock.method(globalThis, 'fetch', () => assert.fail('Talent picture tests cannot call external services.')));

test('a public picture requires an opted-in, verified, active student both before and after delivery', async () => {
  const { service, calls, storageCalls } = setup();
  assert.equal(await service.download(id), picture);
  assert.equal(storageCalls.length, 1);
  assert.equal(storageCalls[0][0], id);
  assert.equal(storageCalls[0][1], owner);
  for (const { where } of calls) {
    assert.equal(where.id, id); assert.equal(where.role, 'STUDENT'); assert.equal(where.status, 'ACTIVE');
    assert.deepEqual(where.emailVerifiedAt, { not: null });
    assert.equal(where.profile.is.directoryPublished, true);
    assert.equal(where.profile.is.talentCategory.in.length, 7);
    assert.deepEqual(where.profile.is.skills, { some: {} });
  }
  assert.equal(calls[1].where.profilePictureId, pictureId);
  assert.deepEqual(calls[1].select, { id: true });
});

for (const [label, row] of [['private or unavailable student', null], ['student without a picture', { ...owner, profilePictureId: null }]]) {
  test(`${label} is denied without reading Cloudinary`, async () => {
    const { service, storageCalls } = setup([row]);
    await assert.rejects(service.download(id), error => error.getStatus() === 404);
    assert.equal(storageCalls.length, 0);
  });
}

test('unpublishing, suspension or replacement during download denies the response', async () => {
  const { service } = setup([owner, null]);
  await assert.rejects(service.download(id), error => error.getStatus() === 404);
});

test('underlying private asset readiness checks and safe provider errors remain authoritative', async () => {
  const { service, calls } = setup([owner], async () => { throw new Error('safe storage failure'); });
  await assert.rejects(service.download(id), /safe storage failure/);
  assert.equal(calls.length, 1);
});

test('controller sends no-store WebP bytes without exposing provider URLs', async () => {
  let headers, output;
  const response = { set(values) { headers = values; return this; }, send(value) { output = value; } };
  const controller = new TalentPicturesController({ async download(userId) { assert.equal(userId, id); return picture; } });
  await controller.download(id, response);
  assert.equal(output, picture);
  assert.equal(headers['Content-Type'], 'image/webp');
  assert.equal(headers['Cache-Control'], 'private, no-store');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Content-Length'], String(picture.length));
  assert(!JSON.stringify(headers).includes('cloudinary'));
});
