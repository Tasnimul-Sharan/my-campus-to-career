import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GMAIL_SEND_SCOPE, GmailAuthorizationError, parseDesktopClient, createGoogleAuthorization,
  receiveGoogleAuthorization, exchangeGoogleAuthorization,
} from '../lib/gmail-oauth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const local = join(root, '.local');
const cli = join(root, 'scripts', 'gmail-authorize.mjs');
const runFile = promisify(execFile);
const client = { clientId: 'fake-client.apps.googleusercontent.com', clientSecret: 'private-client-secret-marker' };
const grant = { code: 'private-authorization-code-marker', verifier: 'private-pkce-verifier-marker', redirectUri: 'http://127.0.0.1:43210/' };
const refreshToken = 'private-refresh-token-marker';
const providerPrivate = 'private-provider-email-and-token-marker';
const privateValues = [client.clientSecret, grant.code, grant.verifier, refreshToken, providerPrivate];

function privateSafe(error) {
  assert.ok(error instanceof GmailAuthorizationError);
  for (const secret of privateValues) assert.ok(!String(error).includes(secret));
  return true;
}

function callbackSession(timeoutMs = 2000) {
  let resolveReady, rejectReady;
  const ready = new Promise((resolvePromise, rejectPromise) => { resolveReady = resolvePromise; rejectReady = rejectPromise; });
  const result = receiveGoogleAuthorization({ clientId: client.clientId, timeoutMs,
    onReady: url => resolveReady(new URL(url)) });
  result.catch(rejectReady);
  return { ready, result };
}

function callbackRequest(url, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(url, { agent: false, ...options }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolvePromise({ status: res.statusCode, body, headers: res.headers }));
      res.on('error', rejectPromise);
    });
    req.on('error', rejectPromise);
    req.end();
  });
}

function callbackUrl(authorizationUrl, state = authorizationUrl.searchParams.get('state')) {
  const callback = new URL(authorizationUrl.searchParams.get('redirect_uri'));
  callback.searchParams.set('state', state);
  callback.searchParams.set('code', grant.code);
  return callback;
}

async function assertListenerClosed(url) {
  await assert.rejects(callbackRequest(url), error => ['ECONNREFUSED', 'ECONNRESET'].includes(error.code));
}

async function ownTemporaryDirectory(parent, prefix) {
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, prefix));
  const cleanup = async () => {
    const child = relative(resolve(parent), resolve(directory));
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && basename(directory).startsWith(prefix));
    await rm(directory, { recursive: true, force: true });
  };
  return { directory, cleanup };
}

// The tested early-exit CLI paths must never start OAuth or contact any network.
const noNetworkPreload = 'data:text/javascript,' + encodeURIComponent(`
  import http from 'node:http';
  import https from 'node:https';
  import net from 'node:net';
  import { syncBuiltinESMExports } from 'node:module';
  const blocked = () => { process.stderr.write('UNEXPECTED_NETWORK_MARKER\\n'); throw new Error('network forbidden in CLI guard test'); };
  globalThis.fetch = blocked;
  http.request = blocked; https.request = blocked; http.createServer = blocked; net.connect = blocked;
  syncBuiltinESMExports();
`);

async function runCli(args) {
  try {
    const output = await runFile(process.execPath, ['--import', noNetworkPreload, cli, ...args], {
      cwd: root, env: { NODE_NO_WARNINGS: '1' }, timeout: 5000, windowsHide: true,
    });
    return { ...output, code: 0 };
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

function assertCliPrivate(output) {
  const combined = output.stdout + output.stderr;
  assert.ok(!combined.includes('UNEXPECTED_NETWORK_MARKER'));
  assert.ok(!combined.includes('https://accounts.google.com/'));
  for (const secret of privateValues) assert.ok(!combined.includes(secret));
}

test('Desktop client parser accepts installed client settings and ignores supplied provider endpoints', () => {
  const parsed = parseDesktopClient({ installed: {
    client_id: client.clientId, client_secret: ` ${client.clientSecret} `,
    auth_uri: 'https://attacker.invalid/authorize', token_uri: 'https://attacker.invalid/token',
  } });
  assert.deepEqual(parsed, client);
});

test('Desktop client parser rejects Web clients, API keys and malformed settings without exposing input', () => {
  for (const input of [undefined, null, {}, { key: providerPrivate },
    { web: { client_id: client.clientId, client_secret: client.clientSecret } },
    { installed: { client_id: providerPrivate, client_secret: client.clientSecret } },
    { installed: { client_id: client.clientId, client_secret: '' } }]) {
    assert.throws(() => parseDesktopClient(input), privateSafe);
  }
});

test('authorization URL fixes the Google endpoint, send-only scope, offline access and S256 PKCE', () => {
  const first = createGoogleAuthorization(client.clientId, grant.redirectUri);
  const second = createGoogleAuthorization(client.clientId, grant.redirectUri);
  const url = new URL(first.url);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.username, ''); assert.equal(url.password, ''); assert.equal(url.hash, '');
  assert.equal(url.searchParams.get('client_id'), client.clientId);
  assert.equal(url.searchParams.get('redirect_uri'), grant.redirectUri);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), GMAIL_SEND_SCOPE);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(url.searchParams.get('state'), first.state);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(first.verifier).digest('base64url'));
  assert.match(first.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.match(first.state, /^[A-Za-z0-9_-]{32,}$/);
  assert.notEqual(first.state, second.state); assert.notEqual(first.verifier, second.verifier);
  assert.ok(!first.url.includes(first.verifier)); assert.ok(!first.url.includes(client.clientSecret));
  const hinted = new URL(createGoogleAuthorization(client.clientId, grant.redirectUri, 'sender-test@gmail.com').url);
  assert.equal(hinted.searchParams.get('login_hint'), 'sender-test@gmail.com');
  assert.equal(hinted.searchParams.get('scope'), GMAIL_SEND_SCOPE);
});

