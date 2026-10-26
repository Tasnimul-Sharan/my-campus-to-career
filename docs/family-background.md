# Optional family background

Students can save family or guardian information from **My profile → Family background**. Every field is optional. The section uses the existing **Save profile** action and does not affect profile completion or talent-directory publishing requirements.

Supported fields:

- Father's name and occupation, each up to 100 characters.
- Mother's name and occupation, each up to 100 characters.
- Guardian's name, up to 100 characters, and relationship to the guardian, up to 60 characters.
- Number of siblings, a whole number from 0 to 50, or blank.
- Additional family information, up to 1,000 characters.

The authenticated student's `GET /api/v1/profile` returns a canonical `familyBackground` object with empty strings and `siblings: null` when no information has been saved. Existing accounts remain compatible. `PATCH /api/v1/profile` accepts a validated nested `familyBackground` object; partial nested updates retain omitted values. Empty strings and `siblings: null` clear the corresponding values.

The account's existing session, student-role, origin and CSRF checks apply. The student's own account profile is the only interface for this data. Another student cannot read or edit it. Family information is excluded from public talent cards, public profiles, directory filters/search and the administrator's student list. Publishing a talent profile does not publish this section.

The additive migration `20261026000000_family_background` adds one JSON profile column with an empty-object default. It does not change existing academic, career, photo, document or account data. No new environment variables or dependencies are required.

Verify with `npm run generate`, `npm run test:family`, the talent regression tests, type checks and a production build. Use invented family details in disposable local or production test accounts. Do not send email or use real students' family information for testing.
