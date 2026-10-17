import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// These tests use invented credentials and cannot contact a database or email provider.
const sender = 'campus-mail-test@gmail.com';
const recipient = 'private-student@campus.example';
const clientId = 'isolated-gmail-client-id.apps.googleusercontent.com';
const clientSecret = 'isolated-gmail-client-secret';
const refreshToken = 'isolated-gmail-refresh-token';
const accessToken = 'isolated-gmail-access-token';
const settings = { clientId, clientSecret, refreshToken, from: sender };
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const sendEndpoint = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const environment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  SESSION_SECRET: 'isolated-mail-tests-session-secret-0123456789',
  APP_ORIGIN: 'https://campus.example',
  SESSION_DRIVER: 'postgres',
  MAIL_MODE: 'gmail',
  GMAIL_CLIENT_ID: clientId,
  GMAIL_CLIENT_SECRET: clientSecret,
  GMAIL_REFRESH_TOKEN: refreshToken,
  MAIL_FROM: sender,
  DOTENV_CONFIG_PATH: fileURLToPath(new URL(`.mail-tests-no-env-${process.pid}`, import.meta.url)),
};
const clearedVariables = [
  'EMAIL_MODE', 'EMAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE',
  'SMTP_USER', 'SMTP_PASSWORD', 'API_PORT', 'PORT', 'API_HOST', 'HOST',
  'BREVO_API_KEY', 'MAIL_OUTBOX_DIR',
];
function resetEnvironment() {
  for (const key of clearedVariables) delete process.env[key];
  Object.assign(process.env, environment);
}
resetEnvironment();
const require = createRequire(import.meta.url);
const { config, loadConfig } = require('../dist/config.js');
const { MailDeliveryError, GmailDelivery } = require('../dist/mail-delivery.js');
const { MailService } = require('../dist/mail.js');
const nodemailer = require('nodemailer');
const { Logger } = require('@nestjs/common');
test.beforeEach(t => {
  resetEnvironment();
  t.mock.method(globalThis, 'fetch', () => assert.fail('Mail unit tests must not contact external services.'));
});

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function tokenResponse(overrides = {}) {
  return response({ access_token: accessToken, expires_in: 3600, token_type: 'Bearer', ...overrides });
}
function checkRequest(options) {
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error', 'OAuth credentials and mail must not follow redirects.');
  assert.ok(options.signal instanceof AbortSignal, 'HTTPS requests must have bounded cancellation signals.');
  return new Headers(options.headers);
}
function errorStrings(error, seen = new Set()) {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object' || seen.has(error)) return '';
  seen.add(error);
  return Object.getOwnPropertyNames(error).map(key => errorStrings(error[key], seen)).join('\n');
}
async function rejectsSafely(action, forbidden = []) {
  let rejection;
  await assert.rejects(action, error => {
    rejection = error;
    assert.ok(error instanceof MailDeliveryError, 'Mail failures must use the safe error type.');
    const details = errorStrings(error);
    for (const secret of [clientId, clientSecret, refreshToken, accessToken, sender, recipient, ...forbidden]) {
      assert.ok(!details.includes(secret), 'Mail errors must not expose credentials, addresses, provider bodies, or private links.');
    }
    assert.equal(error.cause, undefined, 'Unsafe provider and network errors must not survive as causes.');
    return true;
  });
  return rejection;
}
function decodeQuotedPrintable(text) {
  const binary = text.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(binary, 'latin1').toString('utf8');
}
function decodeHeader(value) {
  return value.replace(/(\?=)\s+(=\?)/g, '$1$2').replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_, encoding, content) => encoding.toLowerCase() === 'b'
    ? Buffer.from(content, 'base64').toString('utf8')
    : decodeQuotedPrintable(content.replace(/_/g, ' ')));
}
function decodeMessage(raw) {
  assert.equal(typeof raw, 'string');
  assert.match(raw, /^[A-Za-z0-9_-]+$/, 'Gmail raw messages must use unpadded base64url encoding.');
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  const boundary = mime.indexOf('\r\n\r\n');
  assert.ok(boundary > 0, 'MIME headers and body must be separated by CRLF.');
  const headerText = mime.slice(0, boundary);
  assert.doesNotMatch(headerText, /(?<!\r)\n/, 'MIME headers must use CRLF line endings.');
  const headers = new Map(headerText.replace(/\r\n[ \t]+/g, ' ').split('\r\n').map(line => {
    const colon = line.indexOf(':');
    assert.ok(colon > 0);
    return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
  }));
  let text = mime.slice(boundary + 4);
  if (headers.get('content-transfer-encoding')?.toLowerCase() === 'base64') text = Buffer.from(text, 'base64').toString('utf8');
  if (headers.get('content-transfer-encoding')?.toLowerCase() === 'quoted-printable') text = decodeQuotedPrintable(text);
  return { headers, subject: decodeHeader(headers.get('subject') ?? ''), text: text.replace(/\r\n/g, '\n').trimEnd(), mime };
}
function preserveConfig(t, changes) {
  const previous = { ...config };
  t.after(() => Object.assign(config, previous));
  Object.assign(config, changes);
}

