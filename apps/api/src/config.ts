import 'dotenv/config';
import { resolve } from 'node:path';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadConfig() {
  const production = process.env.NODE_ENV === 'production';
  const databaseUrl = required('DATABASE_URL');
  if (!['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) throw new Error('DATABASE_URL must be a PostgreSQL URL.');
  const sessionSecret = required('SESSION_SECRET');
  if (sessionSecret.length < 32 || /^(changeme|replace|your[-_])/i.test(sessionSecret)) throw new Error('SESSION_SECRET must contain at least 32 random characters.');
  const appUrl = new URL(required('APP_ORIGIN'));
  if (!['http:', 'https:'].includes(appUrl.protocol) || appUrl.username || appUrl.password) throw new Error('APP_ORIGIN must be an HTTP or HTTPS website origin without credentials.');
  const appOrigin = appUrl.origin;
  if (production && !appOrigin.startsWith('https://')) throw new Error('Production APP_ORIGIN must use HTTPS.');
  const emailMode = process.env.MAIL_MODE || process.env.EMAIL_MODE || 'file';
  if (!['file', 'smtp'].includes(emailMode)) throw new Error('MAIL_MODE must be file or smtp.');
  if (production && emailMode !== 'smtp') throw new Error('Production requires MAIL_MODE=smtp.');
  const sessionDriver = process.env.SESSION_DRIVER || 'postgres';
  if (!['postgres', 'redis'].includes(sessionDriver)) throw new Error('SESSION_DRIVER must be postgres or redis.');
  const redisUrl = sessionDriver === 'redis' ? required('REDIS_URL') : undefined;
  const smtp = emailMode === 'smtp' ? {
    host: required('SMTP_HOST'), port: Number(required('SMTP_PORT')), secure: process.env.SMTP_SECURE === 'true',
    auth: { user: required('SMTP_USER'), pass: required('SMTP_PASSWORD') }, from: process.env.MAIL_FROM || required('EMAIL_FROM'),
  } : undefined;
  if (smtp && (!Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535)) throw new Error('Invalid SMTP_PORT.');
  const port = Number(process.env.API_PORT || process.env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT.');
  return { production, databaseUrl, sessionSecret, appOrigin, emailMode, sessionDriver, redisUrl, smtp, port,
    host: process.env.API_HOST || process.env.HOST || '127.0.0.1', mailOutboxDir: resolve(process.env.MAIL_OUTBOX_DIR || '../../.local/mail'),
    sessionMaxAge: 1000 * 60 * 60 * 24 * 7 };
}

export const config = loadConfig();
