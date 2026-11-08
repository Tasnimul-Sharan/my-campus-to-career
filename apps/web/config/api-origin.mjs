/**
 * Resolve the API proxy origin before generating Next.js rewrites.
 * Vercel builds must never silently target the development server.
 * @param {{ API_ORIGIN?: string, VERCEL?: string, VERCEL_URL?: string, VERCEL_PROJECT_PRODUCTION_URL?: string }} [env]
 * @returns {string}
 */
export function resolveApiOrigin(env = process.env) {
  if (env.VERCEL !== '1') {
    return (env.API_ORIGIN || 'http://127.0.0.1:4000').replace(/\/$/, '');
  }

  const value = env.API_ORIGIN?.trim();
  if (!value) {
    throw new Error('API_ORIGIN is required for Vercel deployments. Set it to the public HTTPS API origin without /api/v1.');
  }

  const invalidOrigin = () => new Error('API_ORIGIN on Vercel must be a public HTTPS origin, such as https://api.example.com, without a path, credentials, query or fragment. Local addresses are not allowed.');
  let url;
  try { url = new URL(value); }
  catch { throw invalidOrigin(); }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const local = host === 'localhost' || host.endsWith('.localhost')
    || /^127\./.test(host) || host === '0.0.0.0' || host === '[::1]' || host === '[::]';
  if (!/^https:\/\/[^/?#\\]+\/?$/i.test(value) || url.protocol !== 'https:' || local
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw invalidOrigin();
  }
  for (const frontendUrl of [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (!frontendUrl) continue;
    let frontendOrigin;
    try {
      frontendOrigin = new URL(/^https?:\/\//i.test(frontendUrl) ? frontendUrl : `https://${frontendUrl}`).origin;
    } catch { continue; }
    if (url.origin === frontendOrigin) {
      throw new Error('API_ORIGIN on Vercel must use a separate backend HTTPS origin to prevent recursive frontend rewrites.');
    }
  }
  return url.origin;
}