test('Production Gmail configuration requires no SMTP credentials', () => {
  const loaded = loadConfig();
  assert.equal(loaded.production, true);
  assert.equal(loaded.emailMode, 'gmail');
  assert.deepEqual(loaded.gmail, settings);
  assert.equal(loaded.smtp, undefined);
  assert.equal(loaded.brevo, undefined);
});

test('Gmail configuration requires OAuth credentials and a sender address', async t => {
  for (const key of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'MAIL_FROM']) {
    await t.test(key, () => {
      delete process.env[key];
      assert.throws(() => loadConfig(), new RegExp(key));
      process.env[key] = '   ';
      assert.throws(() => loadConfig(), new RegExp(key));
    });
  }
});

test('Gmail sender must be a plain email address without header injection', async t => {
  for (const from of ['not-an-email', 'Campus <campus-mail-test@gmail.com>', `${sender}\r\nBcc: ${recipient}`]) {
    await t.test(JSON.stringify(from), () => {
      process.env.MAIL_FROM = from;
      assert.throws(() => loadConfig(), /MAIL_FROM|sender|email/i);
    });
  }
});

test('Removed Brevo mode and production file mode are rejected', () => {
  process.env.MAIL_MODE = 'brevo';
  process.env.BREVO_API_KEY = 'obsolete-test-provider-key';
  assert.throws(() => loadConfig(), /MAIL_MODE/);
  process.env.MAIL_MODE = 'file';
  assert.throws(() => loadConfig(), /production/i);
});

test('Development file mode and SMTP configuration do not require Gmail credentials', () => {
  for (const key of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']) delete process.env[key];
  process.env.NODE_ENV = 'test';
  process.env.MAIL_MODE = 'file';
  assert.equal(loadConfig().gmail, undefined);
  process.env.MAIL_MODE = 'smtp';
  Object.assign(process.env, { SMTP_HOST: 'smtp.campus.example', SMTP_PORT: '587', SMTP_USER: 'isolated-smtp-user', SMTP_PASSWORD: 'isolated-smtp-password' });
  assert.equal(loadConfig().smtp.host, 'smtp.campus.example');
  assert.equal(loadConfig().gmail, undefined);
});

test('Gmail refreshes OAuth over HTTPS and sends correctly encoded UTF-8 MIME with 15-second bounds', async t => {
  const text = 'Hello বাংলা — café\nOpen https://campus.example/verify-email?token=private-utf8-token';
  const subject = 'Verify email — বাংলা';
  const timeout = t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 15_000);
    return new AbortController().signal;
  });
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const headers = checkRequest(options);
    if (String(url) === tokenEndpoint) {
      assert.match(headers.get('content-type'), /^application\/x-www-form-urlencoded/i);
      assert.equal(headers.get('authorization'), null);
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('client_id'), clientId);
      assert.equal(form.get('client_secret'), clientSecret);
      assert.equal(form.get('refresh_token'), refreshToken);
      assert.equal(form.has('scope'), false);
      return tokenResponse();
    }
    assert.equal(String(url), sendEndpoint);
    assert.equal(headers.get('authorization'), `Bearer ${accessToken}`);
    assert.match(headers.get('content-type'), /^application\/json/i);
    const payload = JSON.parse(options.body);
    assert.deepEqual(Object.keys(payload), ['raw']);
    const decoded = decodeMessage(payload.raw);
    assert.equal(decoded.headers.get('to'), recipient);
    assert.equal(decoded.headers.get('from')?.match(/<([^<>]+)>$/)?.[1] ?? decoded.headers.get('from'), sender);
    assert.equal(decoded.subject, subject);
    assert.match(decoded.headers.get('content-type'), /^text\/plain;\s*charset="?utf-8"?/i);
    assert.equal(decoded.text, text);
    return response({ id: 'isolated-gmail-message-id' });
  });
  await new GmailDelivery(settings).send({ email: recipient, subject, text });
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(timeout.mock.callCount(), 2);
});