test('loopback listener rejects hostile requests and then accepts one matching state and code', async t => {
  const session = callbackSession();
  t.after(() => session.result.catch(() => undefined));
  const authorization = await session.ready;
  const valid = callbackUrl(authorization);
  assert.equal(valid.hostname, '127.0.0.1');
  assert.equal(valid.protocol, 'http:');
  assert.ok(Number(valid.port) > 0);
  const hostile = [
    [callbackUrl(authorization, 'wrong-state'), {}, 400],
    [new URL(valid.pathname + '?code=private-authorization-code-marker', valid), {}, 400],
    [new URL(valid.href + '&state=duplicate-state'), {}, 400],
    [valid, { headers: { host: 'attacker.invalid' } }, 404],
    [new URL('/unexpected-path' + valid.search, valid), {}, 404],
    [valid, { method: 'POST' }, 404],
    [valid, { path: 'http://[invalid-url' }, 400],
  ];
  for (const [url, options, status] of hostile) {
    const response = await callbackRequest(url, options);
    assert.equal(response.status, status);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.ok(response.headers['content-security-policy'].includes("default-src 'none'"));
    for (const secret of [...privateValues, authorization.searchParams.get('state')]) assert.ok(!response.body.includes(secret));
  }
  const accepted = await callbackRequest(valid);
  assert.equal(accepted.status, 200);
  assert.ok(!accepted.body.includes(grant.code));
  const result = await session.result;
  assert.equal(result.code, grant.code);
  assert.equal(result.redirectUri, authorization.searchParams.get('redirect_uri'));
  assert.equal(createHash('sha256').update(result.verifier).digest('base64url'), authorization.searchParams.get('code_challenge'));
  await assertListenerClosed(valid);
});

test('declined consent rejects safely and closes the callback listener', async () => {
  const session = callbackSession();
  const authorization = await session.ready;
  const denied = callbackUrl(authorization);
  denied.searchParams.delete('code');
  denied.searchParams.set('error', providerPrivate);
  const rejected = assert.rejects(session.result, error => privateSafe(error) && /declined|incomplete/i.test(error.message));
  const response = await callbackRequest(denied);
  assert.equal(response.status, 400);
  assert.ok(!response.body.includes(providerPrivate));
  await rejected;
  await assertListenerClosed(denied);
});

test('callback timeout rejects safely and closes its listener', async () => {
  const session = callbackSession(60);
  const authorization = await session.ready;
  await assert.rejects(session.result, error => privateSafe(error) && /timed out/i.test(error.message));
  await assertListenerClosed(callbackUrl(authorization));
});

test('authorization exchange sends one fixed HTTPS form with the client, code, PKCE verifier and redirect', async t => {
  const log = t.mock.method(console, 'log', () => undefined);
  const errorLog = t.mock.method(console, 'error', () => undefined);
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(!options.signal.aborted);
    assert.ok(options.body instanceof URLSearchParams);
    assert.deepEqual(Object.fromEntries(options.body), {
      client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'authorization_code',
      code: grant.code, code_verifier: grant.verifier, redirect_uri: grant.redirectUri,
    });
    return Response.json({ refresh_token: refreshToken, scope: GMAIL_SEND_SCOPE, access_token: providerPrivate });
  });
  assert.equal(await exchangeGoogleAuthorization(client, grant), refreshToken);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(log.mock.callCount(), 0); assert.equal(errorLog.mock.callCount(), 0);
});

