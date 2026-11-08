import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Compile in memory: these browser-helper tests need no server, build output,
// credentials, generated files or network access.
const source = await readFile(new URL('../../apps/web/src/lib/api.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { api, ApiError } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const token = 'a1'.repeat(32);
const unavailable = 'The server is temporarily unavailable. Please try again in a moment.';
const securityError = 'Unable to complete the security check. Please try again.';
const rateLimited = 'Too many attempts. Please wait a moment and try again.';
const privateMarker = 'private-upstream-body-must-not-be-displayed';

function mockFetch(t, responses) {
  const pending = [...responses];
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    assert.ok(pending.length, 'The helper made an unexpected extra request.');
    const response = pending.shift();
    if (response instanceof Error) throw response;
    return response;
  });
  return calls;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function errorIs(status, message) {
  return error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    assert.ok(!error.message.includes(privateMarker));
    return true;
  };
}

test('a plain-text CSRF 429 reports the rate limit and never submits the mutation', async t => {
  const calls = mockFetch(t, [new Response(privateMarker, { status: 429 })]);
  await assert.rejects(api('/auth/login', { method: 'POST', body: '{}' }), errorIs(429, rateLimited));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/v1/auth/csrf');
});

for (const status of [502, 503, 504]) {
  test(`CSRF ${status} reports temporary unavailability without submitting`, async t => {
    const calls = mockFetch(t, [new Response(`<html>${privateMarker}</html>`, { status })]);
    await assert.rejects(api('/profile', { method: 'PATCH', body: '{}' }), errorIs(status, unavailable));
    assert.equal(calls.length, 1);
  });
}

test('other CSRF failures retain the safe security-check error', async t => {
  const calls = mockFetch(t, [json({ message: privateMarker }, 403)]);
  await assert.rejects(api('/auth/login', { method: 'POST', body: '{}' }), errorIs(403, securityError));
  assert.equal(calls.length, 1);
});

test('a successful HTML CSRF response fails safely before mutation', async t => {
  const calls = mockFetch(t, [new Response(`<html>${privateMarker}</html>`, { status: 200 })]);
  await assert.rejects(api('/auth/login', { method: 'POST', body: '{}' }), errorIs(200, securityError));
  assert.equal(calls.length, 1);
});

for (const [label, value] of [
  ['null JSON', null], ['an array', [{ csrfToken: token }]], ['a scalar', token],
  ['a missing token', {}], ['a numeric token', { csrfToken: 123 }],
  ['an empty token', { csrfToken: '' }], ['a short token', { csrfToken: 'a'.repeat(63) }],
  ['a long token', { csrfToken: 'a'.repeat(65) }], ['a non-hex token', { csrfToken: 'g'.repeat(64) }],
  ['a token with whitespace', { csrfToken: ` ${token}` }],
  ['a token with a trailing newline', { csrfToken: `${token}\n` }],
]) {
  test(`CSRF 200 containing ${label} never submits the mutation`, async t => {
    const calls = mockFetch(t, [json(value)]);
    await assert.rejects(api('/auth/logout', { method: 'POST' }), errorIs(200, securityError));
    assert.equal(calls.length, 1);
  });
}

test('a valid token sends one authenticated mutation with the verified security header', async t => {
  const calls = mockFetch(t, [json({ csrfToken: token }), json({ saved: true })]);
  const body = JSON.stringify({ headline: 'Example student' });
  assert.deepEqual(await api('/profile', { method: 'patch', body, headers: { 'X-Example': 'retained' } }), { saved: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/v1/auth/csrf');
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[0].options.cache, 'no-store');
  const mutation = calls[1];
  assert.equal(mutation.url, '/api/v1/profile');
  assert.equal(mutation.options.method, 'PATCH');
  assert.equal(mutation.options.credentials, 'include');
  assert.equal(mutation.options.cache, 'no-store');
  assert.equal(mutation.options.body, body);
  assert.equal(mutation.options.headers.get('X-CSRF-Token'), token);
  assert.equal(mutation.options.headers.get('Content-Type'), 'application/json');
  assert.equal(mutation.options.headers.get('X-Example'), 'retained');
});

test('a read request skips the CSRF request', async t => {
  const calls = mockFetch(t, [json({ profile: {} })]);
  assert.deepEqual(await api('/profile'), { profile: {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/v1/profile');
  assert.equal(calls[0].options.method, 'GET');
});

test('an existing login error retains its friendly message after a valid security check', async t => {
  const calls = mockFetch(t, [json({ csrfToken: token }), json({ message: 'Invalid email or password, or account unavailable.' }, 401)]);
  await assert.rejects(api('/auth/login', { method: 'POST', body: '{}' }), errorIs(401, 'The email or password is incorrect, or this account is unavailable.'));
  assert.equal(calls.length, 2);
});

test('a mutation rate limit retains its existing message', async t => {
  mockFetch(t, [json({ csrfToken: token }), new Response(privateMarker, { status: 429 })]);
  await assert.rejects(api('/auth/login', { method: 'POST', body: '{}' }), errorIs(429, rateLimited));
});

test('a CSRF network failure remains a connection error and never submits', async t => {
  const calls = mockFetch(t, [new TypeError(privateMarker)]);
  await assert.rejects(api('/auth/login', { method: 'POST', body: '{}' }), errorIs(0, 'Unable to connect to the server. Check your connection and try again.'));
  assert.equal(calls.length, 1);
});