test('Gmail rejects address and subject header injection before requesting OAuth credentials', async t => {
  const cases = [
    { from: `${sender}\r\nBcc: ${recipient}` },
    { from: `Campus <${sender}>` },
    { email: `${recipient}\r\nBcc: private-bcc@campus.example` },
    { email: 'not-an-email' },
    { subject: 'Verify email\r\nBcc: private-bcc@campus.example' },
    { subject: 'Verify email\u0000private-header-value' },
  ];
  for (const scenario of cases) {
    await t.test(JSON.stringify(scenario), async context => {
      const fetch = context.mock.method(globalThis, 'fetch', () => assert.fail('Unsafe MIME headers must be rejected before fetching.'));
      await rejectsSafely(() => new GmailDelivery({ ...settings, ...(scenario.from ? { from: scenario.from } : {}) }).send({
        email: scenario.email ?? recipient, subject: scenario.subject ?? 'Verify email', text: 'A private link.',
      }), ['private-bcc@campus.example', 'private-header-value']);
      assert.equal(fetch.mock.callCount(), 0);
    });
  }
});

test('Gmail caches access tokens and refreshes at the 60-second safety margin', async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  let refreshes = 0;
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === tokenEndpoint) {
      refreshes += 1;
      return tokenResponse({ access_token: `${accessToken}-${refreshes}`, expires_in: 120 });
    }
    assert.equal(String(url), sendEndpoint);
    assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${accessToken}-${refreshes}`);
    sends += 1;
    return response({ id: `isolated-message-${sends}` });
  });
  const delivery = new GmailDelivery(settings);
  const message = { email: recipient, subject: 'Verify email', text: 'Private test link.' };
  await delivery.send(message);
  now += 59_999;
  await delivery.send(message);
  assert.equal(refreshes, 1);
  now += 1;
  await delivery.send(message);
  assert.equal(refreshes, 2);
  assert.equal(sends, 3);
});

test('Concurrent Gmail sends share one in-flight token refresh', async t => {
  let releaseToken;
  let signalRefresh;
  const tokenReady = new Promise(resolve => { releaseToken = resolve; });
  const refreshStarted = new Promise(resolve => { signalRefresh = resolve; });
  let refreshes = 0;
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url) === tokenEndpoint) {
      refreshes += 1;
      signalRefresh();
      return tokenReady;
    }
    assert.equal(String(url), sendEndpoint);
    sends += 1;
    return response({ id: `isolated-concurrent-message-${sends}` });
  });
  const delivery = new GmailDelivery(settings);
  const first = delivery.send({ email: recipient, subject: 'Verify email', text: 'First private link.' });
  const second = delivery.send({ email: recipient, subject: 'Reset password', text: 'Second private link.' });
  await refreshStarted;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshes, 1);
  releaseToken(tokenResponse());
  await Promise.all([first, second]);
  assert.equal(refreshes, 1);
  assert.equal(sends, 2);
});

test('OAuth HTTP failures never send mail or expose private provider diagnostics', async t => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    await t.test(`HTTP ${status}`, async context => {
      const privateUrl = 'https://campus.example/reset-password?token=private-refresh-failure-token';
      const privateBody = `private-oauth-diagnostic ${clientSecret} ${refreshToken} ${recipient} ${privateUrl}`;
      const fetch = context.mock.method(globalThis, 'fetch', async url => {
        assert.equal(String(url), tokenEndpoint);
        return response({ error: status === 400 ? 'invalid_grant' : 'private_provider_error', error_description: privateBody }, status);
      });
      await rejectsSafely(() => new GmailDelivery(settings).send({ email: recipient, subject: 'Reset password', text: privateUrl }), [privateBody, privateUrl, 'private-refresh-failure-token']);
      assert.equal(fetch.mock.callCount(), 1);
    });
  }
});

test('A failed token refresh does not poison the next explicit send attempt', async t => {
  let refreshes = 0;
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url) === tokenEndpoint) {
      refreshes += 1;
      return refreshes === 1 ? response({ error: 'invalid_grant' }, 400) : tokenResponse();
    }
    assert.equal(String(url), sendEndpoint);
    sends += 1;
    return response({ id: 'isolated-recovered-message' });
  });
  const delivery = new GmailDelivery(settings);
  const message = { email: recipient, subject: 'Verify email', text: 'Private recovery link.' };
  await rejectsSafely(() => delivery.send(message));
  await delivery.send(message);
  assert.equal(refreshes, 2);
  assert.equal(sends, 1);
});

test('Malformed successful OAuth responses cannot become bearer credentials', async t => {
  const bodies = [
    { access_token: undefined }, { access_token: '' }, { access_token: 123 }, { expires_in: undefined }, { expires_in: 0 },
    { expires_in: '3600' }, { token_type: 'Basic' },
  ];
  for (const body of bodies) {
    await t.test(JSON.stringify(body), async context => {
      const fetch = context.mock.method(globalThis, 'fetch', async url => {
        assert.equal(String(url), tokenEndpoint);
        return tokenResponse(body);
      });
      await rejectsSafely(() => new GmailDelivery(settings).send({ email: recipient, subject: 'Verify email', text: 'Private link.' }));
      assert.equal(fetch.mock.callCount(), 1);
    });
  }
  await t.test('non-JSON response', async context => {
    context.mock.method(globalThis, 'fetch', async () => new Response(`private-invalid-json ${clientSecret}`, { status: 200 }));
    await rejectsSafely(() => new GmailDelivery(settings).send({ email: recipient, subject: 'Verify email', text: 'Private link.' }), ['private-invalid-json']);
  });
});

test('Gmail send HTTP failures are sanitized and never silently resend a token email', async t => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    await t.test(`HTTP ${status}`, async context => {
      const token = 'private-send-failure-token';
      const privateUrl = `https://campus.example/reset-password?token=${token}`;
      const privateBody = `private-send-diagnostic ${accessToken} ${recipient} ${privateUrl}`;
      const fetch = context.mock.method(globalThis, 'fetch', async url => {
        if (String(url) === tokenEndpoint) return tokenResponse();
        assert.equal(String(url), sendEndpoint);
        return response({ error: { code: status, message: privateBody } }, status);
      });
      await rejectsSafely(() => new GmailDelivery(settings).send({ email: recipient, subject: 'Reset password', text: privateUrl }), [privateUrl, token, privateBody]);
      assert.equal(fetch.mock.callCount(), 2, 'Only one refresh and one send attempt are permitted.');
    });
  }
});

