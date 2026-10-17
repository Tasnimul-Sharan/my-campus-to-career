# Phase-one acceptance checklist

এই তালিকা release যাচাই করার জন্য। একটি item এখানে থাকলেই test pass হয়েছে ধরে নেওয়া যাবে না; চালানো checks-এর ফল development report-এ আলাদাভাবে লিখতে হবে।

## Student account

- [ ] A new student can register with valid details.
- [ ] Duplicate email and invalid inputs receive clear errors.
- [ ] Registration cannot choose or overwrite the admin role.
- [ ] Development verification mail appears in `.local/mail`.
- [ ] Verification succeeds once; expired or reused links fail safely.
- [ ] Login and logout update the UI and session correctly.
- [ ] A restart preserves an unexpired database-backed session.
- [ ] Password-reset requests avoid revealing whether an email exists.
- [ ] A valid reset link changes the password; reused or expired links fail.
- [ ] A suspended/inactive account cannot use protected actions.

## Student profile

- [ ] An authenticated student can read and edit their own profile.
- [ ] Objective, education, skills and social links persist after reload.
- [ ] Required fields, length limits and URL validation work.
- [ ] One student cannot read or change another student's private profile.
- [ ] Unsaved changes and API errors are understandable in the UI.
- [ ] Family information, if collected, is optional and private.

## Admin access

- [ ] A unique admin account can be created using local environment settings.
- [ ] An authenticated admin sees overview counts and the student list.
- [ ] Pagination/search and supported student-status actions work.
- [ ] An unauthenticated request is denied.
- [ ] A student session is denied access to every admin endpoint.
- [ ] Admin secrets are absent from source control and browser responses.

## Technical checks

- [ ] A clean dependency installation completes.
- [ ] Prisma client generation completes before migrations and API startup.
- [ ] Database migration and seed commands complete.
- [ ] Type checking and automated tests complete.
- [ ] API and web production builds complete.
- [ ] CSRF protection rejects a mutation without the required token.
- [ ] Session cookies use the intended local/production settings.
- [ ] Forms work at mobile and desktop widths with keyboard input.
- [ ] Loading, empty, error and success states are visible.
- [ ] No console errors or leaked secrets appear during the tested flows.
- [ ] Local database, mail and generated files are ignored by Git.

## Scope check

The account/profile foundation and basic administration are extended by the private PDF document module. Follow the Cloudinary document guide for its migration, storage configuration and acceptance checks. Course catalogue/enrollment, physical workshop registration, payments and job applications remain planned modules. Any navigation to these modules must clearly identify their availability. No external integration should be represented as working until configured and verified.
