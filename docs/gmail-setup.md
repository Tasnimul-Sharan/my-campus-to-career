# Send application email from your personal Gmail

The API sends student verification and password-reset messages through the Gmail API over HTTPS. One owner authorizes their own personal Gmail account; students continue to use the application's email/password accounts and never authorize Google. This setup needs no owned domain, DNS records, Brevo account, Gmail App Password or Google API key.

Complete the Google account sign-in and consent yourself. Keep downloaded credentials and refresh tokens private: do not paste them into chat, screenshots, logs, Git, or Vercel. The following steps configure Google and Render; merely editing this repository does not create a Cloud project, authorize Gmail, send email, or deploy the service.

## 1. Create the Google project and enable Gmail

1. Open the [Google Cloud console](https://console.cloud.google.com/) while signed in to the personal Gmail account that will send mail.
2. Use the project selector at the top, choose **New Project**, and create a project such as `MyCampusToCareer Mail`. Select it after creation.
3. Open **APIs & Services > Library**, find **Gmail API**, and choose **Enable**. Confirm that the selected project is the new mail project. See Google's [Gmail API setup instructions](https://developers.google.com/workspace/gmail/api/quickstart/nodejs#enable_the_api).

## 2. Configure consent and the send-only scope

Open **Google Auth platform > Branding**. For a new project, choose **Get Started**:

1. Enter a recognizable app name, for example `MyCampusToCareer Mail`, and select your support email.
2. Choose **External** for the audience. A personal Gmail account does not use a Workspace organization's **Internal** audience.
3. Enter your contact email, review Google's policy, and finish with **Create**.
4. Open **Audience**. While the publishing status is **Testing**, choose **Add users** under **Test users** and add only the Gmail sender account.
5. Open **Data Access > Add or Remove Scopes**. Add and save only `https://www.googleapis.com/auth/gmail.send`. Select its Gmail API row, or enter that exact scope manually if needed.

These labels follow Google's [consent configuration guide](https://developers.google.com/workspace/guides/configure-oauth-consent). The `gmail.send` permission is a **sensitive** scope for sending mail; the helper does not request inbox reading, deletion, full mailbox access, or Google sign-in scopes. See the [official Gmail scope table](https://developers.google.com/workspace/gmail/api/auth/scopes).

## 3. Decide Testing versus In production before generating the deployed token

**Testing is suitable for an initial trial, but its Gmail refresh token expires after seven days.** The exception for basic identity-only scopes does not apply to `gmail.send`. To keep a Testing setup working, you must repeat consent and replace the Render token when it expires. See [Google's refresh-token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

For unattended sending, review the project's **Audience > Publishing status** and use **Publish app** to move to **In production** when ready. Generate a fresh token in step 5 after that change; do not rely on an earlier Testing token becoming long-lived. Publishing status is separate from verification and does not itself approve sensitive scopes. Google describes the distinction in [Manage App Audience](https://support.google.com/cloud/answer/15549945).

Google documents a **personal-use exception** to verification for a sole user or a few personally known users. Here only the sender owner authorizes Gmail access; students are email recipients, not Google OAuth users. Review whether the exception fits your use. An unverified app warning and OAuth user cap can still apply. If Google requires verification, complete its requirements; publishing does not waive them. Broader public Google integrations can require verification, branding, privacy-policy and domain-ownership evidence. See [sensitive-scope verification and its personal-use exception](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification#exceptions_to_verification_requirements).

Moving out of Testing removes the Testing-specific seven-day limit; it does not guarantee a permanent token. Revoking access, changing the Gmail password, prolonged non-use, or token/account limits can invalidate a grant. Repeat step 5 if authorization expires or is revoked. [Google token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

## 4. Create a Desktop OAuth client

1. Open **Google Auth platform > Clients > Create Client**.
2. Choose **Desktop app** and name it, for example `MyCampusToCareer local mail authorization`.
3. Create it, download its JSON configuration, and save it as `.local/gmail-client.json` inside this repository. If `.local` does not exist, create the folder. Do not put the JSON at the repository root or in a frontend/public directory.

Use the Desktop type because the authorization helper runs on your Windows PC. It receives Google's callback on a temporary `127.0.0.1` port. You do not add a Render or Vercel callback URL for this flow. See Google's [Desktop credentials instructions](https://developers.google.com/workspace/gmail/api/quickstart/nodejs#authorize_credentials_for_a_desktop_application).

## 5. Authorize locally and generate the Render settings

Use Node.js `22.12+` (the deployment uses Node `24`) and install this repository's dependencies. From the repository root, replace the example address with the same personal Gmail account used above:

```powershell
Set-Location -LiteralPath 'D:\Office Project\my-campus-to-career'
npm install
npm run gmail:authorize -- --sender your-account@gmail.com
```

The helper reads `.local/gmail-client.json`, prints a Google authorization URL, and waits for the local callback. Open that URL in Chrome on this same PC, select the sender account, and personally review and grant the send-email permission. Keep the terminal running until it completes. The URL uses offline authorization and PKCE so the API can later refresh short-lived access tokens without a recurring browser sign-in.

Google may show an unverified-app warning. Only proceed yourself if you recognize the project/client and accept the requested access. A blocked authorization or account security restriction must be resolved through Google; do not disable account protections to force a grant.

On success, the helper writes `.local/gmail-render.env` without printing the credential values. This ignored file contains:

| Variable | Meaning |
| --- | --- |
| `MAIL_MODE` | `gmail` |
| `GMAIL_CLIENT_ID` | The Desktop OAuth client ID |
| `GMAIL_CLIENT_SECRET` | That client's credential value |
| `GMAIL_REFRESH_TOKEN` | The sender's offline authorization token |
| `MAIL_FROM` | The plain authorized Gmail address, without a display name |

The helper does not send a test email. Keep both files private even though `.local/` is ignored by Git. If the output already exists, the helper preserves it; choose another ignored output for a replacement grant:

```powershell
npm run gmail:authorize -- --sender your-account@gmail.com --output .local/gmail-render-new.env
```

Use the new file when updating Render, then keep only the private copies you need. `--sender` records the intended address; you must choose that same account in Google's consent screen.

## 6. Add only the mail settings to Render

1. Open the existing API Web Service in Render, then **Environment**.
2. Choose **Add from .env**. Privately open the generated `.local/gmail-render.env` (or your replacement file) and paste/import its contents into Render's editor. Review the five mail variables above, then select **Save only** while preparing the code deployment. The new values become active on the next deployment. See [Render environment-variable instructions](https://render.com/docs/configure-environment-variables).
3. Preserve the service's existing production `DATABASE_URL`, `SESSION_SECRET`, `SESSION_DRIVER`, `APP_ORIGIN`, and other non-mail settings. Do not import `apps/api/.env` or replace the database with your Windows development connection.
4. Deploy the code version that supports `MAIL_MODE=gmail`, following the [Render deployment guide](render-deployment.md). Old Brevo settings are unnecessary after this version is deployed; `MAIL_MODE=brevo` is invalid in the new code.

Store Gmail credentials only on the API service. `MAIL_FROM` must be the exact account that granted permission; this guide does not configure alternate sender aliases.

Save the new mail values with **Save only** before pushing the Gmail-capable code. After reviewing the changes, these commands publish only the source, tests and documentation from this update:

```bash
git add README.md package.json apps/api/src/config.ts apps/api/src/mail.ts apps/api/src/mail-delivery.ts apps/api/tests/mail.test.mjs docs/gmail-setup.md docs/render-deployment.md scripts/gmail-authorize.mjs scripts/lib/gmail-oauth.mjs scripts/tests/gmail-oauth.test.mjs
git commit -m "Use Gmail API for application email"
git push origin master
```

If Render starts Auto-Deploy after the push, let it finish. Otherwise choose **Manual Deploy > Deploy latest commit**. The private `.local` credential files are intentionally excluded from these commands.

## 7. Verify a real message

After the new API deployment is live, register a student account using an inbox you can inspect. Confirm that the verification email arrives and its link works, then test password reset. Inspect spam and the sender's **Sent** folder if needed. API health only confirms service availability; startup deliberately performs no live Gmail probe, and a successful Gmail API response does not prove inbox delivery.

If sending fails:

| Symptom | What to check privately |
| --- | --- |
| Missing configuration at startup | All five mail settings are present in Render and the deployed code includes Gmail support |
| Consent blocked or wrong account | Gmail API enabled, External audience, sender added as a test user when Testing, correct Desktop JSON and selected Google account |
| Refresh authorization rejected | Testing token older than seven days, revoked access, password change, or changed OAuth client; generate a fresh grant and update Render |
| Permission denied | Gmail API enabled in the same project and `gmail.send` actually granted |
| Mail rejected or quota reached | Account sending limits, Gmail API limits, recipient validity, and Google's account notices |

Personal Gmail has sending limits; it is not an unlimited bulk-mail service. Google currently describes limits around 500 emails per day for personal Gmail, and enforcement may restrict sending. See [Gmail sending limits](https://support.google.com/mail/answer/22839). Separate [Gmail API quotas and billing thresholds](https://developers.google.com/workspace/gmail/api/reference/quota) also apply and can change. Check the current account and Cloud project limits before expanding use; no permanent free or unlimited service is promised.