test('Gmail sends reject missing message IDs and malformed success bodies', async t => {
  for (const body of [{}, { id: '' }, { id: 123 }, { id: '   ' }, []]) {
    await t.test(JSON.stringify(body), async context => {
      context.mock.method(globalThis, 'fetch', async url => String(url) === tokenEndpoint ? tokenResponse() : response(body));
      await rejectsSafely(() => new GmailDelivery(settings).send({ email: recipient, subject: 'Verify email', text: 'Private link.' }));
    });
  }
  await t.test('non-JSON response', async context => {
    context.mock.method(globalThis, 'fetch', async url => String(url) === tokenEndpoint ? tokenResponse() : new Response(`private-invalid-send-json ${accessToken}`, { status: 200 }));
    await rejectsSafely(() => new GmailDelivery(settings).send({ email: recipient, subject: 'Verify email', text: 'Private link.' }), ['private-invalid-send-json']);
  });
});

test('OAuth and Gmail network or abort failures expose no secrets and cause no send retries', async t => {
  for (const phase of ['refresh', 'send']) {
    for (const name of ['TypeError', 'AbortError', 'TimeoutError']) {
      await t.test(`${phase} ${name}`, async context => {
        const privateUrl = 'https://campus.example/verify-email?token=private-network-token';
        const privateReason = `private-network-reason ${refreshToken} ${accessToken} ${privateUrl}`;
        const fetch = context.mock.method(globalThis, 'fetch', async url => {
          if (phase === 'send' && String(url) === tokenEndpoint) return tokenResponse();
          const error = new Error(privateReason);
          error.name = name;
          throw error;
        });
        await rejectsSafely(() => new GmailDelivery(settings).send({ email: recipient, subject: 'Verify email', text: privateUrl }), [privateReason, privateUrl, 'private-network-token']);
        assert.equal(fetch.mock.callCount(), phase === 'refresh' ? 1 : 2);
      });
    }
  }
});

