# MyCampusToCareer

A campus-to-career platform for university students and employers discovering student talent. The application includes student registration, sign-in, profiles, an optional public talent directory, private PDF documents and an admin dashboard. All product pages, messages and emails use English.

**Stack:** Next.js + Tailwind CSS + NestJS + TypeScript + PostgreSQL + Prisma. Local sessions use PostgreSQL; Redis is optional.

## Start locally on Windows

Use Node.js `22.12+` and npm, with PostgreSQL command-line binaries available. Run commands from this project directory:

```powershell
Set-Location -LiteralPath 'D:\Office Project\my-campus-to-career'
npm install
npm run setup
npm run generate
npm run db:start
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run setup` creates `apps/api/.env`, `apps/web/.env.local` and `.local/runtime.json` with unique local database/session secrets and an admin password. Existing files are preserved. Inspect `ADMIN_EMAIL` and `ADMIN_PASSWORD` privately in `apps/api/.env` when signing in as admin. Do not commit these values, print them in logs or reuse example passwords. See the [Render deployment guide](docs/render-deployment.md) for production environment settings.

| Service | Local address / location |
| --- | --- |
| Website | http://127.0.0.1:3000 |
| NestJS API | http://127.0.0.1:4000/api/v1 |
| PostgreSQL | 127.0.0.1:5442, database `campus_to_career` |
| Development email | `.local/mail/` |
| Local runtime state | `.local/` |

Keep `127.0.0.1` consistent when opening the app; switching between it and `localhost` changes the browser cookie origin. The web app forwards `/api/v1/*` requests to the API.

The local database helper uses an isolated PostgreSQL data directory under `.local/postgres/`. It detects the installed Scoop PostgreSQL binaries or binaries on `PATH`. For another installation, set `POSTGRES_BIN` to its `bin` directory before running `db:start`. Use `npm run db:status` to inspect the project database and `npm run db:stop` to stop it. Stop the development web/API processes with Ctrl+C in their terminal.

`npm run generate` generates the Prisma client required by the API, migrations and seed. Repeat it after Prisma schema changes. The development API uses TypeScript compilation and Node watch mode so NestJS receives the decorator metadata required for dependency injection and validation.

The root dependency on `@nestjs/platform-express` keeps npm's root security overrides effective for the workspace's pinned Multer dependency. Keep its version aligned with `apps/api/package.json`; removing the root dependency can cause npm to retain the older transitive version even when the override is present. Production dependency audit and upload regression tests cover this arrangement.

## Docker alternative

Use this only if you prefer Docker to the native PostgreSQL helper. PostgreSQL data in Docker is separate from `.local/postgres/`; changing infrastructure does not copy existing records.

1. Start Docker Desktop. Stop native project PostgreSQL with `npm run db:stop` if it is running; both use port `5442`.
2. Create an ignored root `.env` file and set `POSTGRES_PASSWORD` to a unique password privately.
3. Set `DATABASE_URL` in `apps/api/.env` to the Docker database: host `127.0.0.1`, port `5442`, user `campus_dev`, database `campus_to_career`, and the password from the root `.env`. URL-encode special characters in the password.
4. Run `docker compose up -d`, then `npm run db:migrate` and `npm run db:seed`.
5. Run `npm run dev`. Use `docker compose down` to stop the containers; retained named volumes keep their data.

The compose file runs PostgreSQL, Redis and Mailpit. `SESSION_DRIVER=postgres` remains the default; choose `SESSION_DRIVER=redis` with `REDIS_URL=redis://127.0.0.1:6379` to use the local Redis service. Mailpit's inbox is at http://127.0.0.1:8025, but API email stays in `.local/mail/` unless SMTP settings are explicitly configured. Keep `MAIL_MODE=file` when running the integration suite.

## Use the first version

1. Open the website and register a student account.
2. Read the generated verification email under `.local/mail/` and open its link.
3. Sign in and update the student profile.
4. Reload the page to verify that the saved data persists.
5. Sign in with the admin account configured for the seed to inspect the admin dashboard.
6. Test logout and password reset using the generated development email.

Development email is a local testing transport. It does not send messages to a real inbox. Production on Render Free uses the Gmail API over HTTPS with one personal Gmail sender. Follow the [Gmail setup guide](docs/gmail-setup.md) to authorize that account and generate the required private settings. SMTP remains available on hosts that permit its ports. File delivery is development-only. The admin account should use a different email address from the student account used for testing.

## Project layout

```text
apps/
  web/       Next.js pages, Tailwind styles and API integration
  api/       NestJS modules, Prisma schema, migrations and seed
scripts/     Local development helpers
docs/        Architecture and acceptance checks
.local/      Ignored database files, runtime state and development mail
```

## Feature scope

| Agreed feature | Phase-one scope |
| --- | --- |
| Student registration and profile | Registration, verification, login, reset password, profile editing, profile pictures and an opt-in talent directory with career categories and academic filters |
| Course catalogue and enrollment | Planned for the next development phase |
| Physical workshop registration | Planned |
| Payment and confirmation | Planned; no live payments |
| Project/certificate upload | Private PDF upload, download and deletion; configure Cloudinary |
| Job listing and application | Planned |
| Admin dashboard | Basic overview, student management and document directory |

