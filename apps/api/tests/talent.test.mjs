import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// These tests never connect to a database, provider, or existing environment file.
Object.assign(process.env, { NODE_ENV: 'development', DATABASE_URL: 'postgresql://isolated:isolated@127.0.0.1:1/never-connect',
  SESSION_SECRET: 'isolated-talent-tests-session-secret-0123456789012345', APP_ORIGIN: 'http://127.0.0.1:3000',
  SESSION_DRIVER: 'postgres', MAIL_MODE: 'file', DOTENV_CONFIG_PATH: fileURLToPath(new URL(`.talent-tests-no-env-${process.pid}`, import.meta.url)) });
for (const name of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[name];
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { TalentService, publicTalentWhere, talentSearchWhere, safePublicLinks } = require('../dist/talent.js');
const { ProfileService } = require('../dist/profile.js');
const { ProfileDto, TalentQueryDto } = require('../dist/dto.js');
const { TALENT_CATEGORIES } = require('../dist/talent-categories.js');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');

function fixture(overrides = {}) {
  const userId = randomUUID();
  const profile = { id: randomUUID(), userId, phone: '+880-private-phone', city: 'Dhaka', objective: 'Build accessible web products.',
    headline: 'Frontend developer', talentCategory: 'software-it', availability: 'INTERNSHIP', directoryPublished: true,
    university: 'Example University', department: 'CSE', semester: '3', degree: 'BSc', passingYear: 2029,
    socialLinks: { github: 'https://github.com/example' }, activities: 'Coding club', updatedAt: new Date('2026-10-25T00:00:00Z'),
    skills: [{ name: 'TypeScript' }, { name: 'Communication' }], educations: [{ institution: 'Example College', degree: 'HSC', field: 'Science', startYear: 2020, endYear: 2022 }],
    user: { id: userId, name: 'Talent Student', email: 'private-student@example.test', passwordHash: 'private-password-hash',
      role: 'STUDENT', status: 'ACTIVE', emailVerifiedAt: new Date(), profilePictureId: null, profilePicture: null, documents: [{ private: true }] },
  };
  return { ...profile, ...overrides, user: { ...profile.user, ...(overrides.user || {}) } };
}

function matches(row, where = {}) {
  if (!row) return false;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return condition.every(item => matches(row, item));
    if (key === 'OR') return condition.some(item => matches(row, item));
    const value = row[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('is' in condition) return matches(value, condition.is);
      if ('some' in condition) return Array.isArray(value) && value.some(item => matches(item, condition.some));
      if ('not' in condition && value === condition.not) return false;
      if ('in' in condition && !condition.in.includes(value)) return false;
      if ('equals' in condition) return condition.mode === 'insensitive' ? String(value).toLowerCase() === condition.equals.toLowerCase() : value === condition.equals;
      if ('contains' in condition) {
        const literal = condition.contains.replace(/\\([\\%_])/g, '$1');
        return String(value).toLowerCase().includes(literal.toLowerCase());
      }
      return true;
    }
    return value === condition;
  });
}
function sort(rows, orderBy = []) {
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      const [key, direction] = Object.entries(clause)[0];
      const comparison = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
      if (comparison) return direction === 'desc' ? -comparison : comparison;
    }
    return 0;
  });
}
function select(row, selection) {
  return Object.fromEntries(Object.entries(selection).map(([key, rule]) => {
    if (rule === true) return [key, structuredClone(row[key])];
    const value = row[key];
    if (Array.isArray(value)) return [key, sort(value, rule.orderBy).slice(0, rule.take ?? value.length).map(item => select(item, rule.select))];
    return [key, value ? select(value, rule.select) : null];
  }));
}
function selectedRows(rows, options) {
  let result = sort(rows.filter(row => matches(row, options.where)), options.orderBy);
  if (options.distinct) {
    const seen = new Set();
    result = result.filter(row => {
      const key = options.distinct.map(field => row[field]).join('|');
      if (seen.has(key)) return false; seen.add(key); return true;
    });
  }
  return result.slice(options.skip || 0, (options.skip || 0) + (options.take ?? result.length)).map(row => select(row, options.select));
}
function database(initial) {
  const rows = structuredClone(initial), calls = [];
  let locked = false, queue = Promise.resolve();
  const db = { rows, calls,
    studentProfile: {
      async findMany(options) { calls.push(['findMany', options]); return selectedRows(rows, options); },
      async findFirst(options) { calls.push(['findFirst', options]); return selectedRows(rows, { ...options, take: 1 })[0] || null; },
      async count(options) { calls.push(['count', options]); return rows.filter(row => matches(row, options.where)).length; },
      async groupBy(options) {
        calls.push(['groupBy', options]);
        const groups = new Map();
        for (const row of rows.filter(item => matches(item, options.where))) groups.set(row.talentCategory, (groups.get(row.talentCategory) || 0) + 1);
        return [...groups].map(([talentCategory, count]) => ({ talentCategory, _count: { _all: count } }));
      },
      async findUnique({ where }) { assert.equal(locked, true); calls.push(['findUnique', where]); return structuredClone(rows.find(row => row.userId === where.userId)) || null; },
      async update({ where, data }) {
        assert.equal(locked, true); calls.push(['update', data]);
        const row = rows.find(item => item.userId === where.userId);
        if (!row) throw new Error('Missing test profile');
        const { skills, educations, ...fields } = data;
        Object.assign(row, fields);
        if (skills) row.skills = structuredClone(skills.create);
        if (educations) row.educations = structuredClone(educations.create);
        return structuredClone(row);
      },
    },
    skill: { async findMany(options) {
      calls.push(['skills', options]);
      const skills = rows.flatMap(profile => profile.skills.map(skill => ({ ...skill, profile })));
      return selectedRows(skills, options);
    } },
    async $queryRaw(strings, ...values) { assert.match(strings.join('?'), /FROM "StudentProfile".*FOR UPDATE/); calls.push(['lock', values[0]]); locked = true; return []; },
    $transaction(operation) {
      if (Array.isArray(operation)) return Promise.all(operation);
      const result = queue.then(async () => {
        try { return await operation(db); } finally { locked = false; }
      });
      queue = result.catch(() => undefined);
      return result;
    },
  };
  return db;
}