test('exchange accepts an omitted scope when Google leaves the requested permission unchanged', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ refresh_token: refreshToken }));
  assert.equal(await exchangeGoogleAuthorization(client, grant), refreshToken);
});

test('exchange rejects missing refresh tokens and unsafe permission sets without exposing provider data', async t => {
  const badPayloads = [
    {}, { access_token: providerPrivate }, { refresh_token: '' }, { refresh_token: '   ' },
    { refresh_token: refreshToken, scope: 'https://mail.google.com/' },
    { refresh_token: refreshToken, scope: `${GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/gmail.readonly` },
    { refresh_token: refreshToken, scope: `${GMAIL_SEND_SCOPE} ${GMAIL_SEND_SCOPE}` },
    { refresh_token: refreshToken, scope: '' },
  ];
  for (const payload of badPayloads) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ ...payload, error_description: providerPrivate }));
    await assert.rejects(exchangeGoogleAuthorization(client, grant), privateSafe);
    t.mock.restoreAll();
  }
});

test('exchange network and HTTP failures never expose credentials or raw provider bodies and are not retried', async t => {
  const failureCases = [
    async () => { throw new Error(privateValues.join(' ')); },
    async () => new Response(privateValues.join(' '), { status: 401 }),
    async () => Response.json({ error: 'invalid_grant', error_description: providerPrivate }, { status: 400 }),
    async () => new Response(providerPrivate, { status: 503 }),
    async () => new Response(providerPrivate, { status: 200 }),
  ];
  for (const fail of failureCases) {
    const fetchMock = t.mock.method(globalThis, 'fetch', fail);
    await assert.rejects(exchangeGoogleAuthorization(client, grant), privateSafe);
    assert.equal(fetchMock.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test('CLI --help works without credentials, input files or any network', async () => {
  const output = await runCli(['--help', '--client', join(tmpdir(), 'nonexistent-private-client-marker.json')]);
  assert.equal(output.code, 0);
  assert.match(output.stdout, /Usage:.*gmail:authorize/);
  assert.equal(output.stderr, '');
  assertCliPrivate(output);
});

test('CLI rejects private output paths outside .local before reading credentials or starting OAuth', async () => {
  for (const outputPath of [join(tmpdir(), 'gmail-outside-output-marker.env'), root, local]) {
    const output = await runCli(['--sender', 'fake-sender@gmail.com', '--client', join(tmpdir(), 'nonexistent-private-client-marker.json'), '--output', outputPath]);
    assert.equal(output.code, 1);
    assert.match(output.stderr, /inside the ignored \.local directory/);
    assertCliPrivate(output);
  }
});

test('CLI refuses to replace an existing private output before starting OAuth', async t => {
  const temporary = await ownTemporaryDirectory(local, 'gmail-oauth-test-');
  t.after(temporary.cleanup);
  const outputPath = join(temporary.directory, 'existing.env');
  await writeFile(outputPath, refreshToken, { mode: 0o600 });
  const output = await runCli(['--sender', 'fake-sender@gmail.com', '--client', join(tmpdir(), 'nonexistent-private-client-marker.json'), '--output', outputPath]);
  assert.equal(output.code, 1);
  assert.match(output.stderr, /already exists/);
  assert.equal(await readFile(outputPath, 'utf8'), refreshToken);
  assertCliPrivate(output);
});

test('CLI rejects an output directory that escapes .local through a symlink or junction', async t => {
  const inside = await ownTemporaryDirectory(local, 'gmail-oauth-test-');
  const outside = await ownTemporaryDirectory(tmpdir(), 'gmail-oauth-outside-test-');
  const link = join(inside.directory, 'escape');
  let linked = false;
  t.after(async () => {
    if (linked) await unlink(link);
    await inside.cleanup(); await outside.cleanup();
  });
  try { await symlink(outside.directory, link, process.platform === 'win32' ? 'junction' : 'dir'); linked = true; }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('This environment cannot create a temporary symlink or junction.'); return; }
    throw error;
  }
  const markerPath = join(outside.directory, 'preserve.txt');
  await writeFile(markerPath, providerPrivate);
  const outputPath = join(link, 'render.env');
  const output = await runCli(['--sender', 'fake-sender@gmail.com', '--client', join(tmpdir(), 'nonexistent-private-client-marker.json'), '--output', outputPath]);
  assert.equal(output.code, 1);
  assert.match(output.stderr, /must stay inside \.local/);
  assert.equal(await readFile(markerPath, 'utf8'), providerPrivate);
  await assert.rejects(access(outputPath), error => error.code === 'ENOENT');
  assertCliPrivate(output);
});
