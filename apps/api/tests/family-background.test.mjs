import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

Object.assign(process.env, { NODE_ENV: 'development', DATABASE_URL: 'postgresql://isolated:isolated@127.0.0.1:1/never-connect',
  SESSION_SECRET: 'isolated-family-tests-session-secret-0123456789012345', APP_ORIGIN: 'http://127.0.0.1:3000',
  SESSION_DRIVER: 'postgres', MAIL_MODE: 'file', DOTENV_CONFIG_PATH: fileURLToPath(new URL(`.family-tests-no-env-${process.pid}`, import.meta.url)) });
for (const name of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[name];
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { ProfileService, normalizeFamilyBackground } = require('../dist/profile.js');
const { ProfileDto } = require('../dist/dto.js');
const { TalentService, talentSearchWhere } = require('../dist/talent.js');
const { AdminController } = require('../dist/admin.js');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');

const empty = { fatherName: '', fatherOccupation: '', motherName: '', motherOccupation: '', guardianName: '', guardianRelationship: '', religion: '', siblings: null, additionalInformation: '' };
const sentinel = 'NeverPublicFamilySentinel';
function fixture(overrides = {}) {
  const userId = randomUUID();
  return { id: randomUUID(), userId, phone: '', city: 'Dhaka', objective: 'Develop useful products.', university: 'Example University',
    department: 'CSE', semester: '3', degree: 'BSc', passingYear: 2029, headline: 'Student developer', talentCategory: 'software-it',
    availability: 'OPEN_TO_OPPORTUNITIES', directoryPublished: false, socialLinks: {}, familyBackground: {}, activities: '',
    skills: [{ name: 'TypeScript' }], educations: [], updatedAt: new Date(),
    user: { id: userId, name: 'Family Test Student', email: 'isolated@example.test', passwordHash: 'never-used', role: 'STUDENT',
      status: 'ACTIVE', emailVerifiedAt: new Date(), authVersion: 0, profilePictureId: null, profilePicture: null, createdAt: new Date() },
    ...overrides };
}
function database(initial) {
  let row = structuredClone(initial), locked = false, queue = Promise.resolve();
  const calls = [];
  const db = { calls, get row() { return row; },
    studentProfile: {
      async upsert(options) { assert.equal(options.where.userId, row.userId); calls.push(['get', options]); return structuredClone(row); },
      async findUnique(options) { assert.equal(locked, true); assert.equal(options.where.userId, row.userId); calls.push(['read', options]); return structuredClone(row); },
      async update(options) {
        assert.equal(locked, true); assert.equal(options.where.userId, row.userId); calls.push(['update', structuredClone(options.data)]);
        const { skills, educations, ...fields } = options.data;
        Object.assign(row, structuredClone(fields));
        if (skills) row.skills = structuredClone(skills.create);
        if (educations) row.educations = structuredClone(educations.create);
        return structuredClone(row);
      },
    },
    async $queryRaw(strings, ...values) { assert.match(strings.join('?'), /FROM "StudentProfile".*FOR UPDATE/); assert.equal(values[0], row.userId); locked = true; calls.push(['lock']); return [{ id: row.id }]; },
    $transaction(operation) {
      const result = queue.then(async () => {
        const before = structuredClone(row);
        try { return await operation(db); } catch (error) { row = before; throw error; } finally { locked = false; }
      });
      queue = result.catch(() => undefined); return result;
    },
  };
  return db;
}
function validated(data) {
  const dto = plainToInstance(ProfileDto, data);
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true });
  assert.deepEqual(errors, []); return dto;
}

test('Old accounts always receive canonical optional family fields in the private profile', async () => {
  for (const value of [{}, undefined, null, [], 'legacy']) {
    const row = fixture({ familyBackground: value }), result = await new ProfileService(database(row)).get(row.userId);
    assert.deepEqual(result.familyBackground, empty);
  }
  assert.deepEqual(normalizeFamilyBackground({ fatherName: 'Existing parent', siblings: 2, unknown: 'ignored' }), { ...empty, fatherName: 'Existing parent', siblings: 2 });
  assert.deepEqual(normalizeFamilyBackground({ fatherName: 7, religion: 7, siblings: -1 }), empty);
});

test('Private family data saves under the existing owner row lock and trims strings', async () => {
  const row = fixture(), db = database(row), service = new ProfileService(db);
  const dto = validated({ familyBackground: { fatherName: '  Parent A  ', fatherOccupation: '  Teacher  ', motherName: ' Parent B ',
    motherOccupation: ' Engineer ', guardianName: ' Guardian ', guardianRelationship: ' Aunt ', religion: ' Personal belief ', siblings: 0, additionalInformation: ' Optional details ' } });
  const saved = await service.update(row.userId, dto);
  assert.deepEqual(saved.familyBackground, { fatherName: 'Parent A', fatherOccupation: 'Teacher', motherName: 'Parent B', motherOccupation: 'Engineer', guardianName: 'Guardian', guardianRelationship: 'Aunt', religion: 'Personal belief', siblings: 0, additionalInformation: 'Optional details' });
  assert.deepEqual(db.row.familyBackground, saved.familyBackground);
  assert.deepEqual((await service.get(row.userId)).familyBackground, saved.familyBackground);
  assert.equal(db.calls[0][0], 'lock'); assert.equal(saved.university, row.university); assert.deepEqual(saved.skills, ['TypeScript']);
});