test('Public listing excludes every ineligible account and projects only public card fields', async () => {
  const publicStudent = fixture();
  const db = database([publicStudent, fixture({ directoryPublished: false }), fixture({ user: { status: 'SUSPENDED' } }),
    fixture({ user: { emailVerifiedAt: null } }), fixture({ user: { role: 'ADMIN' } }), fixture({ talentCategory: '' }),
    fixture({ university: '' }), fixture({ department: '' }), fixture({ objective: '' }), fixture({ skills: [] })]);
  const result = await new TalentService(db).list({});
  assert.equal(result.total, 1); assert.equal(result.students[0].id, publicStudent.userId);
  assert.deepEqual(Object.keys(result.students[0]).sort(), ['id', 'name', 'headline', 'category', 'university', 'department', 'city', 'skills', 'availability', 'objective', 'profilePictureUrl'].sort());
  assert.equal(result.students[0].profilePictureUrl, null);
  const serialized = JSON.stringify(result);
  for (const secret of ['private-student@example.test', 'private-password-hash', 'private-phone', 'documents', 'socialLinks', 'educations', publicStudent.id]) assert.ok(!serialized.includes(secret));
  const projection = db.calls.find(([name]) => name === 'findMany')[1].select;
  assert.equal(projection.phone, undefined); assert.equal(projection.user.select.email, undefined);
  assert.equal(projection.user.select.passwordHash, undefined); assert.equal(projection.user.select.documents, undefined);
  assert.equal(projection.skills.take, 20);
});

test('Every selected filter is ANDed, while keyword search matches only public fields', async () => {
  const match = fixture();
  const db = database([match, fixture({ city: 'Sylhet' }), fixture({ department: 'EEE' }), fixture({ talentCategory: 'engineering' }),
    fixture({ availability: 'FULL_TIME' }), fixture({ university: 'Other University' }), fixture({ skills: [{ name: 'Excel' }] })]);
  const service = new TalentService(db);
  const result = await service.list({ category: 'software-it', subject: 'cse', university: 'example university', city: 'dhaka', skill: 'typescript', availability: 'INTERNSHIP', q: 'frontend' });
  assert.equal(result.total, 1); assert.equal(result.students[0].id, match.userId);
  assert.equal((await service.list({ q: 'private-student@example.test' })).total, 0);
  const predicate = talentSearchWhere({ q: '100%_\\' });
  assert.equal(predicate.AND[1].OR[0].user.is.name.contains, '100\\%\\_\\\\');
  assert.deepEqual(predicate.AND[0], publicTalentWhere());
});

