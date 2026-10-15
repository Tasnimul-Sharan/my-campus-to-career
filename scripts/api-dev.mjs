import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cwd = path.join(root, 'apps/api');
const compiler = path.join(root, 'node_modules/typescript/bin/tsc');
const initial = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.build.json'], { cwd, stdio: 'inherit', windowsHide: true });
if (initial.status !== 0) process.exit(initial.status || 1);
const children = [
  spawn(process.execPath, [compiler, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], { cwd, stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, ['--watch', 'dist/main.js'], { cwd, stdio: 'inherit', windowsHide: true })
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of children) child.on('exit', code => { if (!stopping) stop(code || 0); });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
