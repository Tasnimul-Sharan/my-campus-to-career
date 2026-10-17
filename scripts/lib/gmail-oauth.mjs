import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export class GmailAuthorizationError extends Error {
  constructor(message) { super(message); this.name = 'GmailAuthorizationError'; }
}

export function parseDesktopClient(value) {
  const client = value?.installed;
  if (!client || typeof client.client_id !== 'string' || !client.client_id.endsWith('.apps.googleusercontent.com')
    || typeof client.client_secret !== 'string' || !client.client_secret.trim()) {
    throw new GmailAuthorizationError('Use the downloaded Google OAuth Desktop app client JSON, not a Web application client or API key.');
  }
  return { clientId: client.client_id.trim(), clientSecret: client.client_secret.trim() };
}

export function createGoogleAuthorization(clientId, redirectUri, loginHint) {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
    response_type: 'code', scope: GMAIL_SEND_SCOPE, access_type: 'offline', prompt: 'consent',
    include_granted_scopes: 'false', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  if (loginHint) url.searchParams.set('login_hint', loginHint);
  return { url: url.toString(), state, verifier };
}

function matchesState(value, expected) {
  const actual = Buffer.from(value || '');
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export async function receiveGoogleAuthorization({ clientId, loginHint, onReady, timeoutMs = 300_000 }) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new GmailAuthorizationError('Could not open the local Google authorization callback.')));
    server.listen(0, '127.0.0.1', resolve);
  });
  const redirectUri = `http://127.0.0.1:${server.address().port}/`;
  const authorization = createGoogleAuthorization(clientId, redirectUri, loginHint);
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      let completed = false;
      const finish = (error, code) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        error ? reject(error) : resolve({ code, verifier: authorization.verifier, redirectUri });
      };
      server.on('error', () => finish(new GmailAuthorizationError('The local authorization callback failed. Run the helper again.')));
      server.on('request', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        let callback;
        try { callback = new URL(req.url || '/', redirectUri); }
        catch { res.writeHead(400); res.end('<p>Invalid authorization callback.</p>'); return; }
        if (req.method !== 'GET' || req.headers.host !== new URL(redirectUri).host || callback.pathname !== '/') {
          res.writeHead(404); res.end('<p>Authorization callback not found.</p>'); return;
        }
        if (completed || callback.searchParams.getAll('state').length !== 1
          || !matchesState(callback.searchParams.get('state'), authorization.state)) {
          res.writeHead(400); res.end('<p>Authorization state was not accepted. Use the link printed by the local helper.</p>'); return;
        }
        if (callback.searchParams.has('error') || callback.searchParams.getAll('code').length !== 1 || !callback.searchParams.get('code')) {
          res.writeHead(400);
          res.once('finish', () => finish(new GmailAuthorizationError('Google authorization was declined or incomplete. Run the helper again when ready.')));
          res.end('<p>Authorization was not completed. Return to your terminal.</p>'); return;
        }
        const code = callback.searchParams.get('code');
        res.once('finish', () => finish(undefined, code));
        res.end('<h1>Google authorization received</h1><p>Return to your terminal to finish saving the private configuration. You can close this tab.</p>');
      });
      timer = setTimeout(() => finish(new GmailAuthorizationError('Google authorization timed out. Run the helper again.')), timeoutMs);
      Promise.resolve().then(() => onReady(authorization.url)).catch(() => finish(new GmailAuthorizationError('Could not display the Google authorization link.')));
    });
  } finally {
    clearTimeout(timer);
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}

export async function exchangeGoogleAuthorization(client, authorization) {
  let response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret,
        grant_type: 'authorization_code', code: authorization.code, code_verifier: authorization.verifier,
        redirect_uri: authorization.redirectUri }), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new GmailAuthorizationError('Could not reach Google to finish authorization. Run the helper again.');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new GmailAuthorizationError(`Google authorization exchange failed (HTTP ${response.status}). Check the Desktop client and consent settings, then run the helper again.`);
  }
  let data;
  try { data = await response.json(); } catch {}
  if (!data || typeof data.refresh_token !== 'string' || !data.refresh_token.trim()) {
    throw new GmailAuthorizationError('Google did not return an offline refresh token. Run the helper again and grant the requested send permission.');
  }
  if (typeof data.scope === 'string') {
    const scopes = data.scope.trim().split(/\s+/);
    if (scopes.length !== 1 || scopes[0] !== GMAIL_SEND_SCOPE) {
      throw new GmailAuthorizationError('Google returned a different permission set. Use a dedicated Desktop client with only the gmail.send scope.');
    }
  }
  return data.refresh_token;
}
