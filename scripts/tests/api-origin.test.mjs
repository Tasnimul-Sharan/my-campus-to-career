import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApiOrigin } from '../../apps/web/config/api-origin.mjs';

test('Local development keeps its default API and explicit port overrides', () => {
  assert.equal(resolveApiOrigin({}), 'http://127.0.0.1:4000');
  assert.equal(resolveApiOrigin({ VERCEL: '0' }), 'http://127.0.0.1:4000');
  assert.equal(resolveApiOrigin({ API_ORIGIN: 'http://127.0.0.1:4001' }), 'http://127.0.0.1:4001');
  assert.equal(resolveApiOrigin({ API_ORIGIN: 'http://127.0.0.1:4001/' }), 'http://127.0.0.1:4001');
});

test('Vercel accepts a public HTTPS origin with an optional trailing slash', () => {
  for (const API_ORIGIN of ['https://api.example.com', 'https://api.example.com/']) {
    assert.equal(resolveApiOrigin({ VERCEL: '1', API_ORIGIN }), 'https://api.example.com');
  }
  assert.equal(resolveApiOrigin({ VERCEL: '1', API_ORIGIN: 'https://api.example.com:4443/' }), 'https://api.example.com:4443');
});

test('Vercel requires an API origin instead of falling back to localhost', () => {
  for (const API_ORIGIN of [undefined, '', '   ']) {
    assert.throws(() => resolveApiOrigin({ VERCEL: '1', API_ORIGIN }), /API_ORIGIN is required.*Vercel.*HTTPS/);
  }
});

test('Vercel rejects local servers and origins that would produce an invalid API rewrite', async t => {
  const invalid = [
    'not-a-url',
    'http://api.example.com',
    'https://localhost',
    'https://localhost:4001',
    'https://localhost.',
    'https://api.localhost',
    'https://127.0.0.1',
    'https://127.0.0.2:4001',
    'https://127.1',
    'https://[::1]',
    'https://[0:0:0:0:0:0:0:1]',
    'https://0.0.0.0',
    'https://[::]',
    'https://api.example.com/api/v1',
    'https://api.example.com/api/v1/',
    'https://api.example.com/another-path',
    'https://api.example.com/api/..',
    'https://api.example.com//',
    'https://user:password@api.example.com',
    'https://api.example.com?region=test',
    'https://api.example.com?',
    'https://api.example.com#api',
    'https://api.example.com#',
  ];
  for (const API_ORIGIN of invalid) {
    await t.test(API_ORIGIN, () => {
      assert.throws(() => resolveApiOrigin({ VERCEL: '1', API_ORIGIN }), /API_ORIGIN on Vercel.*HTTPS/);
    });
  }
});

test('Configuration errors never echo credentials or query values', () => {
  const API_ORIGIN = 'https://private-user:private-api-secret@api.example.com/api/v1?token=private-api-token';
  assert.throws(() => resolveApiOrigin({ VERCEL: '1', API_ORIGIN }), error => {
    assert.match(error.message, /API_ORIGIN/);
    for (const secret of ['private-user', 'private-api-secret', 'private-api-token', API_ORIGIN]) {
      assert.ok(!error.message.includes(secret));
    }
    return true;
  });
});

test('Vercel rejects an API origin that points to either provided frontend hostname', async t => {
  for (const variable of ['VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    for (const value of ['campus.example.com', 'https://campus.example.com', 'https://campus.example.com/']) {
      await t.test(`${variable}: ${value}`, () => {
        assert.throws(() => resolveApiOrigin({
          VERCEL: '1', API_ORIGIN: 'https://campus.example.com/', [variable]: value,
        }), /API_ORIGIN.*backend.*recursive frontend rewrites/);
      });
    }
  }
});

test('Vercel permits a separate backend without guessing other frontend aliases', () => {
  const frontend = { VERCEL: '1', VERCEL_URL: 'campus-preview.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'https://campus.example.com' };
  assert.equal(resolveApiOrigin({ ...frontend, API_ORIGIN: 'https://campus-api.onrender.com' }), 'https://campus-api.onrender.com');
  assert.equal(resolveApiOrigin({ ...frontend, API_ORIGIN: 'https://another-campus.vercel.app' }), 'https://another-campus.vercel.app');
});
