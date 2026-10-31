# Education results and additional social links

**My profile → Education details** includes optional CGPA and a grading scale for the main university record and each additional qualification. A student can choose a 4.00 or 5.00 scale, save a value from zero to that scale with up to two decimal places, or leave CGPA blank. Zero is retained. CGPA is not required for profile completion or talent-directory publication.

The main private profile uses `cgpa: number | null` and `cgpaScale: 4 | 5`. Qualification entries use the same fields. Existing records default to no grade and a 4.00 scale. A partial main-profile patch retains omitted values; `cgpa: null` explicitly clears a grade. Lowering the scale below the current grade is rejected until the grade is also changed or cleared. A published profile shares the grades the student chooses to enter on its public detail page; grades do not appear in directory cards, filters or ranking.

**My profile → Online presence** retains LinkedIn, GitHub and portfolio fields. **Add link** creates an extra row with a link name and URL, and the remove button deletes that row. Students can add up to eight extra links, each with a 1–40-character label and a full HTTP or HTTPS URL of at most 500 characters. Both values are required in an added row; remove an unused row to save. URLs with embedded credentials and other protocols are rejected.

The private API stores these entries as `socialLinks.additional: { label: string; url: string }[]` inside the existing JSON field. Nested partial patches preserve omitted fixed links and extra links. An empty string clears a fixed link; `additional: []` clears the extra list. Blank links and malformed legacy values are excluded from canonical output. Publishing exposes only the allowed labels and safe URLs on the public detail page. Links use new tabs with `noopener`, `noreferrer` and `nofollow`; labels render as escaped text. Family details, email, phone, private documents and account secrets remain excluded.

## Migration and verification

The additive `20261031000000_profile_education_links` migration adds nullable `cgpa` and default-4 `cgpaScale` columns to `StudentProfile` and `Education`. PostgreSQL check constraints restrict scales to 4 or 5 and grades to the selected scale. No existing data is deleted. Extra social links reuse the current JSON column. No new service, dependency, or environment variable is required.

Run `npm run generate`, apply the migration to the intended database, then build the API and web app. Run `npm run test:profile-enhancements`, family and talent regressions, and type checks. Test grade clearing, scale changes, link add/edit/remove, save/reload, private/public projection and student isolation with synthetic accounts in an isolated local database. Do not send real email or use real students' records for test fixtures.

The existing development configuration can point to a hosted database. Confirm the actual target before migrating; test in a dedicated localhost database first. A production database migration and deployment require the corresponding user authorization.
