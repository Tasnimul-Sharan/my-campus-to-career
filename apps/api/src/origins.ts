/** Only local development accepts the equivalent localhost/IPv4 loopback host. */
export function allowedAppOrigins(appOrigin: string, environment: string | undefined): string[] {
  const origins = [appOrigin];
  if (environment !== 'development') return origins;
  const url = new URL(appOrigin);
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return origins;
  url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  origins.push(url.origin);
  return origins;
}

/** Match the entire browser Origin header without normalizing untrusted input. */
export function isAllowedRequestOrigin(origin: unknown, allowedOrigins: readonly string[]): boolean {
  return typeof origin === 'string' && allowedOrigins.includes(origin);
}
