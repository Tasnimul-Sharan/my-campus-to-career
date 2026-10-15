# Phase one verification

Verified locally on 13 October 2026.

| Check | Result |
| --- | --- |
| Prisma client generation | Passed with Prisma 7.10.0 |
| PostgreSQL migration | Applied to the dedicated project database |
| TypeScript checks | Passed for frontend and backend |
| Production builds | Passed for Next.js and NestJS |
| API integration suite | 14 tests passed, zero failures |
| Production dependency audit | Zero reported advisories at verification time |
| Browser registration | Account created through the actual frontend/API |
| Browser profile persistence | University and skill remained after reload |
| Browser login and logout | Passed through the frontend |
| Browser admin sign-in | Authorized dashboard and real empty student list loaded |
| Responsive profile | Checked at 360 px width with no horizontal overflow |
| Desktop dashboard | Checked at 1440 px width |

The API suite checks CSRF and origin rejection, duplicate email normalization,
unknown role/ownership fields, private profiles, verification expiry and token
reuse, administrator authorization, suspension auditing, generic reset responses,
password-reset session invalidation and logout. Test students and development
emails are removed by the suite.

Prisma CLI is a root development dependency. Root overrides pin patched
`deepmerge-ts` and `mysql2` dependencies; the latter belongs to Prisma tooling,
while this application uses PostgreSQL. Nodemailer is pinned to a patched
release. Recheck audits when upgrading or deploying.

This verification covers the local first phase. Courses, workshops, payments,
file uploads and job applications are later phases. Real inbox delivery requires
SMTP settings; local verification uses the file email transport.

## English interface update — 13 October 2026

All existing public, authentication, student and administrator interfaces use
English, including validation, accessibility labels and page metadata. Interface
dates and numbers use English formatting with the Asia/Dhaka timezone.
Student-entered profile content is preserved.

- Frontend and backend TypeScript checks passed.
- The Next.js production build passed for all existing routes.
- No Bengali characters or Bengali locale settings remain in product source.
- Homepage checked at 360 px and 1440 px with no horizontal overflow.
- Registration page inspected in the browser with English labels and help text.
- Existing email templates already use English.

## Homepage polish — 13 October 2026

Reworked the public homepage with larger section headings and spacing, four
journey navigation cards, expanded profile cards, numbered onboarding steps,
six descriptive roadmap cards, an illustrated closing CTA and a fuller footer.
All styles are scoped to the homepage in `apps/web/src/app/home.css`.

- Browser checks passed at 320, 360, 820 and 1440 px widths without horizontal overflow.
- Mobile profile and roadmap descriptions render at 16 px.
- All in-page navigation targets exist; the closing CTA opens registration.
- English copy and Available now / Planned feature states are preserved.
- Tablet/mobile illustration clipping found during QA was corrected.

## Lenis smooth scrolling — 13 October 2026

Added Lenis 1.3.26 to the homepage in a client-only effect. Wheel and anchor
scrolling use Lenis; touch stays native. The library honors reduced-motion
preferences, stops inertia on navigation, and destroys its RAF/listeners when
leaving the homepage. `html.lenis` prevents duplicate native CSS smoothing.

- Production build and TypeScript checks passed.
- Browser wheel input activated `lenis-scrolling lenis-smooth`.
- Desktop and mobile anchor navigation preserve URL hashes and the 28 px inset.
- Navigating to registration removes the Lenis classes; returning initializes again.
- npm installation audit reported zero vulnerabilities.

Integration follows the [official Lenis documentation](https://github.com/darkroomengineering/lenis).
