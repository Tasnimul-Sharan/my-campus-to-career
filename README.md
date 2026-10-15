# MyCampusToCareer

A campus-to-career platform for university students. The first phase includes student registration, sign-in, profiles and a basic admin dashboard. All product pages, messages and emails use English.

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

`npm run setup` creates `apps/api/.env`, `apps/web/.env.local` and `.local/runtime.json` with unique local database/session secrets and an admin password. Existing files are preserved. Inspect `ADMIN_EMAIL` and `ADMIN_PASSWORD` privately in `apps/api/.env` when signing in as admin. Do not commit these values, print them in logs or reuse example passwords. The API's `.env.example` lists available settings.

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

Development email is a local testing transport. It does not send messages to a real inbox. Production requires SMTP configuration. The admin account should use a different email address from the student account used for testing.

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
| Student registration and profile | Registration, verification, login, reset password and profile editing |
| Course catalogue and enrollment | Planned for the next development phase |
| Physical workshop registration | Planned |
| Payment and confirmation | Planned; no live payments |
| Project/certificate upload | Planned |
| Job listing and application | Planned |
| Admin dashboard | Basic overview and student management |

Do not treat the planned modules as completed features. Their payment, seat-capacity, upload and application rules will be implemented and tested in their respective phases.

## Verify changes

Run these checks from the root directory:

```powershell
npm run typecheck
npm run build
npm run test:integration
```

Run integration tests in a second terminal while the database and API are running. They require the API's generated `.env`, `MAIL_MODE=file`, and a seeded admin whose `ADMIN_EMAIL`/`ADMIN_PASSWORD` match those settings. `npm run test:integration` verifies the local API health and rejects nonlocal targets. To change the local API target, set `TEST_API_ORIGIN` to its origin without `/api/v1`.

The suite is `apps/api/tests/integration.test.mjs`. It creates temporary `integration-*` student accounts and email files, tests account/profile/admin workflows and security failures, then cleans up its own test records and mail. `npm test` invokes this same backend integration suite directly; it is not a separate unit-test suite, so running both commands does not add coverage. Prefer the root `test:integration` command for its target check.

For a user-level review, follow [the phase-one acceptance checklist](docs/phase-one-checklist.md). Test student access and admin access separately, including rejected unauthorized requests. Record actual command results; a checklist item is not evidence that it has passed.

See [architecture](docs/architecture.md) for the request flow, data boundaries and deployment requirements.

## Production configuration

Use HTTPS with secure session cookies, unique secrets, production SMTP, persistent PostgreSQL and backups. Keep credentials outside source control. Apply reviewed Prisma migrations during deployment and run the web and API through a process manager or managed hosting platform. Configure Redis explicitly before selecting `SESSION_DRIVER=redis`.

Local setup is for development. Real email, domain configuration, production hosting and live payment integration must be configured and verified before public launch.
# my-campus-to-career
