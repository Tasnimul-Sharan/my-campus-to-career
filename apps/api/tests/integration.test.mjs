import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readdir, readFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const origin = process.env.TEST_API_ORIGIN || 'http://127.0.0.1:4000';
const base = origin.endsWith('/api/v1') ? origin : `${origin}/api/v1`;
const outbox = resolve(process.env.MAIL_OUTBOX_DIR || '../../.local/mail');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

class Client {
  cookies = new Map();
  csrfToken;
  async request(path, { method = 'GET', body, csrf = true, origin: requestOrigin } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && csrf) {
      if (!this.csrfToken) await this.request('/auth/csrf');
      headers['X-CSRF-Token'] = this.csrfToken;
    }
    headers.Cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    if (requestOrigin) headers.Origin = requestOrigin;
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of response.headers.getSetCookie()) {
      const part = cookie.split(';')[0], equals = part.indexOf('=');
      const key = part.slice(0, equals), value = part.slice(equals + 1);
      if (value) this.cookies.set(key, value); else this.cookies.delete(key);
    }
    const data = await response.json();
    if (data.csrfToken) this.csrfToken = data.csrfToken;
    return { status: response.status, data, headers: response.headers };
  }
}

async function findMail(email, route) {
  const paths = (await readdir(outbox)).filter(name => name.endsWith('.eml')).sort().reverse();
  for (const name of paths) {
    const content = await readFile(join(outbox, name), 'utf8');
    if (content.includes(`To: ${email}\n`) && content.includes(`/${route}?token=`)) {
      const match = content.match(/token=([a-f0-9]{64})/);
      assert.ok(match, 'Expected a one-time token in the development email file');
      return { token: match[1], name };
    }
  }
  throw new Error('Expected development email was not written.');
}

