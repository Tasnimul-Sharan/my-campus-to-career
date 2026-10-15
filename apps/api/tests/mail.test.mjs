import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Isolate these tests from a developer's .env, database, and email credentials.
const fakeKey = 'isolated-test-brevo-api-key';
const sender = 'hello@campus.example';
const settings = { apiKey: fakeKey, from: sender };
const environment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  SESSION_SECRET: 'isolated-mail-tests-session-secret-0123456789',
  APP_ORIGIN: 'https://campus.example',
  SESSION_DRIVER: 'postgres',
  MAIL_MODE: 'brevo',
  BREVO_API_KEY: fakeKey,
  MAIL_FROM: sender,
  DOTENV_CONFIG_PATH: fileURLToPath(new URL(`.mail-tests-no-env-${process.pid}`, import.meta.url)),
};
const clearedVariables = [
  'EMAIL_MODE', 'EMAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE',
  'SMTP_USER', 'SMTP_PASSWORD', 'API_PORT', 'PORT', 'API_HOST', 'HOST',
];
function resetEnvironment() {
  for (const key of clearedVariables) delete process.env[key];
  Object.assign(process.env, environment);
}
resetEnvironment();
const require = createRequire(import.meta.url);
const { config, loadConfig } = require('../dist/config.js');
const { MailDeliveryError, verifyBrevo, sendBrevoEmail } = require('../dist/mail-delivery.js');
const { MailService } = require('../dist/mail.js');
const nodemailer = require('nodemailer');
test.beforeEach(resetEnvironment);

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function requestHeaders(options) {
  const headers = new Headers(options.headers);
  assert.equal(headers.get('api-key'), fakeKey);
  assert.ok(options.signal instanceof AbortSignal, 'Email requests must have a bounded cancellation signal.');
  return headers;
}

function errorStrings(error, seen = new Set()) {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object' || seen.has(error)) return '';
  seen.add(error);
  return Object.getOwnPropertyNames(error).map(key => errorStrings(error[key], seen)).join('\n');
}

async function rejectsSafely(action, forbidden = []) {
  await assert.rejects(action, error => {
    assert.ok(error instanceof MailDeliveryError, 'Failures should use the safe email error type.');
    const details = errorStrings(error);
    for (const secret of [fakeKey, ...forbidden]) {
      assert.ok(!details.includes(secret), 'Email errors must not include provider bodies, credentials, or private links.');
    }
    return true;
  });
}

test('Production Brevo configuration works without SMTP credentials', () => {
  const config = loadConfig();
  assert.equal(config.production, true);
  assert.equal(config.emailMode, 'brevo');
  assert.equal(config.smtp, undefined);
});

test('Brevo configuration requires an API key and sender address', async t => {
  for (const key of ['BREVO_API_KEY', 'MAIL_FROM']) {
    await t.test(`missing ${key} is rejected`, () => {
      resetEnvironment();
      delete process.env[key];
      assert.throws(() => loadConfig(), new RegExp(key));
    });
  }
});

test('Brevo sender must be a plain email address, without header injection', async t => {
  for (const from of ['not-an-email', 'Campus <hello@campus.example>', 'hello@campus.example\r\nBcc: private@campus.example']) {
    await t.test(JSON.stringify(from), () => {
      process.env.MAIL_FROM = from;
      assert.throws(() => loadConfig(), /MAIL_FROM|sender|email/i);
    });
  }
});

test('Production still rejects local file email mode', () => {
  process.env.MAIL_MODE = 'file';
  assert.throws(() => loadConfig(), /production/i);
});

test('Brevo startup check uses HTTPS account GET without sending an email', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://api.brevo.com/v3/account');
    assert.equal(options.method ?? 'GET', 'GET');
    requestHeaders(options);
    assert.equal(options.body, undefined);
    return response({ relay: { enabled: true } });
  });
  await verifyBrevo(settings);
  assert.equal(fetch.mock.callCount(), 1);
});

test('Brevo startup check rejects disabled transactional delivery', async t => {
  t.mock.method(globalThis, 'fetch', async () => response({ relay: { enabled: false } }));
  await rejectsSafely(() => verifyBrevo(settings));
});

test('Brevo startup check sanitizes unauthorized provider responses', async t => {
  const privateBody = `sensitive-provider-diagnostic-${fakeKey}`;
  t.mock.method(globalThis, 'fetch', async () => response({ code: 'unauthorized', message: privateBody }, 401));
  await rejectsSafely(() => verifyBrevo(settings), [privateBody]);
});

test('Brevo startup check rejects a malformed successful response', async t => {
  t.mock.method(globalThis, 'fetch', async () => response({ account: 'not-a-relay-status' }));
  await rejectsSafely(() => verifyBrevo(settings));
});

test('Brevo startup check aborts with a 15-second bound and hides network errors', async t => {
  const privateReason = `timeout-with-private-key-${fakeKey}`;
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 15_000);
    return AbortSignal.abort(new DOMException(privateReason, 'TimeoutError'));
  });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.signal.aborted, true);
    throw options.signal.reason;
  });
  await rejectsSafely(() => verifyBrevo(settings), [privateReason]);
});

