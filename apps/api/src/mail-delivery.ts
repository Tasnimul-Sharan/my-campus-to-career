import MailComposer from 'nodemailer/lib/mail-composer';

type GmailSettings = { clientId: string; clientSecret: string; refreshToken: string; from: string };
type LinkMessage = { email: string; subject: string; text: string };

// Messages from this class are safe to log: never include provider bodies or credentials.
export class MailDeliveryError extends Error {
  constructor(message: string) { super(message); this.name = 'MailDeliveryError'; }
}

// Read only small JSON responses; never attach provider data to an error or log it.
async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) return;
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function tokenFailure(status: number, payload: unknown): MailDeliveryError {
  const code = isRecord(payload) ? payload.error : undefined;
  if (code === 'invalid_grant') {
    return new MailDeliveryError('Google OAuth refresh token was rejected [GMAIL_REFRESH_TOKEN_REJECTED]. Authorize the Gmail account again and update GMAIL_REFRESH_TOKEN using the same OAuth client.');
  }
  if (code === 'invalid_client') {
    return new MailDeliveryError('Google OAuth client was rejected [GMAIL_OAUTH_CLIENT_REJECTED]. Check GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET from the same OAuth client.');
  }
  const action = status === 401 || status === 403
    ? 'Check the Google OAuth client credentials and Gmail account authorization.'
    : status === 429 ? 'Google OAuth request limits have been reached. Try again later.'
    : status >= 500 ? 'Google OAuth is temporarily unavailable. Try again later.'
    : 'Check the Google OAuth client and authorize the Gmail account again.';
  return new MailDeliveryError(`Google OAuth token request failed (HTTP ${status}). ${action}`);
}

function sendFailure(status: number): MailDeliveryError {
  const action = status === 401
    ? 'Gmail rejected the access token. Check the OAuth authorization before trying again.'
    : status === 403 ? 'Check that the Gmail API is enabled, gmail.send permission is granted, and the mailbox can send email within its limits.'
    : status === 400 ? 'Check MAIL_FROM and the Gmail sender account settings.'
    : status === 429 ? 'Gmail sending or request limits have been reached. Try again later.'
    : status >= 500 ? 'Gmail is temporarily unavailable. Check the Gmail Sent folder before requesting another message.'
    : 'Check the Gmail API configuration and account settings.';
  return new MailDeliveryError(`Gmail API request failed (HTTP ${status}). ${action}`);
}

function validAddress(value: string): boolean {
  return /^[^\s<>@,;:"\\]+@[^\s<>@,;:"\\]+\.[^\s<>@,;:"\\]+$/.test(value)
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export class GmailDelivery {
  private cachedToken?: { value: string; expiresAt: number };
  private refreshingToken?: Promise<string>;

  constructor(private readonly settings: GmailSettings) {}

  private async accessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.value;
    }
    if (this.refreshingToken) return this.refreshingToken;
    this.refreshingToken = this.refreshAccessToken();
    try { return await this.refreshingToken; }
    finally { this.refreshingToken = undefined; }
  }

  private async refreshAccessToken(): Promise<string> {
    let response: Response;
    try {
      response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.settings.clientId, client_secret: this.settings.clientSecret,
          refresh_token: this.settings.refreshToken, grant_type: 'refresh_token' }),
      });
    } catch {
      throw new MailDeliveryError('Google OAuth HTTPS connection failed or timed out. Check network access and Google availability.');
    }
    const data = await readJson(response);
    if (!response.ok) throw tokenFailure(response.status, data);
    if (!isRecord(data) || typeof data.access_token !== 'string' || !data.access_token.trim()
      || /[\u0000-\u0020\u007f]/.test(data.access_token)
      || (data.token_type !== undefined && (typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer'))
      || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      throw new MailDeliveryError('Google OAuth returned an invalid token response. Check Google availability and OAuth configuration.');
    }
    this.cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return this.cachedToken.value;
  }

  async send(message: LinkMessage): Promise<void> {
    if (!validAddress(this.settings.from) || !validAddress(message.email)
      || /[\u0000-\u001f\u007f]/.test(message.subject)) {
      throw new MailDeliveryError('Email contains an invalid sender, recipient or subject header.');
    }
    let raw: string;
    try {
      const mime = await new MailComposer({
        from: { name: 'MyCampusToCareer', address: this.settings.from }, to: message.email,
        subject: message.subject, text: message.text, textEncoding: 'base64',
        disableFileAccess: true, disableUrlAccess: true,
      }).compile().build();
      raw = mime.toString('base64url');
    } catch {
      throw new MailDeliveryError('Email message could not be composed. Check the mail configuration.');
    }
    const accessToken = await this.accessToken();
    let response: Response;
    try {
      response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
    } catch {
      // Sending is never retried: a lost response may follow successful delivery.
      throw new MailDeliveryError('Gmail HTTPS send failed or timed out. Delivery may have succeeded; check the Gmail Sent folder before requesting another message.');
    }
    if (!response.ok) {
      if (response.status === 401) this.cachedToken = undefined;
      await response.body?.cancel().catch(() => undefined);
      throw sendFailure(response.status);
    }
    const data = await readJson(response);
    if (!isRecord(data) || typeof data.id !== 'string' || !data.id.trim()) {
      throw new MailDeliveryError('Gmail did not confirm email acceptance. Check the Gmail Sent folder before requesting another message.');
    }
  }
}
