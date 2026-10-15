type BrevoSettings = { apiKey: string; from: string };
type LinkMessage = { email: string; subject: string; text: string };

// Messages from this class are safe to log: never include provider bodies or credentials.
export class MailDeliveryError extends Error {
  constructor(message: string) { super(message); this.name = 'MailDeliveryError'; }
}

function responseFailure(status: number): MailDeliveryError {
  const action = status === 401 ? 'Check BREVO_API_KEY; use an API key, not an SMTP key.'
    : status === 403 ? 'Check Brevo account activation, API permissions and allowed IP settings.'
    : status === 400 ? 'Check the verified MAIL_FROM sender and email settings in Brevo.'
    : status === 429 ? 'The Brevo sending or request limit has been reached.'
    : status >= 500 ? 'Brevo is temporarily unavailable. Try again later.'
    : 'Check the Brevo account and email configuration.';
  return new MailDeliveryError(`Brevo API request failed (HTTP ${status}). ${action}`);
}

async function brevoRequest(path: '/account' | '/smtp/email', settings: BrevoSettings, body?: object) {
  let response: Response;
  try {
    response = await fetch(`https://api.brevo.com/v3${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { 'api-key': settings.apiKey, accept: 'application/json', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new MailDeliveryError('Brevo HTTPS connection failed or timed out. Check network access and provider availability.');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw responseFailure(response.status);
  }
  try {
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {
    // Do not expose provider responses: they can contain email addresses and account data.
  }
  throw new MailDeliveryError('Brevo returned an invalid response. Check provider availability.');
}

export async function verifyBrevo(settings: BrevoSettings): Promise<void> {
  const data = await brevoRequest('/account', settings) as { relay?: { enabled?: boolean } };
  if (data.relay?.enabled !== true) {
    throw new MailDeliveryError('Brevo transactional email is not enabled. Complete account activation in Brevo.');
  }
}

export async function sendBrevoEmail(settings: BrevoSettings, message: LinkMessage): Promise<void> {
  const data = await brevoRequest('/smtp/email', settings, {
    sender: { email: settings.from, name: 'MyCampusToCareer' },
    to: [{ email: message.email }], subject: message.subject, textContent: message.text,
  }) as { messageId?: unknown };
  if (typeof data.messageId !== 'string' || !data.messageId.trim()) {
    throw new MailDeliveryError('Brevo did not confirm email acceptance. Check transactional email logs in Brevo.');
  }
}
