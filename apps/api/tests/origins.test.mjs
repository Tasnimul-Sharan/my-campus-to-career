import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { allowedAppOrigins, isAllowedRequestOrigin } = require('../dist/origins.js');

test('Development accepts exactly the configured loopback origin and its same-port host alias', () => {
  for (const [configured, alias] of [
    ['http://localhost:3000', 'http://127.0.0.1:3000'],
    ['http://127.0.0.1:3000', 'http://localhost:3000'],
    ['https://localhost:3443', 'https://127.0.0.1:3443'],
    ['http://localhost', 'http://127.0.0.1'],
  ]) {
    const origins = allowedAppOrigins(configured, 'development');
    assert.deepEqual(origins, [configured, alias]);
    assert.equal(isAllowedRequestOrigin(configured, origins), true);
    assert.equal(isAllowedRequestOrigin(alias, origins), true);
  }
});

test('Development rejects other ports, schemes, IPs, subdomains and lookalike hosts', () => {
  const origins = allowedAppOrigins('http://localhost:3000', 'development');
  for (const origin of [
    'http://localhost:3001', 'http://127.0.0.1:3001', 'http://localhost',
    'https://localhost:3000', 'https://127.0.0.1:3000', 'http://127.0.0.2:3000',
    'http://192.168.1.1:3000', 'http://[::1]:3000', 'http://0.0.0.0:3000',
    'http://localhost.attacker.test:3000', 'http://127.0.0.1.attacker.test:3000',
    'http://sub.localhost:3000', 'http://localhost.:3000',
  ]) assert.equal(isAllowedRequestOrigin(origin, origins), false, origin);
});

test('The same development rule adds no aliases for ordinary remote or IPv6 hosts', () => {
  for (const configured of ['https://campus.example', 'http://[::1]:3000', 'http://192.168.1.2:3000']) {
    assert.deepEqual(allowedAppOrigins(configured, 'development'), [configured]);
  }
});

test('Production accepts only its exact configured website and rejects loopback or other Vercel deployments', () => {
  const configured = 'https://my-campus-to-career.vercel.app';
  const origins = allowedAppOrigins(configured, 'production');
  assert.deepEqual(origins, [configured]);
  assert.equal(isAllowedRequestOrigin(configured, origins), true);
  for (const origin of [
    'http://localhost:3000', 'http://127.0.0.1:3000', 'https://localhost:3000',
    'https://my-campus-to-career-preview.vercel.app',
    'https://my-campus-to-career-random-tasnimulsharans-projects.vercel.app',
    'https://www.my-campus-to-career.vercel.app',
    'https://my-campus-to-career.vercel.app.attacker.test',
    'http://my-campus-to-career.vercel.app',
  ]) assert.equal(isAllowedRequestOrigin(origin, origins), false, origin);
  // Even a deliberately configured loopback production origin gets no alias.
  assert.deepEqual(allowedAppOrigins('https://localhost:3000', 'production'), ['https://localhost:3000']);
});

test('Unset, test and unknown environments do not gain development aliases', () => {
  for (const environment of [undefined, '', 'test', 'preview', 'Development']) {
    assert.deepEqual(allowedAppOrigins('http://localhost:3000', environment), ['http://localhost:3000']);
  }
});

test('Origin checks reject null, malformed values, credentials, paths and nonexact header variants', () => {
  const origins = allowedAppOrigins('http://localhost:3000', 'development');
  for (const origin of [
    null, undefined, [], {}, true, 3000, '', 'null', '*', 'localhost:3000',
    'http://user:password@localhost:3000', 'http://user@127.0.0.1:3000',
    'http://localhost:3000/', 'http://localhost:3000/login',
    ' http://localhost:3000', 'http://localhost:3000 ',
    'HTTP://LOCALHOST:3000', 'http://localhost:3000\r\n',
    'http://localhost:3000, http://attacker.test',
  ]) assert.equal(isAllowedRequestOrigin(origin, origins), false, JSON.stringify(origin));
});