test('Nested partial patches preserve unspecified values and allow explicit empty strings or null siblings', async () => {
  const current = { ...empty, fatherName: 'Keep father', fatherOccupation: 'Keep occupation', motherName: 'Keep mother', religion: 'Keep personal belief', siblings: 3, additionalInformation: 'Keep additional text' };
  const row = fixture({ familyBackground: current }), db = database(row), service = new ProfileService(db);
  const first = await service.update(row.userId, validated({ familyBackground: { guardianName: ' New guardian ' } }));
  assert.deepEqual(first.familyBackground, { ...current, guardianName: 'New guardian' });
  const second = await service.update(row.userId, validated({ familyBackground: { fatherName: '', religion: '', siblings: null } }));
  assert.deepEqual(second.familyBackground, { ...current, fatherName: '', religion: '', siblings: null, guardianName: 'New guardian' });
  const third = await service.update(row.userId, validated({ familyBackground: {} }));
  assert.deepEqual(third.familyBackground, second.familyBackground);
  const fourth = await service.update(row.userId, validated({ city: 'Sylhet' }));
  assert.deepEqual(fourth.familyBackground, second.familyBackground);
  const lastWrite = db.calls.filter(([name]) => name === 'update').at(-1)[1];
  assert.equal(Object.hasOwn(lastWrite, 'familyBackground'), false);
});

test('Concurrent family patches merge with the latest stored values instead of losing another edit', async () => {
  const row = fixture(), db = database(row), service = new ProfileService(db);
  await Promise.all([
    service.update(row.userId, validated({ familyBackground: { fatherName: 'Father value' } })),
    service.update(row.userId, validated({ familyBackground: { motherName: 'Mother value' } })),
  ]);
  assert.deepEqual(db.row.familyBackground, { ...empty, fatherName: 'Father value', motherName: 'Mother value' });
});

test('Family background adds no completion or public profile publication requirement', async () => {
  const row = fixture(), db = database(row), service = new ProfileService(db);
  const before = await service.get(row.userId), beforeCompletion = service.completion(before);
  const published = await service.update(row.userId, validated({ directoryPublished: true }));
  assert.equal(published.directoryPublished, true); assert.deepEqual(published.familyBackground, empty);
  const after = await service.update(row.userId, validated({ familyBackground: { fatherName: sentinel, religion: sentinel, siblings: 4 } }));
  assert.equal(service.completion(after), beforeCompletion); assert.equal(after.directoryPublished, true);
});

test('Strict nested validation rejects malformed objects, null strings, extra sensitive fields and limits', () => {
  const invalid = value => validateSync(plainToInstance(ProfileDto, { familyBackground: value }), { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }).length > 0;
  for (const value of [null, [], 'text', 1, true, { siblings: -1 }, { siblings: 51 }, { siblings: 1.5 }, { siblings: '2' },
    { income: 'unsupported' }, { religion: 7 }, { religion: [] }, { religion: {} }, { religion: true }, { nationalId: 'unsupported' }, { address: 'unsupported' }, { userId: randomUUID() }]) assert.equal(invalid(value), true);
  for (const key of ['fatherName', 'fatherOccupation', 'motherName', 'motherOccupation', 'guardianName', 'religion']) {
    assert.equal(invalid({ [key]: 'a'.repeat(101) }), true); assert.equal(invalid({ [key]: null }), true);
    validated({ familyBackground: { [key]: 'a'.repeat(100) } });
  }
  assert.equal(invalid({ guardianRelationship: 'a'.repeat(61) }), true); assert.equal(invalid({ guardianRelationship: null }), true);
  assert.equal(invalid({ additionalInformation: 'a'.repeat(1001) }), true); assert.equal(invalid({ additionalInformation: null }), true);
  validated({}); validated({ familyBackground: {} }); validated({ familyBackground: { siblings: null } });
  validated({ familyBackground: { siblings: 50, guardianRelationship: 'a'.repeat(60), additionalInformation: 'a'.repeat(1000) } });
});

function selected(row, projection) {
  return Object.fromEntries(Object.entries(projection).map(([key, rule]) => {
    if (rule === true) return [key, structuredClone(row[key])];
    const value = row[key];
    return [key, Array.isArray(value) ? value.slice(0, rule.take ?? value.length).map(item => selected(item, rule.select)) : value ? selected(value, rule.select) : null];
  }));
}

test('Public talent card, detail, metadata, search and admin student output exclude all family data', async () => {
  const row = fixture({ directoryPublished: true, familyBackground: { ...empty, fatherName: sentinel, religion: sentinel, additionalInformation: sentinel } });
  const calls = [];
  const db = {
    studentProfile: {
      async findMany(options) { calls.push(options); return [selected(row, options.select)]; },
      async findFirst(options) { calls.push(options); return selected(row, options.select); },
      async count(options) { calls.push(options); return 1; },
      async groupBy(options) { calls.push(options); return [{ talentCategory: row.talentCategory, _count: { _all: 1 } }]; },
    },
    skill: { async findMany(options) { calls.push(options); return [{ name: 'TypeScript' }]; } },
    user: { async findMany() { return [{ ...row.user, familyBackground: row.familyBackground, profile: row }]; }, async count() { return 1; } },
    async $transaction(operations) { return Promise.all(operations); },
  };
  const talent = new TalentService(db), admin = new AdminController(db);
  const outputs = await Promise.all([talent.list({}), talent.detail(row.userId), talent.meta(), admin.students({})]);
  const serialized = JSON.stringify(outputs);
  assert.equal(serialized.includes('religion'), false); assert.equal(serialized.includes('familyBackground'), false); assert.equal(serialized.includes(sentinel), false);
  assert.equal(JSON.stringify(calls).includes('familyBackground'), false);
  const searchPredicate = talentSearchWhere({ q: sentinel });
  assert.equal(JSON.stringify(searchPredicate).includes('familyBackground'), false);
  assert.equal(JSON.stringify(searchPredicate).includes('fatherName'), false);
  assert.equal(JSON.stringify(searchPredicate).includes('religion'), false);
});
