import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local');
fs.mkdirSync(local, { recursive: true });
fs.mkdirSync(path.join(local, 'mail'), { recursive: true });
const statePath = path.join(local, 'runtime.json');
let state;
if (fs.existsSync(statePath)) state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
else {
  state = { databaseUser: 'campus_dev', databasePassword: crypto.randomBytes(24).toString('hex'), databaseName: 'campus_to_career', databasePort: 5442 };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}
const apiEnv = path.join(root, 'apps/api/.env');
if (!fs.existsSync(apiEnv)) {
  fs.writeFileSync(apiEnv, [
    'NODE_ENV=development', 'PORT=4000', 'HOST=127.0.0.1',
    'APP_ORIGIN=http://127.0.0.1:3000',
    `DATABASE_URL=postgresql://${state.databaseUser}:${state.databasePassword}@127.0.0.1:${state.databasePort}/${state.databaseName}?schema=public`,
    `SESSION_SECRET=${crypto.randomBytes(48).toString('hex')}`,
    'SESSION_DRIVER=postgres', 'REDIS_URL=redis://127.0.0.1:6379',
    'MAIL_MODE=file', `MAIL_OUTBOX_DIR=${JSON.stringify(path.join(local, 'mail').replaceAll('\\', '/'))}`,
    'MAIL_FROM=MyCampusToCareer <hello@mycampustocareer.local>',
    'ADMIN_EMAIL=admin@mycampustocareer.local',
    `ADMIN_PASSWORD=${crypto.randomBytes(20).toString('base64url')}`,
    ''
  ].join('\n'), { mode: 0o600 });
  console.log('Created apps/api/.env with unique local credentials. Secrets are not printed.');
}
const webEnv = path.join(root, 'apps/web/.env.local');
if (!fs.existsSync(webEnv)) fs.writeFileSync(webEnv, 'API_ORIGIN=http://127.0.0.1:4000\n');
console.log('Local setup ready. Run npm run db:start, npm run db:migrate, npm run db:seed, then npm run dev.');
