# Student talent directory

The homepage helps employers browse students by their preferred career area. Academic subject, university, skills, location and availability are separate filters. A student chooses one primary category, a short career headline and their availability in **My profile → Career interests**.

## Publishing and contact

Profiles are private by default, including accounts created before this feature. A verified, active student can publish their directory profile after adding a category, university, subject, career objective and at least one skill. Saving an incomplete profile privately remains supported. Students can unpublish from the same form.

Publishing shares the student's name, picture, chosen category and headline, skills, city, university and subject. The public detail page also includes the career objective, academic history, campus activities and the LinkedIn, GitHub and portfolio links they choose to add. It does not share their account email, phone number, family background, private PDF documents or authentication data.

Employers can view these profiles without an account and use the student's shared professional links to connect. A separate employer account, private messaging system and interview invitations are not part of this directory implementation. No email or hiring action is triggered by browsing.

Unpublished, suspended, unverified and administrator accounts are excluded from listing, search, metadata and public detail. Public pictures require the same eligibility before and after the provider download. Original image assets remain authenticated in Cloudinary. The private owner/admin picture route keeps its original access checks.

## API

- `GET /api/v1/talent/meta` returns category counts and bounded filter options derived from eligible published profiles.
- `GET /api/v1/talent` accepts `q`, `category`, `subject`, `university`, `city`, `skill`, `availability` and `page`. Results contain nine students per page and stable pagination. Filters combine with AND; keyword search examines public fields only.
- `GET /api/v1/talent/:userId` returns a deliberately selected public profile, without account credentials or private contact fields.
- `GET /api/v1/talent/:userId/picture` returns the eligible student's current processed WebP image, with `private, no-store` and `nosniff`. Unpublishing or removing the photo prevents new downloads.
- Existing authenticated `PATCH /api/v1/profile` saves the additional career fields and the publishing preference with the other profile details. Origin, CSRF and session checks remain required.

Names, university and department values are student-entered. Keyword and academic filters help discovery; category membership is a self-selected career interest, not a claim that the platform has independently verified someone's qualifications.

## Rollout and verification

The additive `20261025000000_talent_directory` migration adds profile fields, a fixed availability enum, a category constraint and indexes. It uses `directoryPublished = false` for existing profiles. It does not publish existing accounts or reset any data.

1. Run `npm run generate` and apply `npm run db:migrate` to the intended database.
2. Build and deploy the API, then deploy the frontend using the existing Vercel/Render configuration. No new environment variables or service credentials are needed.
3. Run `npm run test:talent`, the existing document/profile-picture tests, type checks and production builds.
4. Verify a private student is absent, publishing makes the profile discoverable, category and subject filters work independently, safe detail fields are correct, and unpublishing/suspension immediately prevents new detail and picture requests.

Browser previews use clearly named demo students in an isolated local PostgreSQL database. Demo profiles are never seeded into the production directory. Production checks use a disposable test account and remove it, its sessions and its test assets afterward.
