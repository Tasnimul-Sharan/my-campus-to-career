# Deploy the API on Render Free

The frontend runs on Vercel; the NestJS API and PostgreSQL database run on Render. Email uses one authorized personal Gmail account through the Gmail API over HTTPS. Complete the [Gmail setup guide](gmail-setup.md) first to obtain `.local/gmail-render.env`. This path needs no owned domain or DNS changes.

Render Free blocks outbound SMTP ports `25`, `465` and `587`. `MAIL_MODE=gmail` uses HTTPS on port `443`; a Gmail App Password cannot fix blocked SMTP ports. SMTP remains available on compatible hosts, and file email remains a local development transport. [Render Free limitations](https://render.com/docs/free#other-limitations).

## Render Web Service settings

Update the existing Campus API service for this repository. Use the same region as its database; do not recreate the database to change email providers.

| Field | Setting |
| --- | --- |
| Service type | Web Service |
| Name | Keep the existing service name |
| Branch | `master` |
| Language | `Node` |
| Instance Type | `Free` |
| Region | The database's region; the current setup uses Singapore |
| Root Directory | Leave blank; commands run from the npm workspace repository root |
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

The API build needs Prisma generation. The repository-root `npm run build` also builds the frontend, so use the API workspace command shown above.

## Environment variables

Open the API service's **Environment** settings. Preserve its existing production database and session values. The following table shows the complete production configuration; replace descriptions with real private values.

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `API_HOST` | `0.0.0.0` |
| `DATABASE_URL` | Keep the Render database's **Internal Database URL** |
| `APP_ORIGIN` | `https://my-campus-to-career.vercel.app` |
| `SESSION_DRIVER` | `postgres` |
| `SESSION_SECRET` | Keep the existing strong production secret; if missing, generate a unique value of at least 32 characters |
| `MAIL_MODE` | `gmail` |
| `GMAIL_CLIENT_ID` | From the generated private mail settings file |
| `GMAIL_CLIENT_SECRET` | From the same file |
| `GMAIL_REFRESH_TOKEN` | From the same file, authorized by the sender |
| `MAIL_FROM` | That sender's plain personal Gmail address |

Use **Add from .env** to import only the five mail entries from `.local/gmail-render.env` (or your replacement output). Privately paste/import the contents in Render's editor and review the changes, then choose **Save only** while preparing the code deployment. Deploy the new source after pushing it so the Gmail settings and Gmail-capable build become active together. Do not import `apps/api/.env`: it contains development database, origin and session settings. Do not share the credential file or put Gmail secrets in Vercel. [Render environment variables](https://render.com/docs/configure-environment-variables).

Render supplies `PORT`, which the API uses automatically. Do not set `API_PORT` to the Windows development port. The database and API must be in the same region for the internal connection. Use the database's External Database URL only from trusted tools outside Render. [Render database connections](https://render.com/docs/postgresql-creating-connecting).

Deploy the new code when changing `MAIL_MODE`; an old build will not recognize `gmail`. After the Gmail version is deployed, remove obsolete `BREVO_API_KEY` from this service. The new code ignores that key and rejects `MAIL_MODE=brevo`. Existing `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASSWORD` are unused in Gmail mode and can be removed from this API service. Keep `MAIL_MODE=file` for local integration tests; production rejects file delivery.

At startup the API validates required Gmail configuration without contacting Google. This lets a temporary Google outage leave the rest of the API available, but also means **Live** status or `/api/v1/health` does not verify the refresh token, sending permission, or inbox delivery. A real verification/reset email is the delivery check.

## Migrations

The current database's initial migration has already been applied. The Gmail transport change does not require a schema migration or database reset.

For future schema changes on a paid API service, set **Pre-Deploy Command** to:

```bash
npm run db:migrate
```

Pre-deploy commands are available on paid services. [Render deploy commands](https://render.com/docs/deploys#pre-deploy-command).

For future schema changes on Free, run reviewed migrations from a trusted local terminal before deploying code that requires them. Privately configure `DATABASE_URL` for that command with Render's **External Database URL** and the external TLS settings required by your client, then run from the repository root:

```bash
npm run generate
npm run db:migrate
```

The internal `dpg-...` hostname is inaccessible from a Windows PC outside Render. Confirm the target privately before migrating, and restore your local development connection afterward if you changed it. Keep credentials out of command history and screenshots.

## Push, deploy and connect Vercel

1. Review the changes and run `npm run test:mail`, `npm run test:gmail-auth` and `npm run typecheck` locally. Save the real Gmail variables on the API service using **Save only**, ready for the new build.
2. Commit and push the reviewed Gmail changes to `master` yourself when ready. Local edits do not update Render. Auto-Deploy may start a deployment after a push; if it does, let that deployment finish. Otherwise select **Manual Deploy > Deploy latest commit**. Check that Render deploys the Gmail-capable commit and read its build/start logs without exposing credentials. [Render deployment triggers](https://render.com/docs/deploys).
3. When it is **Live**, open [the API health endpoint](https://my-campus-to-career.onrender.com/api/v1/health) and confirm an OK response. This is the existing API origin; if Render shows a different service URL, use that actual origin in the next step.
4. In Vercel's **Production** environment, set `API_ORIGIN=https://my-campus-to-career.onrender.com`, without `/api/v1`. Redeploy the frontend after changing it. Render's `APP_ORIGIN` must match the stable frontend address, `https://my-campus-to-career.vercel.app`, exactly; update both values if the actual URLs change. Vercel preview origins do not match the stable production origin.
5. Register a test student, receive and open the verification email, sign in, and complete password reset. Only the sender owner authorizes Gmail; students do not need a Google Cloud project, Gmail grant, or Google sign-in. Check spam and the sender's Sent folder if mail is missing. A Gmail API success does not guarantee inbox placement.

Keep track of Google's OAuth status: **External + Testing** Gmail refresh tokens expire after seven days. For unattended use, review **In production**, personal-use eligibility and any verification requirements, then create a fresh token as described in the [Gmail guide](gmail-setup.md#3-decide-testing-versus-in-production-before-generating-the-deployed-token). Grants can still be revoked or invalidated, and sending/account quotas apply.

Free web services sleep after inactivity and have usage limits. Free Render Postgres expires after 30 days and has no backups; use durable plans and backups before depending on it for real student data. [Render Free service and database limits](https://render.com/docs/free). Gmail also has account and API limits, so this setup does not promise unlimited or permanently free operation.