test('Verification and password reset messages preserve their private link in the HTTPS payload', async t => {
  for (const purpose of ['verify-email', 'reset-password']) {
    await t.test(purpose, async context => {
      const token = `${purpose}-private-one-time-token`;
      const message = {
        email: 'student@campus.example',
        subject: purpose === 'verify-email' ? 'Verify your MyCampusToCareer email' : 'Reset your MyCampusToCareer password',
        text: `Open https://campus.example/${purpose}?token=${token}\nThis link can be used once.`,
      };
      const fetch = context.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.equal(String(url), 'https://api.brevo.com/v3/smtp/email');
        assert.equal(options.method, 'POST');
        assert.equal(requestHeaders(options).get('content-type'), 'application/json');
        const payload = JSON.parse(options.body);
        assert.equal(payload.sender.email, sender);
        assert.deepEqual(payload.to, [{ email: message.email }]);
        assert.equal(payload.subject, message.subject);
        assert.equal(payload.textContent, message.text);
        assert.equal(payload.templateId, undefined);
        return response({ messageId: '<isolated-test-message@brevo.example>' }, 201);
      });
      await sendBrevoEmail(settings, message);
      assert.equal(fetch.mock.callCount(), 1, 'Delivery should not silently duplicate or retry a token email.');
    });
  }
});

test('Brevo send failures are sanitized and do not silently retry', async t => {
  for (const status of [400, 401, 429, 500, 503]) {
    await t.test(`HTTP ${status}`, async context => {
      const token = 'private-token-that-must-never-reach-the-error';
      const text = `https://campus.example/reset-password?token=${token}`;
      const privateBody = `provider-echo-of-${fakeKey}-${text}`;
      const fetch = context.mock.method(globalThis, 'fetch', async () => response({ message: privateBody }, status));
      await rejectsSafely(() => sendBrevoEmail(settings, { email: 'student@campus.example', subject: 'Reset password', text }), [token, text, privateBody]);
      assert.equal(fetch.mock.callCount(), 1);
    });
  }
});

test('Brevo sends reject missing message IDs and invalid JSON success bodies', async t => {
  const message = { email: 'student@campus.example', subject: 'Verify email', text: 'A private verification link.' };
  for (const body of [{}, { messageId: '' }, { messageId: 123 }]) {
    await t.test(JSON.stringify(body), async context => {
      context.mock.method(globalThis, 'fetch', async () => response(body, 201));
      await rejectsSafely(() => sendBrevoEmail(settings, message));
    });
  }
  await t.test('non-JSON response', async context => {
    context.mock.method(globalThis, 'fetch', async () => new Response('invalid-json-private-provider-body', { status: 201 }));
    await rejectsSafely(() => sendBrevoEmail(settings, message), ['invalid-json-private-provider-body']);
  });
});

test('Brevo send network and abort failures do not expose the key or token', async t => {
  const token = 'private-verification-token';
  for (const name of ['TypeError', 'AbortError', 'TimeoutError']) {
    await t.test(name, async context => {
      context.mock.method(globalThis, 'fetch', async () => {
        const error = new Error(`private-network-error-${fakeKey}-${token}`);
        error.name = name;
        throw error;
      });
      await rejectsSafely(() => sendBrevoEmail(settings, {
        email: 'student@campus.example', subject: 'Verify email', text: `https://campus.example/verify-email?token=${token}`,
      }), [token, 'private-network-error']);
    });
  }
});

test('MailService verifies Brevo at startup and delivers verification/reset links with the correct expiry', async t => {
  t.mock.method(nodemailer, 'createTransport', () => {
    assert.fail('Brevo mode must not create an SMTP transport.');
  });
  const messages = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    requestHeaders(options);
    if (String(url) === 'https://api.brevo.com/v3/account') {
      assert.equal(options.method, 'GET');
      return response({ relay: { enabled: true } });
    }
    assert.equal(String(url), 'https://api.brevo.com/v3/smtp/email');
    assert.equal(options.method, 'POST');
    messages.push(JSON.parse(options.body));
    return response({ messageId: '<isolated-service-message@brevo.example>' }, 201);
  });
  const service = new MailService();
  await service.onModuleInit();
  assert.equal(fetch.mock.callCount(), 1, 'Startup must validate the email account before accepting requests.');
  await service.sendLink('student@campus.example', 'verify', 'service-verification-one-time-token');
  await service.sendLink('student@campus.example', 'reset', 'service-reset-one-time-token');
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map(message => message.to), [[{ email: 'student@campus.example' }], [{ email: 'student@campus.example' }]]);
  assert.equal(messages[0].subject, 'Verify your MyCampusToCareer email');
  assert.equal(messages[1].subject, 'Reset your MyCampusToCareer password');
  assert.ok(messages[0].textContent.includes('https://campus.example/verify-email?token=service-verification-one-time-token'));
  assert.ok(messages[0].textContent.includes('24 hours'));
  assert.ok(messages[1].textContent.includes('https://campus.example/reset-password?token=service-reset-one-time-token'));
  assert.ok(messages[1].textContent.includes('30 minutes'));
  for (const message of messages) assert.ok(message.textContent.includes('can be used once'));
  assert.equal(fetch.mock.callCount(), 3);
});

test('SMTP startup remains bounded and reports safe authentication/network hints', async t => {
  for (const code of ['EAUTH', 'ETIMEDOUT']) {
    await t.test(code, async context => {
      const previous = { smtp: config.smtp, brevo: config.brevo, emailMode: config.emailMode };
      context.after(() => Object.assign(config, previous));
      Object.assign(config, {
        emailMode: 'smtp', brevo: undefined,
        smtp: { host: 'smtp.campus.example', port: 587, secure: false, auth: { user: 'smtp-test-user', pass: 'smtp-test-private-password' }, from: sender },
      });
      context.mock.method(globalThis, 'fetch', () => assert.fail('SMTP mode must not call the Brevo API.'));
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
      const service = new MailService();
      await rejectsSafely(() => service.onModuleInit(), ['smtp-test-private-password']);
      assert.equal(transport.mock.callCount(), 1);
    });
  }
});