test('Gmail MailService startup does not depend on external email and sends verification/reset links with the right expiry', async t => {
  t.mock.method(nodemailer, 'createTransport', () => assert.fail('Gmail mode must not create an SMTP transport.'));
  const messages = [];
  let refreshes = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === tokenEndpoint) {
      refreshes += 1;
      return tokenResponse();
    }
    assert.equal(String(url), sendEndpoint);
    messages.push(decodeMessage(JSON.parse(options.body).raw));
    return response({ id: `isolated-service-message-${messages.length}` });
  });
  const service = new MailService();
  await service.onModuleInit();
  assert.equal(fetch.mock.callCount(), 0, 'Core API startup must not fetch Gmail or OAuth.');
  await service.sendLink(recipient, 'verify', 'service-verification-one-time-token');
  await service.sendLink(recipient, 'reset', 'service-reset-one-time-token');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].subject, 'Verify your MyCampusToCareer email');
  assert.equal(messages[1].subject, 'Reset your MyCampusToCareer password');
  assert.ok(messages[0].text.includes('https://campus.example/verify-email?token=service-verification-one-time-token'));
  assert.ok(messages[0].text.includes('24 hours'));
  assert.ok(messages[1].text.includes('https://campus.example/reset-password?token=service-reset-one-time-token'));
  assert.ok(messages[1].text.includes('30 minutes'));
  for (const message of messages) {
    assert.equal(message.headers.get('to'), recipient);
    assert.equal(message.headers.get('from')?.match(/<([^<>]+)>$/)?.[1] ?? message.headers.get('from'), sender);
    assert.ok(message.text.includes('can be used once'));
  }
  assert.equal(refreshes, 1);
  assert.equal(fetch.mock.callCount(), 3);
});

test('MailService logs only the safe OAuth diagnosis when Gmail rejects a refresh token', async t => {
  const privateToken = 'private-service-logging-token';
  const privateLink = `https://campus.example/reset-password?token=${privateToken}`;
  const privateBody = `private-logging-diagnostic ${clientSecret} ${refreshToken} ${recipient} ${privateLink}`;
  const logged = [];
  t.mock.method(Logger.prototype, 'error', (...args) => { logged.push(args); });
  const fetch = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(String(url), tokenEndpoint);
    return response({ error: 'invalid_grant', error_description: privateBody }, 400);
  });
  const service = new MailService();
  const failure = await rejectsSafely(() => service.sendLink(recipient, 'reset', privateToken), [privateBody, privateLink, privateToken]);
  assert.match(failure.message, /GMAIL_REFRESH_TOKEN_REJECTED/);
  assert.deepEqual(logged, [[failure.message]], 'Only the safe diagnosis string may reach the logger.');
  const details = errorStrings(logged);
  for (const secret of [clientId, clientSecret, refreshToken, accessToken, sender, recipient, privateBody, privateLink, privateToken]) {
    assert.ok(!details.includes(secret), 'Logged mail failures must not expose credentials, recipients, provider bodies, or token links.');
  }
  assert.equal(fetch.mock.callCount(), 1, 'A rejected refresh token must never trigger a mail send.');
});

