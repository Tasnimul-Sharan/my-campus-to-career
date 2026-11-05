import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

Object.assign(process.env, { NODE_ENV: 'development', DATABASE_URL: 'postgresql://isolated:isolated@127.0.0.1:1/never-connect',
  SESSION_SECRET: 'isolated-address-tests-session-secret-0123456789012345', APP_ORIGIN: 'http://127.0.0.1:3000',
  SESSION_DRIVER: 'postgres', MAIL_MODE: 'file', DOTENV_CONFIG_PATH: fileURLToPath(new URL(`.address-tests-no-env-${process.pid}`, import.meta.url)) });
for (const name of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[name];
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { ProfileService } = require('../dist/profile.js');
const { normalizeAddresses, BANGLADESH_DISTRICTS } = require('../dist/addresses.js');
const { ProfileDto } = require('../dist/dto.js');
const { TalentService, talentSearchWhere } = require('../dist/talent.js');
const { AdminController } = require('../dist/admin.js');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');
const blank = () => ({ streetAddress: '', postOffice: '', policeStation: '', district: '' });
const empty = () => ({ permanent: blank(), current: blank() });
const privateMarker = 'PrivateAddressSentinel';
const home = { streetAddress: 'C/O: Example Parent\nHouse 12, Example Village', postOffice: 'Example Post Office', policeStation: 'Example Police Station', district: 'Dhaka' };

function fixture(overrides = {}) {
  const userId = randomUUID();
  return { id: randomUUID(), userId, phone: '', city: 'Dhaka', objective: 'Build useful products.', university: 'Example University',
    department: 'CSE', semester: '3', degree: 'BSc', passingYear: 2029, cgpa: 3.8, cgpaScale: 4, headline: 'Student developer',
    talentCategory: 'software-it', talentCategories: ['software-it'], availability: 'OPEN_TO_OPPORTUNITIES', directoryPublished: false,
    socialLinks: { github: 'https://github.com/example' }, familyBackground: { religion: 'Private fixture' }, addresses: {}, activities: '',
    skills: [{ name: 'TypeScript' }], educations: [], updatedAt: new Date(),
    user: { id: userId, name: 'Synthetic Address Student', email: 'isolated@example.test', passwordHash: 'never-used', role: 'STUDENT',
      status: 'ACTIVE', emailVerifiedAt: new Date(), authVersion: 0, profilePictureId: null, profilePicture: null, createdAt: new Date() },
    ...overrides };
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

test('Legacy and malformed address JSON returns two independent, canonical optional addresses', async () => {
  for (const addresses of [undefined, null, {}, [], true, 'legacy']) {
    const { row, service } = setup({ addresses });
    assert.deepEqual((await service.get(row.userId)).addresses, empty());
  }
  assert.deepEqual(normalizeAddresses({ permanent: { ...home, unsupported: privateMarker }, current: { district: 'unsupported', streetAddress: 42 } }), { permanent: home, current: blank() });
  const normalized = normalizeAddresses(null); normalized.current.streetAddress = 'Current only';
  assert.equal(normalized.permanent.streetAddress, '');
});

test('Both addresses trim, preserve multiline street/C-O details, save and reload privately', async () => {
  const { row, db, service } = setup();
  const current = { streetAddress: 'Current House', postOffice: 'Current Post', policeStation: 'Current Station', district: 'Sylhet' };
  const saved = await service.update(row.userId, validated({ addresses: { permanent: Object.fromEntries(Object.entries(home).map(([key, value]) => [key, `  ${value}  `])), current } }));
  assert.deepEqual(saved.addresses, { permanent: home, current });
  assert.deepEqual(db.row.addresses, saved.addresses);
  assert.deepEqual((await service.get(row.userId)).addresses, saved.addresses);
  assert.equal(saved.familyBackground.religion, 'Private fixture');
  assert.equal(saved.cgpa, 3.8); assert.deepEqual(saved.socialLinks, { github: 'https://github.com/example' });
  assert.equal(saved.city, 'Dhaka');
});

test('Nested partial address edits preserve omitted fields and the other address, while empty strings clear', async () => {
  const original = { permanent: home, current: { ...home, district: 'Khulna', streetAddress: 'Current house' } };
  const { row, db, service } = setup({ addresses: original });
  const first = await service.update(row.userId, validated({ addresses: { permanent: { postOffice: ' Updated post ' } } }));
  assert.deepEqual(first.addresses, { ...original, permanent: { ...home, postOffice: 'Updated post' } });
  const second = await service.update(row.userId, validated({ addresses: { current: { district: '', streetAddress: '' }, permanent: {} } }));
  assert.deepEqual(second.addresses, { permanent: first.addresses.permanent, current: { ...original.current, district: '', streetAddress: '' } });
  assert.deepEqual((await service.update(row.userId, validated({ addresses: {} }))).addresses, second.addresses);
  assert.deepEqual((await service.update(row.userId, validated({ city: 'Rajshahi' }))).addresses, second.addresses);
  assert.equal(Object.hasOwn(db.writes.at(-1), 'addresses'), false);
  const cleared = await service.update(row.userId, validated({ addresses: empty() }));
  assert.deepEqual(cleared.addresses, empty());
});

test('Concurrent nested address edits merge under the profile owner row lock', async () => {
  const { row, db, service } = setup({ addresses: { permanent: home } });
  await Promise.all([
    service.update(row.userId, validated({ addresses: { permanent: { streetAddress: 'New permanent street' } } })),
    service.update(row.userId, validated({ addresses: { permanent: { district: 'Rajshahi' }, current: { postOffice: 'New current post' } } })),
  ]);
  assert.deepEqual(db.row.addresses, { permanent: { ...home, streetAddress: 'New permanent street', district: 'Rajshahi' }, current: { ...blank(), postOffice: 'New current post' } });
});

test('Address DTOs enforce optional string limits and reject nulls, malformed nesting and unknown fields', () => {
  for (const addresses of [null, [], true, 1, 'text', { permanent: null }, { current: [] }, { permanent: 'text' }, { country: 'unsupported' },
    { permanent: { latitude: 42 } }, { current: { streetAddress: null } }, { current: { postOffice: 7 } }, { current: { policeStation: [] } },
    { permanent: { district: {} } }, { permanent: { district: 'Unknown' } }, { permanent: { district: 'dhaka' } }]) {
    assert.ok(errors({ addresses }).length > 0, JSON.stringify(addresses));
  }
  for (const [key, limit] of [['streetAddress', 300], ['postOffice', 100], ['policeStation', 100]]) {
    validated({ addresses: { permanent: { [key]: 'a'.repeat(limit) } } });
    assert.ok(errors({ addresses: { permanent: { [key]: 'a'.repeat(limit + 1) } } }).length > 0);
    for (const value of [null, true, 1, [], {}]) assert.ok(errors({ addresses: { current: { [key]: value } } }).length > 0);
  }
  validated({}); validated({ addresses: {} }); validated({ addresses: empty() });
});

test('All 64 unique Bangladesh districts are accepted for either optional address', () => {
  assert.equal(BANGLADESH_DISTRICTS.length, 64); assert.equal(new Set(BANGLADESH_DISTRICTS).size, 64);
  for (const district of BANGLADESH_DISTRICTS) validated({ addresses: { permanent: { district }, current: { district } } });
  validated({ addresses: { current: { district: '  Dhaka  ' } } });
  validated({ addresses: { permanent: { district: '' } } });
});

test('Private addresses change neither profile completion nor publication requirements', async () => {
  const { row, service } = setup();
  const before = await service.get(row.userId), completion = service.completion(before);
  const published = await service.update(row.userId, validated({ directoryPublished: true }));
  assert.equal(published.directoryPublished, true); assert.deepEqual(published.addresses, empty());
  const saved = await service.update(row.userId, validated({ addresses: { permanent: home, current: home } }));
  assert.equal(saved.directoryPublished, true); assert.equal(service.completion(saved), completion);
});

function selected(row, projection) {
  return Object.fromEntries(Object.entries(projection).map(([key, rule]) => {
    if (rule === true) return [key, structuredClone(row[key])];
    const value = row[key];
    return [key, Array.isArray(value) ? value.slice(0, rule.take ?? value.length).map(item => selected(item, rule.select)) : value ? selected(value, rule.select) : null];
  }));
}

test('Public talent cards, detail, metadata, search and admin list never select or expose private addresses', async () => {
  const marked = { ...home, streetAddress: privateMarker, postOffice: privateMarker, policeStation: privateMarker };
  const row = fixture({ directoryPublished: true, addresses: { permanent: marked, current: marked } }), calls = [];
  const db = {
    studentProfile: {
      async findMany(options) { calls.push(options); return [selected(row, options.select)]; },
      async findFirst(options) { calls.push(options); return selected(row, options.select); },
      async count(options) { calls.push(options); return 1; },
    },
    skill: { async findMany(options) { calls.push(options); return [{ name: 'TypeScript' }]; } },
    user: { async findMany() { return [{ ...row.user, addresses: row.addresses, profile: row }]; }, async count() { return 1; } },
    async $transaction(operations) { return Promise.all(operations); },
  };
  const talent = new TalentService(db), admin = new AdminController(db);
  const serialized = JSON.stringify(await Promise.all([talent.list({}), talent.detail(row.userId), talent.meta(), admin.students({})]));
  for (const forbidden of ['addresses', 'streetAddress', 'postOffice', 'policeStation', privateMarker]) assert.equal(serialized.includes(forbidden), false);
  assert.equal(JSON.stringify(calls).includes('addresses'), false);
  const predicates = JSON.stringify(talentSearchWhere({ q: privateMarker }));
  for (const forbidden of ['addresses', 'streetAddress', 'postOffice', 'policeStation']) assert.equal(predicates.includes(forbidden), false);
});
