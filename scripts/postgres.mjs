import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const statePath = path.join(root, '.local/runtime.json');
if (!fs.existsSync(statePath)) throw new Error('Run npm run setup first.');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const data = path.join(root, '.local/postgres');
const extension = process.platform === 'win32' ? '.exe' : '';
const guesses = [process.env.POSTGRES_BIN, path.join(os.homedir(), 'scoop/apps/postgresql/current/bin')].filter(Boolean);
const bin = guesses.find(dir => fs.existsSync(path.join(dir, `pg_ctl${extension}`)));
const exe = name => bin ? path.join(bin, name + extension) : name;
const environment = { ...process.env, PGPASSWORD: state.databasePassword, PGCONNECT_TIMEOUT: '5' };
function run(name, args, options = {}) {
  const result = spawnSync(exe(name), args, { cwd: root, env: environment, encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw new Error(`${name} unavailable. Install PostgreSQL or set POSTGRES_BIN to its bin directory. ${result.error.message}`);
  return result;
}
const action = process.argv[2] || 'status';
if (action === 'start') {
  if (!fs.existsSync(path.join(data, 'PG_VERSION'))) {
    fs.mkdirSync(data, { recursive: true });
    const pwfile = path.join(root, '.local/pg-init-password');
    fs.writeFileSync(pwfile, state.databasePassword, { mode: 0o600 });
    try {
      const init = run('initdb', ['-D', data, '-U', state.databaseUser, `--pwfile=${pwfile}`, '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--encoding=UTF8']);
      if (init.status !== 0) throw new Error(init.stderr || init.stdout);
    } finally { fs.unlinkSync(pwfile); }
  }
  const status = run('pg_ctl', ['-D', data, 'status']);
  if (status.status !== 0) {
    const started = run('pg_ctl', ['-D', data, '-l', path.join(root, '.local/postgres.log'), '-o', `-h 127.0.0.1 -p ${state.databasePort}`, '-w', '-t', '30', 'start'], { stdio: 'ignore' });
    if (started.status !== 0) throw new Error('PostgreSQL startup failed. Inspect .local/postgres.log.');
  }
  const existing = run('psql', ['-h', '127.0.0.1', '-p', String(state.databasePort), '-U', state.databaseUser, '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${state.databaseName}'`]);
  if (existing.status !== 0) throw new Error(existing.stderr);
  if (existing.stdout.trim() !== '1') {
    const created = run('createdb', ['-h', '127.0.0.1', '-p', String(state.databasePort), '-U', state.databaseUser, state.databaseName]);
    if (created.status !== 0) throw new Error(created.stderr);
  }
  console.log(`Project PostgreSQL ready at 127.0.0.1:${state.databasePort}/${state.databaseName}.`);
} else if (action === 'stop') {
  if (!fs.existsSync(path.join(data, 'PG_VERSION'))) { console.log('Project PostgreSQL is not initialized.'); process.exit(0); }
  const stopped = run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
  if (stopped.status !== 0) throw new Error(stopped.stderr || stopped.stdout);
  console.log('Project PostgreSQL stopped.');
} else {
  const status = run('pg_ctl', ['-D', data, 'status']);
  console.log(status.stdout.trim() || status.stderr.trim());
  process.exitCode = status.status;
}