test('MailService logs a fixed message for unexpected Gmail failures without echoing the error', async t => {
  const privateToken = 'private-unexpected-service-token';
  const privateLink = `https://campus.example/verify-email?token=${privateToken}`;
  const privateError = new Error(`private-unexpected-diagnostic ${clientSecret} ${refreshToken} ${recipient} ${privateLink}`);
  const logged = [];
  t.mock.method(Logger.prototype, 'error', (...args) => { logged.push(args); });
  t.mock.method(GmailDelivery.prototype, 'send', async () => { throw privateError; });
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('The mocked delivery failure must not fetch.'));
  const service = new MailService();
  await assert.rejects(() => service.sendLink(recipient, 'verify', privateToken), error => error === privateError);
  assert.deepEqual(logged, [['Gmail email delivery failed.']], 'Unexpected errors must use only the fixed safe log message.');
  const details = errorStrings(logged);
  for (const secret of [clientSecret, refreshToken, recipient, privateError.message, privateLink, privateToken]) {
    assert.ok(!details.includes(secret));
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('Development file delivery still writes a local verification message', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'campus-mail-unit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  preserveConfig(t, { production: false, emailMode: 'file', gmail: undefined, smtp: undefined, mailOutboxDir: directory });
  const service = new MailService();
  await service.onModuleInit();
  await service.sendLink(recipient, 'verify', 'isolated-file-verification-token');
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  const message = await readFile(join(directory, files[0]), 'utf8');
  assert.ok(message.includes(`To: ${recipient}`));
  assert.ok(message.includes('Verify your MyCampusToCareer email'));
  assert.ok(message.includes('https://campus.example/verify-email?token=isolated-file-verification-token'));
});

test('SMTP delivery remains available with bounded startup and safe authentication/network hints', async t => {
  for (const code of ['EAUTH', 'ETIMEDOUT']) {
    await t.test(code, async context => {
      preserveConfig(context, {
        emailMode: 'smtp', gmail: undefined,
        smtp: { host: 'smtp.campus.example', port: 587, secure: false, auth: { user: 'smtp-test-user', pass: 'smtp-test-private-password' }, from: sender },
      });
      const transport = context.mock.method(nodemailer, 'createTransport', options => {
        assert.equal(options.connectionTimeout, 15_000);
        assert.equal(options.greetingTimeout, 10_000);
        assert.equal(options.socketTimeout, 20_000);
        assert.equal(options.requireTLS, true);
        return { verify: async () => {
          const error = new Error('smtp-test-private-password should never be logged');
          error.code = code;
          throw error;
        } };
      });
      const error = await rejectsSafely(() => new MailService().onModuleInit(), ['smtp-test-private-password']);
      assert.match(error.message, code === 'EAUTH' ? /SMTP_USER.*SMTP_PASSWORD/ : /SMTP.*network|network.*SMTP/i);
      assert.equal(transport.mock.callCount(), 1);
    });
  }
  await t.test('successful SMTP delivery', async context => {
    preserveConfig(context, {
      emailMode: 'smtp', gmail: undefined,
      smtp: { host: 'smtp.campus.example', port: 587, secure: false, auth: { user: 'smtp-test-user', pass: 'smtp-test-private-password' }, from: sender },
    });
    let checks = 0;
    const sent = [];
    context.mock.method(nodemailer, 'createTransport', () => ({
      verify: async () => { checks += 1; },
      sendMail: async message => { sent.push(message); return {}; },
    }));
    const service = new MailService();
    await service.onModuleInit();
    await service.sendLink(recipient, 'reset', 'isolated-smtp-reset-token');
    assert.equal(checks, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].from, sender);
    assert.equal(sent[0].to, recipient);
    assert.equal(sent[0].subject, 'Reset your MyCampusToCareer password');
    assert.ok(sent[0].text.includes('https://campus.example/reset-password?token=isolated-smtp-reset-token'));
  });
});