test('Listing enforces fixed pagination, deterministic ordering and empty-state counts', async () => {
  const db = database(Array.from({ length: 20 }, (_, index) => fixture({ headline: `Student ${index}` })));
  const service = new TalentService(db), first = await service.list({ page: 1 }), second = await service.list({ page: 2 });
  assert.equal(first.pageSize, 9); assert.equal(first.total, 20); assert.equal(first.totalPages, 3); assert.equal(second.students.length, 9);
  assert.equal(new Set([...first.students, ...second.students].map(student => student.id)).size, 18);
  const query = db.calls.filter(([name]) => name === 'findMany')[1][1];
  assert.equal(query.take, 9); assert.equal(query.skip, 9); assert.deepEqual(query.orderBy, [{ updatedAt: 'desc' }, { userId: 'asc' }]);
  const empty = await service.list({ city: 'Absent City' }); assert.equal(empty.total, 0); assert.equal(empty.totalPages, 0); assert.deepEqual(empty.students, []);
});

test('Metadata counts only eligible profiles and bounds every filter option list', async () => {
  const eligible = Array.from({ length: 120 }, (_, index) => fixture({ university: `University ${String(index).padStart(3, '0')}`, department: index % 2 ? 'cse' : 'CSE', city: `City ${index}`, skills: [{ name: `Skill ${index}` }] }));
  const db = database([...eligible, fixture({ directoryPublished: false, university: 'Private University', city: 'Private City' }), fixture({ user: { status: 'SUSPENDED' } })]);
  const result = await new TalentService(db).meta();
  assert.equal(result.totalStudents, 120); assert.equal(result.categories.find(category => category.slug === 'software-it').count, 120);
  assert.equal(result.categories.length, TALENT_CATEGORIES.length); assert.equal(result.categories.find(category => category.slug === 'engineering').count, 0);
  assert.deepEqual(result.subjects.map(value => value.toLowerCase()), ['cse']);
  for (const key of ['universities', 'cities', 'skills']) assert.equal(result[key].length, 100);
  assert.ok(!JSON.stringify(result).includes('Private University')); assert.ok(!JSON.stringify(result).includes('Private City'));
  for (const [name, query] of db.calls.filter(([name]) => ['findMany', 'skills'].includes(name))) {
    assert.equal(query.take, 100); assert.ok(query.distinct.length); assert.ok(query.orderBy);
    const serialized = JSON.stringify(query.where);
    assert.ok(serialized.includes('directoryPublished')); assert.ok(serialized.includes('emailVerifiedAt')); assert.ok(serialized.includes('STUDENT')); assert.ok(serialized.includes('ACTIVE'));
  }
});

test('Public detail exposes consented content with safe links and hides private or revoked profiles', async () => {
  const student = fixture({ objective: 'A'.repeat(500), socialLinks: { github: 'https://github.com/example', linkedin: 'javascript:alert(1)', portfolio: 'https://user:secret@example.test', secret: 'private value' } });
  const db = database([student]), service = new TalentService(db);
  const detail = await service.detail(student.userId);
  assert.equal(detail.student.objective.length, 500); assert.equal(detail.student.educations[0].institution, 'Example College');
  assert.deepEqual(detail.student.socialLinks, { github: 'https://github.com/example' });
  assert.equal((await service.list({})).students[0].objective.length, 180);
  for (const forbidden of ['phone', 'email', 'passwordHash', 'documents', 'directoryPublished', 'profilePictureId', 'cloudinaryPublicId']) assert.equal(detail.student[forbidden], undefined);
  const projection = db.calls.find(([name]) => name === 'findFirst')[1].select;
  assert.equal(projection.educations.take, 10);
  for (const mutation of [row => { row.directoryPublished = false; }, row => { row.user.status = 'SUSPENDED'; }, row => { row.user.emailVerifiedAt = null; }, row => { row.user.role = 'ADMIN'; }]) {
    db.rows[0] = structuredClone(student); mutation(db.rows[0]);
    await assert.rejects(service.detail(student.userId), error => error.getStatus() === 404);
  }
  await assert.rejects(service.detail(randomUUID()), error => error.getStatus() === 404);
  assert.deepEqual(safePublicLinks(null), {}); assert.deepEqual(safePublicLinks([]), {});
});

test('Profile publication validates verified ownership and combined required values', async () => {
  for (const user of [{ emailVerifiedAt: null }, { status: 'SUSPENDED' }, { role: 'ADMIN' }]) {
    const row = fixture({ directoryPublished: false, user }), db = database([row]);
    await assert.rejects(new ProfileService(db).update(row.userId, { directoryPublished: true }), error => error.getStatus() === 403);
    assert.equal(db.calls.some(([name]) => name === 'update'), false);
  }
  for (const patch of [{ university: '' }, { department: '' }, { objective: '' }, { skills: [] }, { talentCategory: '' }]) {
    const row = fixture({ directoryPublished: false, ...patch }), db = database([row]);
    await assert.rejects(new ProfileService(db).update(row.userId, { directoryPublished: true }), error => error.getStatus() === 400);
    assert.equal(db.calls.some(([name]) => name === 'update'), false);
  }
  const row = fixture({ directoryPublished: false, university: '', department: '', objective: '', skills: [], talentCategory: '' }), db = database([row]);
  const saved = await new ProfileService(db).update(row.userId, { directoryPublished: true, university: 'New University', department: 'EEE', objective: 'Build useful systems.', skills: ['CAD'], talentCategory: 'engineering' });
  assert.equal(saved.directoryPublished, true); assert.equal(saved.talentCategory, 'engineering'); assert.deepEqual(saved.skills, ['CAD']);
  assert.equal(db.calls[0][0], 'lock');
});

