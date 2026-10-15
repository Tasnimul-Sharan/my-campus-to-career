# Deploy the API on Render

The frontend runs on Vercel; the NestJS API and PostgreSQL database run on Render. Use the same Render region for the API and database. These instructions use Brevo's HTTPS API for email, which works without SMTP ports. Replace descriptions in the settings tables with your own real values; they are not credentials or working example URLs.

## Email on a Free service

Render Free blocks outbound SMTP ports `25`, `465` and `587`. The API's `MAIL_MODE=brevo` transport sends through HTTPS on port `443`, so changing SMTP hosts or passwords is unnecessary. `MAIL_MODE=smtp` remains available on hosting that permits your provider's SMTP port. `MAIL_MODE=file` is development-only and is rejected in production. [Render Free limitations](https://render.com/docs/free#other-limitations)

1. Create or sign in to your [Brevo account](https://www.brevo.com/). Complete account verification and any transactional-email activation requested by Brevo.
2. Open **Settings > Senders, Domains, IPs > Senders**, then **Add a sender**. Enter a recognizable sender name and an email address you control. Save it, then enter the six-digit verification code sent to that inbox if prompted. [Brevo sender setup](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email)
3. Open **Settings > SMTP & API > API Keys**, then **Generate a new API key**. Give it a descriptive name, copy it once, and store it privately. Use this API key for `BREVO_API_KEY`, not an SMTP key, account password, or Gmail App Password. [Brevo API-key instructions](https://developers.brevo.com/docs/api-key-authentication)
4. Set `MAIL_FROM` to the verified sender's plain email address. Do not include a display name such as `Name <address>`. The application supplies the sender name.

A verified Gmail address can be used for initial testing, but Brevo replaces free-provider sender addresses with a compliant address when sending. For consistent branding and reliable delivery, use an address on a domain you control and authenticate that domain with Brevo's DNS records. [Sender-address replacement](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders)

At startup, the API validates the Brevo key and checks that transactional sending is enabled through `GET /v3/account`. If the account's relay is disabled, resolve activation with Brevo before redeploying. If Brevo blocks an unfamiliar outbound IP, review its security notification and authorize only the activity you recognize from this deployment. This check does not send email or establish inbox delivery. [Brevo account authentication](https://developers.brevo.com/docs/api-key-authentication)

## Render Web Service settings

Create a Node **Web Service** for this repository, or update the existing Campus API service. Do not edit unrelated services.

| Field | Setting |
| --- | --- |
| Name | A unique API service name, for example `campus-to-career-api` |
| Branch | `master` |
| Language | `Node` |
| Region | The database's region; the current setup uses Singapore |
| Root Directory | Leave blank; the commands run from the npm workspace repository root |
| Node.js | `24`, selected by the repository's `.nvmrc` |
| Health Check Path | `/api/v1/health` |

Build Command:

```bash
npm ci --include=dev && npm run generate && npm run build --workspace=@campus/api
```

Start Command:

```bash
npm run start --workspace=@campus/api
```

Do not use the repository-root `npm run build` here; it also builds the frontend. Prisma generation belongs in the build command so its output is present in the deployed service.

## Environment variables

Enter these in the API service's **Environment** settings. Do not upload the development `.env` unchanged or commit keys, passwords, database URLs, or session secrets.

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `API_HOST` | `0.0.0.0` |
| `DATABASE_URL` | The Render database's **Internal Database URL**, copied privately from its Connect panel |
| `APP_ORIGIN` | Your actual stable Vercel frontend origin, including `https://` and without a path |
| `SESSION_DRIVER` | `postgres` |
| `SESSION_SECRET` | A new random secret of at least 32 characters; Render's Generate button can create one |
| `MAIL_MODE` | `brevo` |
| `BREVO_API_KEY` | The real Brevo API key created above |
| `MAIL_FROM` | The plain verified sender email address |

Render supplies `PORT`; the application uses it automatically. Do not pin `API_PORT` to your local development port. The database and API must be in the same region for the internal connection. Use the external database URL only for trusted tools outside Render. [Render database connections](https://render.com/docs/postgresql-creating-connecting)

Existing `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASSWORD` settings are ignored in Brevo mode and can be removed from this service. SMTP mode still needs the provider host, port, username, password and sender settings, with `SMTP_SECURE` matching the provider's TLS instructions. Never put `BREVO_API_KEY` in frontend environment variables.

## Migrations

The current Render database's initial migration has already been applied. Do not reset or recreate it to change email providers.

On a paid API service, set **Pre-Deploy Command** to:

```bash
npm run db:migrate
```

Render runs it after building and before replacing the service. Pre-deploy commands are available on paid services. [Render deploy commands](https://render.com/docs/deploys#pre-deploy-command)

For a Free API service, run reviewed migrations from a trusted local terminal before deploying code that requires them. Privately configure `DATABASE_URL` for that command with Render's **External Database URL** and the external TLS settings required by your client, then run from the repository root:

```bash
npm run generate
npm run db:migrate
```

The internal `dpg-...` hostname cannot be used from your Windows PC. Confirm the target database privately before running migrations; restore your local development connection afterward if you changed its configuration. Keep credentials out of terminal history and screenshots.

## Publish and connect Vercel

1. Review the changed files and run `npm run test:mail` and `npm run typecheck` locally. Commit and push the reviewed changes to `master` yourself when ready. Local edits alone do not update Render. Pushing to the linked branch may trigger Render when Auto-Deploy is enabled; otherwise choose **Manual Deploy > Deploy latest commit**. This guide does not push code or deploy anything automatically. [Render deployment triggers](https://render.com/docs/deploys)
2. Save the real production variables and deploy the API service. Check that the deployed commit includes Brevo support; an older commit will not recognize `MAIL_MODE=brevo`.
3. After the service is **Live**, copy its actual HTTPS `onrender.com` origin from its service page. Open that origin followed by `/api/v1/health` and confirm an OK response.
4. In Vercel's **Production** environment, set `API_ORIGIN` to that Render origin without `/api/v1`, then redeploy the frontend. Set Render's `APP_ORIGIN` to the exact stable HTTPS frontend origin visitors use. Random Vercel preview URLs will not match that origin.
5. Manually register a test student, receive and open the verification email, sign in, and complete a password-reset flow. Inspect Brevo transactional logs if delivery fails. A healthy API and an accepted provider request do not prove a message reached the inbox.

Free services sleep after inactivity, and Free Render Postgres expires after 30 days and has no managed backups. Use persistent production plans and backups before a public launch. [Render Free service and database limits](https://render.com/docs/free)
