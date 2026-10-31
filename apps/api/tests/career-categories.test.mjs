import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

Object.assign(process.env, { NODE_ENV: 'development', DATABASE_URL: 'postgresql://isolated:isolated@127.0.0.1:1/never-connect',
  SESSION_SECRET: 'isolated-categories-tests-session-secret-0123456789012345', APP_ORIGIN: 'http://127.0.0.1:3000',
  SESSION_DRIVER: 'postgres', MAIL_MODE: 'file', DOTENV_CONFIG_PATH: fileURLToPath(new URL(`.categories-tests-no-env-${process.pid}`, import.meta.url)) });
for (const name of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[name];
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { ProfileService, normalizeSocialLinks, safeSocialUrl, normalizeTalentCategories } = require('../dist/profile.js');
const { ProfileDto } = require('../dist/dto.js');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');
const extra = { label: 'Design work', url: 'https://example.com/design' };

function fixture(overrides = {}) {
  const userId = randomUUID();
  return { id: randomUUID(), userId, phone: '', city: 'Dhaka', objective: 'Develop useful products.', university: 'Example University',
    department: 'CSE', semester: '3', degree: 'BSc', passingYear: 2029, headline: 'Student developer', talentCategory: 'software-it',
    availability: 'OPEN_TO_OPPORTUNITIES', directoryPublished: false, socialLinks: {}, familyBackground: { religion: 'Private fixture' }, activities: '',
    skills: [{ name: 'TypeScript' }], educations: [], updatedAt: new Date(),
    user: { id: userId, name: 'Synthetic Enhancement Student', role: 'STUDENT', status: 'ACTIVE', emailVerifiedAt: new Date() }, ...overrides };
}
function database(initial) {
  let row = structuredClone(initial), locked = false, queue = Promise.resolve();
  const writes = [];
  const db = { writes, get row() { return structuredClone(row); },
    studentProfile: {
      async upsert(options) { assert.equal(options.where.userId, row.userId); return structuredClone(row); },
      async findUnique(options) { assert.equal(locked, true); assert.equal(options.where.userId, row.userId); return structuredClone(row); },
      async update(options) {
        assert.equal(locked, true); assert.equal(options.where.userId, row.userId); writes.push(structuredClone(options.data));
        const { skills, educations, ...fields } = options.data; Object.assign(row, structuredClone(fields));
        if (skills) row.skills = structuredClone(skills.create); if (educations) row.educations = structuredClone(educations.create);
        return structuredClone(row);
      },
    },
    async $queryRaw(strings, ...values) { assert.match(strings.join('?'), /FROM "StudentProfile".*FOR UPDATE/); assert.equal(values[0], row.userId); locked = true; return [{ id: row.id }]; },
    $transaction(operation) {
      const result = queue.then(async () => { const before = structuredClone(row); try { return await operation(db); } catch (error) { row = before; throw error; } finally { locked = false; } });
      queue = result.catch(() => undefined); return result;
    },
  };
  return db;
}
function errors(data) { return validateSync(plainToInstance(ProfileDto, data), { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }); }
function validated(data) { assert.deepEqual(errors(data), []); return plainToInstance(ProfileDto, data); }
function setup(overrides) { const row = fixture(overrides), db = database(row); return { row, db, service: new ProfileService(db) }; }
const qualification = { institution: 'Example College', degree: 'HSC', field: 'Science', startYear: 2020, endYear: 2022 };

const selected = ['design-creative', 'marketing-sales', 'software-it'];

test('New category arrays accept one to three unique known interests and reject empty or malformed selections', () => {
  for (const talentCategories of [['software-it'], selected.slice(0, 2), selected]) validated({ talentCategories });
  for (const talentCategories of [[], null, 'software-it', {}, [['software-it']], [''], ['unknown'], [' software-it '], ['software-it', 'software-it'], [...selected, 'engineering'], [null], [7]]) {
    assert.ok(errors({ talentCategories }).length > 0, JSON.stringify(talentCategories));
  }
  for (const talentCategory of ['', null, 'unknown']) assert.ok(errors({ talentCategory }).length > 0);
  validated({ talentCategory: 'engineering' }); validated({});
});

test('Canonical reads preserve saved order and first alias, with fallback only for absent or empty legacy arrays', async () => {
  for (const talentCategories of [undefined, null, []]) {
    const { row, service } = setup({ talentCategories });
    const profile = await service.get(row.userId);
    assert.deepEqual(profile.talentCategories, ['software-it']); assert.equal(profile.talentCategory, 'software-it');
  }
  const { row, service } = setup({ talentCategory: 'engineering', talentCategories: selected });
  const profile = await service.get(row.userId);
  assert.deepEqual(profile.talentCategories, selected); assert.equal(profile.talentCategory, selected[0]);
  assert.deepEqual(normalizeTalentCategories(['unknown'], 'engineering'), []);
  assert.deepEqual(normalizeTalentCategories(['design-creative', 'design-creative', 'unknown', 'engineering', 'exploring', 'software-it']), ['design-creative', 'engineering', 'exploring']);
});

test('New accounts may read an empty category draft before choosing, and unrelated partial updates preserve it', async () => {
  const { row, db, service } = setup({ talentCategory: '', talentCategories: [] });
  const profile = await service.get(row.userId);
  assert.deepEqual(profile.talentCategories, []); assert.equal(profile.talentCategory, '');
  const updated = await service.update(row.userId, validated({ city: 'Sylhet' }));
  assert.deepEqual(updated.talentCategories, []);
  assert.equal(Object.hasOwn(db.writes.at(-1), 'talentCategories'), false);
  assert.equal(Object.hasOwn(db.writes.at(-1), 'talentCategory'), false);
});

test('An explicit selection atomically saves the array and first alias, with new array precedence over legacy input', async () => {
  const { row, db, service } = setup();
  const profile = await service.update(row.userId, validated({ talentCategories: selected, talentCategory: 'engineering' }));
  assert.deepEqual(profile.talentCategories, selected); assert.equal(profile.talentCategory, selected[0]);
  assert.deepEqual(db.row.talentCategories, selected); assert.equal(db.row.talentCategory, selected[0]);
  assert.deepEqual(db.writes.at(-1).talentCategories, selected); assert.equal(db.writes.at(-1).talentCategory, selected[0]);
  const reloaded = await service.get(row.userId); assert.deepEqual(reloaded.talentCategories, selected);
  const unrelated = await service.update(row.userId, validated({ headline: 'Preserve my choices' }));
  assert.deepEqual(unrelated.talentCategories, selected); assert.equal(unrelated.talentCategory, selected[0]);
  assert.equal(Object.hasOwn(db.writes.at(-1), 'talentCategories'), false);
  assert.equal(unrelated.familyBackground.religion, 'Private fixture');
});

test('A legacy nonempty scalar update becomes a one-category selection without losing other profile data', async () => {
  const { row, db, service } = setup({ talentCategories: selected, talentCategory: selected[0], socialLinks: { additional: [extra] } });
  const profile = await service.update(row.userId, validated({ talentCategory: 'engineering' }));
  assert.deepEqual(profile.talentCategories, ['engineering']); assert.equal(profile.talentCategory, 'engineering');
  assert.deepEqual(db.writes.at(-1).talentCategories, ['engineering']);
  assert.deepEqual(profile.socialLinks, { additional: [extra] }); assert.deepEqual(profile.skills, ['TypeScript']);
});

test('Service guards reject explicit empty, duplicate or unknown categories before making any write', async () => {
  const { row, db, service } = setup({ talentCategories: selected, talentCategory: selected[0] });
  for (const patch of [{ talentCategories: [] }, { talentCategories: null }, { talentCategories: ['engineering', 'engineering'] }, { talentCategories: ['unknown'] }, { talentCategories: [...selected, 'engineering'] }, { talentCategory: '' }, { talentCategory: null }]) {
    await assert.rejects(service.update(row.userId, patch), error => error.getStatus() === 400);
  }
  assert.equal(db.writes.length, 0); assert.deepEqual(db.row.talentCategories, selected);
});

test('Publishing uses the resolved category array and keeps the existing ownership and completeness checks', async () => {
  const { row, service } = setup({ talentCategory: '', talentCategories: [] });
  await assert.rejects(service.update(row.userId, validated({ directoryPublished: true })), /at least one career category/);
  const published = await service.update(row.userId, validated({ talentCategories: selected, directoryPublished: true }));
  assert.equal(published.directoryPublished, true); assert.deepEqual(published.talentCategories, selected);
  const revoked = setup({ user: { role: 'STUDENT', status: 'ACTIVE', emailVerifiedAt: null } });
  await assert.rejects(revoked.service.update(revoked.row.userId, validated({ talentCategories: ['engineering'], directoryPublished: true })), error => error.getStatus() === 403);
  const incomplete = setup({ university: '' });
  await assert.rejects(incomplete.service.update(incomplete.row.userId, validated({ talentCategories: selected, directoryPublished: true })), /university/);
});

test('Concurrent category replacement and unrelated edits retain a consistent first alias under the owner row lock', async () => {
  const { row, db, service } = setup();
  const beforeCompletion = service.completion(await service.get(row.userId));
  await Promise.all([
    service.update(row.userId, validated({ talentCategories: selected })),
    service.update(row.userId, validated({ city: 'Sylhet' })),
  ]);
  assert.deepEqual(db.row.talentCategories, selected); assert.equal(db.row.talentCategory, selected[0]); assert.equal(db.row.city, 'Sylhet');
  assert.equal(service.completion(await service.get(row.userId)), beforeCompletion);
});