test('Partial private drafts and explicit unpublishing remain available; published incomplete edits are rejected', async () => {
  const row = fixture({ directoryPublished: false, university: '', user: { emailVerifiedAt: null } }), db = database([row]), service = new ProfileService(db);
  const draft = await service.update(row.userId, { headline: 'Finding my direction' }); assert.equal(draft.directoryPublished, false);
  db.rows[0] = fixture({ userId: row.userId, directoryPublished: true, user: { id: row.userId } });
  await assert.rejects(service.update(row.userId, { university: '' }), error => error.getStatus() === 400);
  db.rows[0].user.emailVerifiedAt = null;
  const privateAgain = await service.update(row.userId, { directoryPublished: false, university: '', skills: [], talentCategory: '' });
  assert.equal(privateAgain.directoryPublished, false); assert.equal(privateAgain.university, '');
});

test('Concurrent publishing and completeness removal are serialized under the profile row lock', async () => {
  const row = fixture({ directoryPublished: false }), db = database([row]), service = new ProfileService(db);
  const results = await Promise.allSettled([service.update(row.userId, { directoryPublished: true }), service.update(row.userId, { university: '' })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal(db.rows[0].directoryPublished, true); assert.equal(db.rows[0].university, 'Example University');
});

test('Transformed partial DTOs preserve existing publication and completeness requirements', async () => {
  const row = fixture(), db = database([row]), service = new ProfileService(db);
  const clearRequiredField = plainToInstance(ProfileDto, { university: '' });
  assert.equal(clearRequiredField.directoryPublished, undefined);
  await assert.rejects(service.update(row.userId, clearRequiredField), error => error.getStatus() === 400);
  const editHeadline = await service.update(row.userId, plainToInstance(ProfileDto, { headline: 'Updated student headline' }));
  assert.equal(editHeadline.directoryPublished, true); assert.equal(editHeadline.university, 'Example University');
  assert.equal(editHeadline.headline, 'Updated student headline');
});

test('DTO validation rejects unbounded, malformed, unknown and privacy-changing input', () => {
  const errors = (Dto, data) => validateSync(plainToInstance(Dto, data), { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true });
  for (const data of [{ page: 0 }, { page: 1.5 }, { page: 10001 }, { q: 'x'.repeat(101) }, { category: 'any-role' }, { availability: 'UNKNOWN' }, { pageSize: 1000 }, { email: 'private@example.test' }, { city: ['Dhaka'] }]) assert.ok(errors(TalentQueryDto, data).length);
  for (const data of [{ headline: 'x'.repeat(121) }, { talentCategory: null }, { availability: null }, { directoryPublished: 'true' }, { userId: randomUUID() }, { directoryPublished: null }]) assert.ok(errors(ProfileDto, data).length);
  assert.deepEqual(errors(TalentQueryDto, { page: '2', category: 'software-it', subject: ' CSE ', q: '' }), []);
  assert.deepEqual(errors(ProfileDto, { headline: '', talentCategory: '', availability: 'OPEN_TO_OPPORTUNITIES', directoryPublished: false }), []);
});

test('Public social links expose only bounded safe fixed and additional label/URL fields', () => {
  const result = safePublicLinks({ github: ' https://github.com/example ', secret: 'never-public', additional: [
    { label: ' Behance ', url: ' https://www.behance.net/example ', familyBackground: 'never-public', token: 'never-public' },
    { label: '<strong>My channel</strong>', url: 'https://www.youtube.com/@example' },
  ] });
  assert.deepEqual(result, { github: 'https://github.com/example', additional: [
    { label: 'Behance', url: 'https://www.behance.net/example' },
    { label: '<strong>My channel</strong>', url: 'https://www.youtube.com/@example' },
  ] });
  assert.equal(JSON.stringify(result).includes('never-public'), false);
  for (const item of [null, [], 'text', {}, { label: ' ', url: 'https://example.test' },
    { label: 'x'.repeat(41), url: 'https://example.test' }, { label: 'Unsafe', url: 'javascript:alert(1)' },
    { label: 'Unsafe', url: 'data:text/html,secret' }, { label: 'Unsafe', url: '//example.test' },
    { label: 'Unsafe', url: 'https://user:secret@example.test' }, { label: 'Unsafe', url: 'https://example.test/\nsecret' },
    { label: 'Unsafe', url: 'https://example.test/' + 'x'.repeat(500) }, { label: 'Unsafe', url: 8 },
    { label: 8, url: 'https://example.test' }]) assert.deepEqual(safePublicLinks({ additional: [item] }), {});
  for (const additional of [null, false, {}, 'text']) assert.deepEqual(safePublicLinks({ additional }), {});
  const many = Array.from({ length: 10 }, (_, index) => ({ label: `Site ${index}`, url: `https://example.test/${index}` }));
  assert.deepEqual(safePublicLinks({ additional: many }).additional, many.slice(0, 8));
});

test('Public detail shares optional numeric CGPA including zero and both scales, while legacy blanks remain optional', async () => {
  const student = fixture({ cgpa: 0, cgpaScale: 4, familyBackground: { religion: 'private-family-value' }, educations: [
    { institution: 'Example College', degree: 'HSC', field: 'Science', startYear: 2020, endYear: 2022, cgpa: 5, cgpaScale: 5 },
    { institution: 'Example Academy', degree: 'Certificate', field: '', startYear: null, endYear: null },
  ], socialLinks: { additional: [{ label: 'Behance', url: 'https://www.behance.net/example' }] } });
  const db = database([student]), service = new TalentService(db);
  const detail = await service.detail(student.userId);
  assert.equal(detail.student.cgpa, 0); assert.equal(detail.student.cgpaScale, 4);
  assert.equal(detail.student.educations[0].cgpa, 5); assert.equal(detail.student.educations[0].cgpaScale, 5);
  assert.equal(detail.student.educations[1].cgpa, null); assert.equal(detail.student.educations[1].cgpaScale, 4);
  assert.deepEqual(detail.student.socialLinks.additional, [{ label: 'Behance', url: 'https://www.behance.net/example' }]);
  assert.equal(JSON.stringify(detail).includes('private-family-value'), false);
  assert.equal(detail.student.familyBackground, undefined);
  const projection = db.calls.find(([name]) => name === 'findFirst')[1].select;
  assert.equal(projection.cgpa, true); assert.equal(projection.cgpaScale, true);
  assert.equal(projection.educations.select.cgpa, true); assert.equal(projection.educations.select.cgpaScale, true);
  db.rows[0].cgpa = null;
  assert.equal((await service.detail(student.userId)).student.cgpa, null);
  delete db.rows[0].cgpa; delete db.rows[0].cgpaScale;
  const legacy = (await service.detail(student.userId)).student;
  assert.equal(legacy.cgpa, null); assert.equal(legacy.cgpaScale, 4);
  db.rows[0].cgpa = 4.75; db.rows[0].cgpaScale = 5;
  assert.equal((await service.detail(student.userId)).student.cgpa, 4.75);
  db.rows[0].cgpaScale = 4;
  assert.equal((await service.detail(student.userId)).student.cgpa, null);
});

test('Grades and extra social links do not enter public cards, search fields or metadata filters', async () => {
  const student = fixture({ cgpa: 3.75, cgpaScale: 4, socialLinks: { additional: [{ label: 'OnlyThisSocialLabel', url: 'https://example.test/social' }] } });
  const db = database([student]), service = new TalentService(db);
  const listing = await service.list({});
  assert.equal(listing.students[0].cgpa, undefined); assert.equal(listing.students[0].cgpaScale, undefined);
  assert.equal(listing.students[0].socialLinks, undefined);
  assert.equal((await service.list({ q: 'OnlyThisSocialLabel' })).total, 0);
  assert.equal((await service.list({ q: '3.75' })).total, 0);
  const cardProjection = db.calls.find(([name]) => name === 'findMany')[1].select;
  assert.equal(cardProjection.cgpa, undefined); assert.equal(cardProjection.cgpaScale, undefined);
  const metadata = await service.meta();
  assert.equal(JSON.stringify(metadata).includes('OnlyThisSocialLabel'), false);
  assert.equal(metadata.cgpa, undefined); assert.equal(metadata.cgpaScale, undefined);
  const search = JSON.stringify(talentSearchWhere({ q: 'optional grade' }));
  assert.equal(search.includes('cgpa'), false); assert.equal(search.includes('socialLinks'), false);
});
