export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; }
}

const friendlyErrors: Record<string, string> = {
  'An account with this email already exists.': 'An account with this email already exists. Sign in or reset your password.',
  'Invalid email or password, or account unavailable.': 'The email or password is incorrect, or this account is unavailable.',
  'Please sign in.': 'Please sign in to continue.',
  'Your session is no longer active. Please sign in again.': 'Your session has expired. Please sign in again.',
  'Administrator access is required.': 'Admin access is required for this action.',
  'Student access is required.': 'A student account is required for this action.',
  'Invalid CSRF token.': 'The security check failed. Please try again.',
  'This link is invalid or expired. Please request a new one.': 'This link is invalid or expired. Please request a new one.',
  'This link has already been used.': 'This link has already been used. Please request a new one if needed.',
  'Verification email could not be sent. Please try again later.': 'We could not send the verification email. Please try again later.',
};

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    let csrfResponse: Response;
    try { csrfResponse = await fetch('/api/v1/auth/csrf', { credentials: 'include', cache: 'no-store' }); }
    catch { throw new ApiError(0, 'Unable to connect to the server. Check your connection and try again.'); }
    if (!csrfResponse.ok) throw new ApiError(csrfResponse.status, 'Unable to complete the security check. Please try again.');
    const csrf = await csrfResponse.json() as { csrfToken: string };
    headers.set('X-CSRF-Token', csrf.csrfToken);
    if (!(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }
  let response: Response;
  try { response = await fetch(`/api/v1${path}`, { ...options, method, headers, credentials: 'include', cache: 'no-store' }); }
  catch { throw new ApiError(0, 'Unable to connect to the server. Check your connection and try again.'); }
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = Array.isArray(data.message) ? data.message.join(' ') : typeof data.message === 'string' ? data.message : 'We could not complete your request. Please try again.';
    throw new ApiError(response.status, response.status === 429 ? 'Too many attempts. Please wait a moment and try again.' : friendlyErrors[message] || message);
  }
  return data as T;
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
export type User = { id: string; name: string; email: string; role: 'STUDENT' | 'ADMIN'; emailVerified: boolean; status: 'ACTIVE' | 'SUSPENDED'; createdAt?: string; profilePictureUrl?: string | null };
export type Education = { institution: string; degree: string; field: string; startYear?: number; endYear?: number };
export type Profile = {
  phone: string; city: string; objective: string; university: string; department: string; semester: string; degree: string; passingYear: number | null;
  skills: string[]; socialLinks: { linkedin?: string; github?: string; portfolio?: string }; activities: string; educations: Education[];
  talentCategory: '' | import('./talent').TalentCategory; headline: string; availability: import('./talent').TalentAvailability; directoryPublished: boolean;
};
export const emptyProfile: Profile = { phone: '', city: '', objective: '', university: '', department: '', semester: '', degree: '', passingYear: null, skills: [], socialLinks: {}, activities: '', educations: [], talentCategory: '', headline: '', availability: 'OPEN_TO_OPPORTUNITIES', directoryPublished: false };
