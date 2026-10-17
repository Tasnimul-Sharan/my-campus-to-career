export type VerificationDelivery = 'sent' | 'failed' | 'unknown';

const storageKey = 'campus.verification-delivery';
const maxAge = 10 * 60 * 1000;

export function registrationDelivery(message: unknown): VerificationDelivery {
  if (message === 'Account created. Verification email could not be sent; use Resend verification.') return 'failed';
  if (message === 'Account created. Please check your email to verify your address.') return 'sent';
  return 'unknown';
}

// Store only a fixed delivery status, never addresses, tokens or provider errors.
export function rememberVerificationDelivery(userId: string, delivery: VerificationDelivery): boolean {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify({ userId, delivery, createdAt: Date.now() }));
    return true;
  } catch { return false; }
}

export function readVerificationDelivery(userId: string): VerificationDelivery {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(storageKey) || 'null');
    if (!value || typeof value !== 'object') return 'unknown';
    const record = value as Record<string, unknown>;
    if (record.userId !== userId || typeof record.createdAt !== 'number'
      || Date.now() - record.createdAt < 0 || Date.now() - record.createdAt > maxAge) return 'unknown';
    return record.delivery === 'sent' || record.delivery === 'failed' ? record.delivery : 'unknown';
  } catch { return 'unknown'; }
}

export function clearVerificationDelivery() {
  try { window.sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
}
