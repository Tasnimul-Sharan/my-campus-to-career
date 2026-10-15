import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.env.TEST_API_ORIGIN || 'http://127.0.0.1:4000';
const url = new URL(target);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('Integration tests create test accounts. Only a local API target is allowed.');
}
const response = await fetch(`${target}/api/v1/health`);
if (!response.ok) throw new Error('Start the project API and database before integration testing.');
const child = spawn(process.execPath, ['--test', 'tests/integration.test.mjs'], {
  cwd: path.join(root, 'apps/api'), stdio: 'inherit', windowsHide: true,
  env: { ...process.env, TEST_API_ORIGIN: target }
});
child.on('exit', code => { process.exitCode = code || 0; });
