import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.npm_execpath;
const command = process.argv[2] || 'dev';
if (!cli || !['dev', 'start'].includes(command)) throw new Error('Use npm run dev, or npm start after npm run build.');
const children = ['@campus/api', '@campus/web'].map(workspace => spawn(process.execPath, [cli, 'run', command, `--workspace=${workspace}`], { cwd: root, stdio: 'inherit', windowsHide: true }));
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) continue;
    if (process.platform === 'win32') {
      // Only terminate the workspace process tree this launcher started.
      // Killing the npm wrapper alone leaves Windows watchers holding the ports.
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else child.kill('SIGTERM');
  }
  process.exitCode = code;
}
for (const child of children) child.on('exit', code => { if (!ending) stop(code || 0); });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
