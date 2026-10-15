import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Use npm run dev.');
const children = ['@campus/api', '@campus/web'].map(workspace => spawn(process.execPath, [cli, 'run', 'dev', `--workspace=${workspace}`], { cwd: root, stdio: 'inherit', windowsHide: true }));
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of children) child.on('exit', code => { if (!ending) stop(code || 0); });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
