import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

Object.assign(process.env, { NODE_ENV: 'development', DATABASE_URL: 'postgresql://isolated:isolated@127.0.0.1:1/never-connect',
  SESSION_SECRET: 'isolated-enhancement-tests-session-secret-0123456789012345', APP_ORIGIN: 'http://127.0.0.1:3000',
  SESSION_DRIVER: 'postgres', MAIL_MODE: 'file', DOTENV_CONFIG_PATH: fileURLToPath(new URL(`.enhancement-tests-no-env-${process.pid}`, import.meta.url)) });
for (const name of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[name];
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { ProfileService, normalizeSocialLinks, safeSocialUrl } = require('../dist/profile.js');
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

test('Legacy grades serialize as optional null/4 and malformed or unknown social values stay out', async () => {
  const { row, service } = setup({ educations: [qualification], socialLinks: { github: 'https://github.com/example', secret: 'Private sentinel', additional: [] } });
  const profile = await service.get(row.userId);
  assert.equal(profile.cgpa, null); assert.equal(profile.cgpaScale, 4);
  assert.equal(profile.educations[0].cgpa, null); assert.equal(profile.educations[0].cgpaScale, 4);
  assert.deepEqual(profile.socialLinks, { github: 'https://github.com/example' });
  assert.equal(profile.familyBackground.religion, 'Private fixture');
});

test('Grade DTOs accept blank-null, zero and two decimals, and reject malformed numeric values/scales', () => {
  for (const cgpa of [null, 0, 3.75, 4, 4.99, 5]) {
    validated({ cgpa, cgpaScale: 5 }); validated({ educations: [{ ...qualification, cgpa, cgpaScale: 5 }] });
  }
  for (const cgpa of [-0.01, 5.01, 3.751, '3.75', '', true, [], {}, NaN, Infinity]) {
    assert.ok(errors({ cgpa }).length > 0); assert.ok(errors({ educations: [{ ...qualification, cgpa }] }).length > 0);
  }
  for (const cgpaScale of [null, 0, 3, 6, '4', 4.1, true]) {
    assert.ok(errors({ cgpaScale }).length > 0); assert.ok(errors({ educations: [{ ...qualification, cgpaScale }] }).length > 0);
  }
  validated({}); validated({ educations: [qualification] });
});

test('Main grade saves/reloads on either scale, preserves zero, and can be cleared explicitly', async () => {
  const { row, db, service } = setup();
  const first = await service.update(row.userId, validated({ cgpa: 4.87, cgpaScale: 5 }));
  assert.equal(first.cgpa, 4.87); assert.equal(first.cgpaScale, 5);
  assert.equal((await service.get(row.userId)).cgpa, 4.87);
  const untouched = await service.update(row.userId, validated({ city: 'Sylhet' }));
  assert.equal(untouched.cgpa, 4.87); assert.equal(untouched.cgpaScale, 5);
  assert.equal(Object.hasOwn(db.writes.at(-1), 'cgpa'), false);
  const zero = await service.update(row.userId, validated({ cgpa: 0 })); assert.equal(zero.cgpa, 0);
  const cleared = await service.update(row.userId, validated({ cgpa: null, cgpaScale: 4 }));
  assert.equal(cleared.cgpa, null); assert.equal(cleared.cgpaScale, 4); assert.deepEqual(cleared.skills, ['TypeScript']);
});

test('Cross-field validation checks the saved/current scale and rejects a scale reduction without data loss', async () => {
  const { row, db, service } = setup({ cgpa: 4.5, cgpaScale: 5 });
  await assert.rejects(service.update(row.userId, validated({ cgpaScale: 4 })), /CGPA must be between 0 and the selected grading scale/);
  assert.equal(db.row.cgpa, 4.5); assert.equal(db.row.cgpaScale, 5); assert.equal(db.writes.length, 0);
  await service.update(row.userId, validated({ cgpa: 3.8, cgpaScale: 4 }));
  await assert.rejects(service.update(row.userId, validated({ cgpa: 4.01 })), /CGPA must be between/);
  assert.equal(db.row.cgpa, 3.8);
});

test('Each additional qualification carries its own optional grade and bounded scale', async () => {
  const { row, db, service } = setup();
  const saved = await service.update(row.userId, validated({ educations: [{ ...qualification, cgpa: 4.91, cgpaScale: 5 }, { ...qualification, degree: 'Short course' }] }));
  assert.equal(saved.educations[0].cgpa, 4.91); assert.equal(saved.educations[0].cgpaScale, 5);
  assert.equal(saved.educations[1].cgpa, null); assert.equal(saved.educations[1].cgpaScale, 4);
  const before = db.row;
  await assert.rejects(service.update(row.userId, validated({ educations: [{ ...qualification, cgpa: 4.01 }] })), /Qualification CGPA/);
  assert.deepEqual(db.row, before);
  const cleared = await service.update(row.userId, validated({ educations: [{ ...qualification, cgpa: null, cgpaScale: 5 }] }));
  assert.equal(cleared.educations[0].cgpa, null); assert.equal(cleared.educations[0].cgpaScale, 5);
});

test('Additional social DTOs enforce bounded arrays, labels, HTTP(S) URLs and no credential URLs', () => {
  validated({ socialLinks: { additional: Array.from({ length: 8 }, (_, i) => ({ label: 'Link '+i, url: 'https://example.com/'+i })) } });
  validated({ socialLinks: { linkedin: ' ', github: '', portfolio: 'https://example.com', additional: [] } });
  const invalid = [
    null, [], 'text', { additional: null }, { additional: {} }, { additional: Array(9).fill(extra) },
    { additional: [null] }, { additional: ['text'] }, { additional: [{}] }, { additional: [{ ...extra, label: '' }] },
    { additional: [{ ...extra, label: '  ' }] }, { additional: [{ ...extra, label: 'a'.repeat(41) }] },
    { additional: [{ ...extra, label: null }] }, { additional: [{ ...extra, url: null }] },
    { additional: [{ ...extra, url: 'javascript:alert(1)' }] }, { additional: [{ ...extra, url: 'data:text/html,hi' }] },
    { additional: [{ ...extra, url: 'https://user:secret@example.com' }] }, { additional: [{ ...extra, url: 'ftp://example.com/a' }] },
    { additional: [{ ...extra, url: 'https://example.com/'+ 'a'.repeat(500) }] },
    { additional: [{ ...extra, secret: 'unsupported' }] }, { facebook: 'https://example.com' }, { github: null },
    { github: 'https://user:secret@example.com' },
  ];
  for (const socialLinks of invalid) assert.ok(errors({ socialLinks }).length > 0, JSON.stringify(socialLinks));
});

test('Social links trim and persist, while partial patches preserve omitted links and support independent clearing', async () => {
  const { row, db, service } = setup();
  const first = await service.update(row.userId, validated({ socialLinks: { linkedin: ' https://linkedin.com/in/example ', additional: [{ label: '  Design work  ', url: ' https://example.com/design ' }] } }));
  assert.deepEqual(first.socialLinks, { linkedin: 'https://linkedin.com/in/example', additional: [extra] });
  assert.deepEqual((await service.get(row.userId)).socialLinks, first.socialLinks);
  const second = await service.update(row.userId, validated({ socialLinks: { github: 'https://github.com/example' } }));
  assert.deepEqual(second.socialLinks, { ...first.socialLinks, github: 'https://github.com/example' });
  assert.deepEqual((await service.update(row.userId, validated({ socialLinks: {} }))).socialLinks, second.socialLinks);
  const cleared = await service.update(row.userId, validated({ socialLinks: { linkedin: ' ', additional: [] } }));
  assert.deepEqual(cleared.socialLinks, { github: 'https://github.com/example' });
  const unrelated = await service.update(row.userId, validated({ city: 'Sylhet' }));
  assert.deepEqual(unrelated.socialLinks, cleared.socialLinks); assert.equal(Object.hasOwn(db.writes.at(-1), 'socialLinks'), false);
  assert.equal(unrelated.familyBackground.religion, 'Private fixture');
});

test('Concurrent social edits are merged under the owner row lock', async () => {
  const { row, db, service } = setup({ socialLinks: { linkedin: 'https://linkedin.com/in/example' } });
  await Promise.all([
    service.update(row.userId, validated({ socialLinks: { github: 'https://github.com/example' } })),
    service.update(row.userId, validated({ socialLinks: { additional: [extra] } })),
  ]);
  assert.deepEqual(db.row.socialLinks, { linkedin: 'https://linkedin.com/in/example', github: 'https://github.com/example', additional: [extra] });
});

test('Only actual social links affect completion and optional grades add no publishing requirement', async () => {
  const { row, service } = setup();
  const before = await service.get(row.userId), completion = service.completion(before);
  const empty = await service.update(row.userId, validated({ cgpa: 3.87, socialLinks: { additional: [], github: '' } }));
  assert.equal(service.completion(empty), completion);
  const linked = await service.update(row.userId, validated({ socialLinks: { additional: [extra] } }));
  assert.ok(service.completion(linked) > completion);
  const published = await service.update(row.userId, validated({ cgpa: null, directoryPublished: true }));
  assert.equal(published.directoryPublished, true); assert.equal(published.cgpa, null);
});

test('Legacy malformed social JSON is projected safely, with only allowed named fields and eight valid additional entries', () => {
  for (const value of [null, [], 'text', 1, {}]) assert.deepEqual(normalizeSocialLinks(value), {});
  const normalized = normalizeSocialLinks({ github: 'https://github.com/example', private: 'secret', linkedin: 'javascript:alert(1)', portfolio: 'https://user:secret@example.com', additional: [{ ...extra, label: ' Design work ', private: 'secret' }, null, { label: 'Unsafe', url: 'javascript:alert(1)' }] });
  assert.deepEqual(normalized, { github: 'https://github.com/example', additional: [extra] });
  assert.equal(normalizeSocialLinks({ additional: Array(20).fill(extra) }).additional.length, 8);
  for (const url of ['javascript:alert(1)', 'https://user:secret@example.com', 'https://exa\nmple.com', null, true]) assert.equal(safeSocialUrl(url), undefined);
});
