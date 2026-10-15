# Phase-one architecture

এই ধাপে MyCampusToCareer-এর student account, profile এবং admin access-এর ভিত্তি তৈরি করা হচ্ছে। সাতটি মূল feature-এর মধ্যে registration/profile ও basic admin dashboard এই release-এর scope; course, workshop, payment, project/certificate upload এবং job application পরের ধাপে যুক্ত হবে।

## Components

```text
Browser
  │ http://127.0.0.1:3000
  ▼
Next.js + React + Tailwind CSS
  │ /api/v1/* — same-origin proxy
  ▼
NestJS API :4000
  ├── Authentication / authorization / validation
  ├── Student profile / education / skills / social links
  ├── Admin overview / student management
  ├── Email transport
  └── Prisma → PostgreSQL :5442
                   └── PostgreSQL sessions (local default)
```

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Web | Next.js, React, Tailwind CSS | Responsive pages, forms, dashboard, API client |
| API | NestJS, TypeScript | Business rules, authenticated requests, admin guards |
| Database | PostgreSQL, Prisma | Relational data, migrations, data access |
| Session | PostgreSQL / optional Redis | Server-side login session persistence |
| Email | Local files / production SMTP | Verification and reset-password messages |
| Local infrastructure | Dedicated PostgreSQL runtime; Docker alternative | Isolated database and optional services |

## Request and authentication flow

The web app calls `/api/v1` on its own origin. Next.js forwards these requests to NestJS, so browser requests do not need a separate public API address in local development. The API validates input, verifies the session and authorization, and then accesses PostgreSQL through Prisma.

Passwords are hashed before storage. The browser receives an HTTP-only session cookie; the session record stays on the server. Authentication tokens for verification and password reset are single-use and have an expiry. Development email is written locally for testing; production must use an actual SMTP service.

State-changing browser requests use CSRF protection. A valid session alone does not grant admin permissions: admin endpoints also verify the account role. Student endpoints derive the student identity from the authenticated account; an input field cannot change another student's profile or promote the account to admin.

## Data boundaries

- **Account:** email, password hash, role, verification and account status.
- **Student profile:** name, objective, university information and approved personal fields.
- **Education and skills:** related records managed by the profile owner.
- **Social links and activities:** profile content with validated input.
- **Sessions and auth tokens:** server-managed records, never public profile fields.
- **Administration:** aggregate counts and student management behind admin authorization.

Family information should remain optional and private. This phase does not expose a public student directory. Course purchases, workshop seats and applications need their own modules and data models in later phases.

## Local and production separation

Local PostgreSQL uses the dedicated `campus_to_career` database on port `5442`; runtime data and development mail live under the ignored `.local/` directory. Existing PostgreSQL installations are not required to share this data directory.

Redis is optional locally. Set `SESSION_DRIVER=redis` only after configuring a Redis service. The Docker configuration is an alternative infrastructure setup for PostgreSQL, Redis and Mailpit; starting it is an explicit developer action.

Production requires HTTPS, secure cookies, a persistent PostgreSQL service, SMTP, secret management and backups. Deploy Next.js and NestJS as separate managed processes, apply reviewed Prisma migrations, and route `/api/v1` to the API. Live payment processing is outside this release.

## Repository ownership

```text
apps/web/       Pages, components, browser-side API integration
apps/api/       NestJS modules, Prisma schema, migrations, seed
scripts/        Local setup and infrastructure helpers
docs/           Architecture and release checks
.local/         Ignored runtime state, logs and development mail
```

Keep database access and authorization in the API. Frontend route checks help the user experience but are not a security boundary. Add the remaining business modules behind the same API and authorization patterns after phase one is verified.

`scripts/api-dev.mjs` compiles the API with `tsc` before starting TypeScript watch mode and Node watch mode. This preserves NestJS decorator metadata in development. Prisma client generation is a separate setup step; run `npm run generate` after installation and after changing the Prisma schema.