Do not treat the planned modules as completed features. Their payment, seat-capacity and application rules will be implemented and tested in their respective phases. Follow the [Cloudinary document guide](docs/cloudinary-documents.md) before enabling PDF uploads in a deployment.

Students can choose one to three career categories and publish their profile from **My profile → Career interests**. Employers browse the homepage directory and open public profiles with student-selected professional links. Existing accounts stay private until the student opts in; email, phone and private documents are excluded. See the [talent directory guide](docs/talent-directory.md) and [multiple career categories guide](docs/career-categories.md).

The optional **Family background** section saves parent information, religion and a short note privately with the student's account. It is excluded from public talent profiles and does not affect profile completion. See the [family background guide](docs/family-background.md).

The optional **Address details** section saves permanent and current addresses privately, with 64 Bangladesh district options and a **Same as permanent address** shortcut. See the [address guide](docs/profile-addresses.md).

Students can add optional CGPA and a grading scale to their education and qualifications, plus up to eight extra labeled social links. See the [education and social links guide](docs/profile-education-links.md).

## Verify changes

Run these checks from the root directory:

```powershell
npm run typecheck
npm run build
npm run test:mail
npm run test:gmail-auth
npm run test:documents
npm run test:profile-pictures
npm run test:talent
npm run test:family
npm run test:addresses
npm run test:profile-enhancements
npm run test:career-categories
npm run test:integration
```

`npm run test:mail` runs focused email transport/configuration tests with mocked provider requests. `npm run test:gmail-auth` tests the local OAuth helper with mocked exchanges and local callbacks. Neither command sends email or requires live Google credentials or consent.

`npm run test:documents` checks private PDF validation, storage and document access rules with mocked operations. It does not upload to a real Cloudinary account or read private credentials.

`npm run test:profile-pictures` checks image validation, private picture access, replacement and cleanup with synthetic images and mocked operations. See the [profile picture guide](docs/profile-pictures.md) for its additive migration and rollout checks.

Run integration tests in a second terminal while the database and API are running. They require the API's generated `.env`, `MAIL_MODE=file`, and a seeded admin whose `ADMIN_EMAIL`/`ADMIN_PASSWORD` match those settings. `npm run test:integration` verifies the local API health and rejects nonlocal targets. To change the local API target, set `TEST_API_ORIGIN` to its origin without `/api/v1`.

The suite is `apps/api/tests/integration.test.mjs`. It creates temporary `integration-*` student accounts and email files, tests account/profile/admin workflows and security failures, then cleans up its own test records and mail. `npm test` invokes this same backend integration suite directly; it is not a separate unit-test suite, so running both commands does not add coverage. Prefer the root `test:integration` command for its target check.

For a user-level review, follow [the phase-one acceptance checklist](docs/phase-one-checklist.md). Test student access and admin access separately, including rejected unauthorized requests. Record actual command results; a checklist item is not evidence that it has passed.

See [architecture](docs/architecture.md) for the request flow, data boundaries and deployment requirements.

## Production configuration

Use HTTPS with secure session cookies, unique secrets, a configured Gmail API sender (or SMTP on a compatible host), persistent PostgreSQL and backups. Keep credentials outside source control. Apply reviewed Prisma migrations during deployment and run the web and API through a process manager or managed hosting platform. Configure Redis explicitly before selecting `SESSION_DRIVER=redis`.

Local setup is for development. Configure and verify real email and durable production hosting before public launch. The personal Gmail setup needs no owned domain or DNS changes; account limits and Google OAuth requirements still apply. Live payment integration belongs to a later phase.

For the API service, follow the [Render deployment guide](docs/render-deployment.md). It covers Gmail email over HTTPS on Render Free, the required environment variables, migrations, and the Vercel connection. Start with the [Gmail setup guide](docs/gmail-setup.md) for Google Cloud and the local authorization helper (`npm run gmail:authorize -- --sender your-account@gmail.com`). Students keep using the existing email/password sign-in; only the sender owner grants Google access.
# my-campus-to-career

## Deploy the frontend with Vercel CLI

Use the existing linked Vercel project. Run the CLI from this repository root,
not from `apps/web`. Configure the project's Build and Deployment settings:

| Setting | Value |
| --- | --- |
| Root Directory | `apps/web` |
| Framework Preset | Next.js |
| Build Command | `npm run build` |
| Install Command | Automatic/default |
| Output Directory | Next.js default |
| Node.js | `24.x` |

The repository-root build includes the NestJS API and is not the frontend
build target. A fresh API build requires Prisma generation; it belongs to the
separate backend deployment.

Keep `.vercelignore` in place. Vercel CLI does not use `.gitignore` as its upload
filter, so the explicit rules exclude `.local/`, environment files, dependencies
and generated output while keeping workspace manifests and the root lockfile.

Set `API_ORIGIN` in the Vercel Production environment to the actual hosted API
origin, without `/api/v1`. Rebuild after changing it. Until the API is hosted,
public pages can render but account/profile API operations will not work.

After confirming the existing project settings, deploy from the repository root:

```bash
vercel --prod --scope tasnimulsharans-projects
```

Use [Vercel monorepo guidance](https://vercel.com/docs/monorepos) and
[CLI upload exclusions](https://vercel.com/docs/deployments/vercel-ignore).