test('Phase 1 real PostgreSQL API security and workflows', async t => {
  assert.ok(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD, 'Local admin seed credentials are required.');
  assert.equal(process.env.MAIL_MODE || 'file', 'file', 'Integration tests require the local file email mode.');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const email = `integration-${suffix}@example.test`, email2 = `integration-second-${suffix}@example.test`;
  const password = 'Integration secret password 2026!';
  const resetPassword = 'A different integration password 2026!';
  const anonymous = new Client(), student = new Client(), second = new Client(), admin = new Client(), reset = new Client();
  const ids = [], mailNames = [];
  let studentId;
  try {
    await t.test('Health checks the connected database', async () => {
      const response = await anonymous.request('/health');
      assert.equal(response.status, 200); assert.equal(response.data.status, 'ok');
    });
    await t.test('Anonymous profile and admin access are rejected', async () => {
      assert.equal((await anonymous.request('/profile')).status, 401);
      assert.equal((await anonymous.request('/admin/summary')).status, 401);
    });
    await t.test('Browser mutations require a CSRF token and the allowed origin', async () => {
      assert.equal((await anonymous.request('/auth/register', { method: 'POST', body: { name: 'Blocked', email, password }, csrf: false })).status, 403);
      assert.equal((await anonymous.request('/auth/register', { method: 'POST', body: { name: 'Blocked', email, password }, origin: 'https://untrusted.example' })).status, 403);
    });
    await t.test('Registration creates an unverified student and rotates the session', async () => {
      await student.request('/auth/csrf');
      const before = student.cookies.get('campus.sid');
      const response = await student.request('/auth/register', { method: 'POST', body: { name: 'Integration Student', email: email.toUpperCase(), password } });
      assert.equal(response.status, 201);
      assert.equal(response.data.user.email, email); assert.equal(response.data.user.role, 'STUDENT'); assert.equal(response.data.user.emailVerified, false);
      assert.notEqual(student.cookies.get('campus.sid'), before);
      assert.ok(response.headers.getSetCookie().some(value => value.includes('HttpOnly') && value.includes('SameSite=Lax')));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.data.user.passwordHash, undefined); assert.equal(response.data.token, undefined);
      studentId = response.data.user.id; ids.push(studentId);
    });
    await t.test('Duplicate normalized email, unknown role fields and weak passwords are rejected', async () => {
      const duplicate = await anonymous.request('/auth/register', { method: 'POST', body: { name: 'Duplicate', email: email.toUpperCase(), password } });
      assert.equal(duplicate.status, 409);
      assert.equal((await anonymous.request('/auth/register', { method: 'POST', body: { name: 'Escalation', email: email2, password, role: 'ADMIN' } })).status, 400);
      assert.equal((await anonymous.request('/auth/register', { method: 'POST', body: { name: 'Weak', email: email2, password: 'short' } })).status, 400);
    });
    await t.test('Unverified students can edit their own profile and see completion', async () => {
      const response = await student.request('/profile', { method: 'PATCH', body: {
        city: 'Dhaka', objective: 'Build useful software.', university: 'Test University', department: 'CSE', semester: '1',
        degree: 'BSc', passingYear: 2030, phone: '+8801700000000', skills: ['TypeScript', 'Communication'],
        socialLinks: { github: 'https://github.com/example' }, activities: 'University coding club',
        educations: [{ institution: 'Test College', degree: 'HSC', field: 'Science', startYear: 2022, endYear: 2024 }],
      } });
      assert.equal(response.status, 200); assert.equal(response.data.profile.university, 'Test University');
      assert.deepEqual(response.data.profile.skills.sort(), ['Communication', 'TypeScript']);
      assert.equal((await student.request('/dashboard')).data.stats.profileCompletion, 100);
      assert.equal((await student.request('/profile')).data.profile.educations[0].institution, 'Test College');
    });
    await t.test('Malformed nested input, unsafe social URLs and ownership injection are rejected', async () => {
      assert.equal((await student.request('/profile', { method: 'PATCH', body: { socialLinks: { portfolio: 'javascript:alert(1)' } } })).status, 400);
      assert.equal((await student.request('/profile', { method: 'PATCH', body: { userId: randomUUID(), city: 'Hijacked' } })).status, 400);
      assert.equal((await student.request('/profile', { method: 'PATCH', body: { skills: ['TypeScript', 'typescript'] } })).status, 400);
      assert.equal((await student.request('/profile', { method: 'PATCH', body: { city: null } })).status, 400);
      assert.equal((await student.request('/profile', { method: 'PATCH', body: { educations: [{ institution: 'College', degree: 'HSC', field: 'Science', startYear: 2025, endYear: 2024 }] } })).status, 400);
    });
    await t.test('Student role cannot access administrator APIs', async () => {
      assert.equal((await student.request('/admin/summary')).status, 403);
      assert.equal((await student.request(`/admin/students/${studentId}/status`, { method: 'PATCH', body: { status: 'SUSPENDED' } })).status, 403);
    });
    await t.test('Email verification token is hashed, one-time and never returned by API', async () => {
      const mail = await findMail(email, 'verify-email'); mailNames.push(mail.name);
      const stored = await db.authToken.findFirst({ where: { userId: studentId, type: 'EMAIL_VERIFICATION' } });
      assert.ok(stored); assert.notEqual(stored.tokenHash, mail.token); assert.equal(stored.tokenHash.length, 64);
      await db.authToken.update({ where: { id: stored.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await student.request('/auth/verify-email', { method: 'POST', body: { token: mail.token } })).status, 400);
      await db.authToken.update({ where: { id: stored.id }, data: { expiresAt: stored.expiresAt } });
      assert.equal((await student.request('/auth/verify-email', { method: 'POST', body: { token: mail.token } })).status, 200);
      assert.equal((await student.request('/auth/me')).data.user.emailVerified, true);
      assert.equal((await student.request('/auth/verify-email', { method: 'POST', body: { token: mail.token } })).status, 400);
    });
    await t.test('Administrator can search, paginate and suspend a student', async () => {
      assert.equal((await admin.request('/auth/login', { method: 'POST', body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).status, 200);
      assert.equal((await admin.request('/admin/summary')).status, 200);
      const list = await admin.request(`/admin/students?search=${encodeURIComponent(email)}&page=1`);
      assert.equal(list.status, 200); assert.equal(list.data.total, 1); assert.equal(list.data.students[0].id, studentId);
      assert.equal(list.data.students[0].passwordHash, undefined);
      assert.equal((await admin.request('/admin/students?page=-1')).status, 400);
      assert.equal((await admin.request(`/admin/students/${studentId}/status`, { method: 'PATCH', body: { status: 'SUSPENDED' } })).status, 200);
      assert.equal((await student.request('/profile')).status, 401);
      assert.equal((await anonymous.request('/auth/login', { method: 'POST', body: { email, password } })).status, 401);
      assert.equal((await db.auditLog.count({ where: { targetId: studentId, action: 'STUDENT_STATUS_CHANGED' } })), 1);
      assert.equal((await admin.request(`/admin/students/${studentId}/status`, { method: 'PATCH', body: { status: 'ACTIVE' } })).status, 200);
      student.csrfToken = undefined;
      assert.equal((await student.request('/auth/login', { method: 'POST', body: { email, password } })).status, 200);
    });
    await t.test('Profiles remain private between two students', async () => {
      const response = await second.request('/auth/register', { method: 'POST', body: { name: 'Second Student', email: email2, password } });
      assert.equal(response.status, 201); ids.push(response.data.user.id);
      const profile = await second.request('/profile');
      assert.equal(profile.data.profile.university, ''); assert.deepEqual(profile.data.profile.skills, []);
      assert.equal((await second.request(`/profile/${studentId}`)).status, 404);
      const mail = await findMail(email2, 'verify-email'); mailNames.push(mail.name);
    });
    await t.test('Password reset responses hide account existence and invalidate existing sessions', async () => {
      const known = await reset.request('/auth/forgot-password', { method: 'POST', body: { email } });
      const unknown = await reset.request('/auth/forgot-password', { method: 'POST', body: { email: `absent-${suffix}@example.test` } });
      assert.equal(known.status, 200); assert.deepEqual(unknown.data, known.data);
      const mail = await findMail(email, 'reset-password'); mailNames.push(mail.name);
      assert.equal((await reset.request('/auth/reset-password', { method: 'POST', body: { token: mail.token, password: resetPassword } })).status, 200);
      assert.equal((await student.request('/auth/me')).status, 401);
      assert.equal((await reset.request('/auth/reset-password', { method: 'POST', body: { token: mail.token, password: resetPassword } })).status, 400);
      assert.equal((await reset.request('/auth/login', { method: 'POST', body: { email, password } })).status, 401);
      assert.equal((await reset.request('/auth/login', { method: 'POST', body: { email, password: resetPassword } })).status, 200);
    });
    await t.test('Logout destroys the session', async () => {
      assert.equal((await reset.request('/auth/logout', { method: 'POST', body: {} })).status, 200);
      assert.equal((await reset.request('/auth/me')).status, 401);
    });
  } finally {
    for (const client of [student, second, admin]) {
      try { client.csrfToken = undefined; await client.request('/auth/logout', { method: 'POST', body: {} }); } catch {}
    }
    const created = await db.user.findMany({ where: { email: { in: [email, email2] } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { targetId: { in: created.map(user => user.id) } } });
    await db.user.deleteMany({ where: { email: { in: [email, email2] } } });
    // Remove only email files addressed to accounts created by this run, including failures before token extraction.
    for (const name of await readdir(outbox).catch(() => [])) {
      if (!name.endsWith('.eml')) continue;
      const content = await readFile(join(outbox, name), 'utf8');
      if ([email, email2].some(address => content.includes(`To: ${address}\n`))) {
        try { await unlink(join(outbox, name)); } catch {}
      }
    }
    await db.$disconnect();
  }
});
