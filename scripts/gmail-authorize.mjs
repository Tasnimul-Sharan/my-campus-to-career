import { readFile, writeFile, mkdir, access, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { GmailAuthorizationError, parseDesktopClient, receiveGoogleAuthorization, exchangeGoogleAuthorization } from './lib/gmail-oauth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = resolve(root, '.local');

async function main() {
  const options = {};
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Connect the sender Gmail account with the send-only Gmail API permission.');
    console.log('Usage: npm run gmail:authorize -- [--sender address@gmail.com] [--client path/to/desktop-client.json] [--output .local/gmail-render-new.env]');
    console.log('Default client: .local/gmail-client.json. Default private output: .local/gmail-render.env.');
    console.log('The helper does not send email, print tokens, or edit the development API environment.');
    return;
  }
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!['--sender', '--client', '--output'].includes(name) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new GmailAuthorizationError('Invalid arguments. Run npm run gmail:authorize -- --help for usage.');
    }
    options[name.slice(2)] = args[index + 1];
  }
  const output = resolve(root, options.output || '.local/gmail-render.env');
  const relativeOutput = relative(local, output);
  if (!relativeOutput || relativeOutput.startsWith('..') || isAbsolute(relativeOutput)) {
    throw new GmailAuthorizationError('Save the private configuration inside the ignored .local directory.');
  }
  try {
    await access(output);
    throw new GmailAuthorizationError('The private output file already exists. Choose --output .local/gmail-render-new.env to keep the existing credentials.');
  } catch (error) {
    if (error instanceof GmailAuthorizationError) throw error;
    if (error.code !== 'ENOENT') throw new GmailAuthorizationError('Could not check the private output file.');
  }
  await mkdir(dirname(output), { recursive: true });
  const physicalOutput = relative(await realpath(local), await realpath(dirname(output)));
  if (physicalOutput.startsWith('..') || isAbsolute(physicalOutput)) {
    throw new GmailAuthorizationError('The private output directory must stay inside .local.');
  }
  let parsed;
  try { parsed = JSON.parse(await readFile(resolve(root, options.client || '.local/gmail-client.json'), 'utf8')); }
  catch { throw new GmailAuthorizationError('Could not read the Desktop OAuth client JSON. Save it as .local/gmail-client.json or pass --client with its private local path.'); }
  const client = parseDesktopClient(parsed);
  let sender = options.sender;
  if (!sender) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { sender = await prompt.question('Sender Gmail address (use the same account in the Google consent screen): '); }
    finally { prompt.close(); }
  }
  sender = sender.trim();
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(sender)) {
    throw new GmailAuthorizationError('Enter one plain sender email address without a display name.');
  }
  console.log('Open the following Google authorization URL in your own browser. Select the sender account and review the send-only permission.');
  const authorization = await receiveGoogleAuthorization({ clientId: client.clientId, loginHint: sender, onReady: url => console.log(url) });
  const refreshToken = await exchangeGoogleAuthorization(client, authorization);
  const contents = Object.entries({ MAIL_MODE: 'gmail', GMAIL_CLIENT_ID: client.clientId,
    GMAIL_CLIENT_SECRET: client.clientSecret, GMAIL_REFRESH_TOKEN: refreshToken, MAIL_FROM: sender })
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
  await mkdir(dirname(output), { recursive: true });
  try { await writeFile(output, contents, { mode: 0o600, flag: 'wx' }); }
  catch { throw new GmailAuthorizationError('Could not save the private configuration. Choose a new output file and authorize again.'); }
  console.log(`Private Render settings saved to ${relative(root, output)}. No tokens were printed.`);
  console.log('Import that file into the Render API service environment. Keep it out of screenshots, chat and Git.');
  console.log('This has not tested email delivery. After deployment, test registration, verification and password reset.');
}

main().catch(error => {
  console.error(error instanceof GmailAuthorizationError ? error.message : 'Gmail authorization failed. Check the local setup and try again.');
  process.exitCode = 1;
});
