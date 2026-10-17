# Private student PDFs with Cloudinary

The document module adds student `/documents` and administrator `/admin/documents` pages. The existing NestJS session and PostgreSQL user accounts remain the authority for access. Students upload CVs, certificates and project reports; administrators can search and download student documents.

## Limits and access

- Only active students with a verified email may upload.
- One PDF per request, at most **4 MiB** (`4,194,304` bytes), and ten documents per student including incomplete uploads. The size leaves room for multipart fields below the Vercel request-body limit.
- The API admits two uploads at a time and rate-limits new uploads. Oversized multipart requests stop before the complete file reaches memory.
- The API checks the actual PDF structure, encryption and unsafe active content in a bounded worker. Extension and browser MIME type alone are insufficient. This validation is not a malware scanner.
- Original files are stored as Cloudinary **raw** assets with delivery type **authenticated**. No public permanent asset URL is returned to the browser or stored as a download link.
- Students list, download and delete their own documents. Administrators list and download documents across students. Ownership comes from the authenticated session, never a submitted student ID.
- Downloads require an access check and use an API-signed URL valid for at most five minutes, with attachment delivery. Cloudinary's raw download endpoint may use the random stored filename rather than the original name.

Cloudinary documents [raw assets and delivery types](https://cloudinary.com/documentation/upload_parameters) and [time-limited private downloads](https://cloudinary.com/documentation/control_access_to_media#providing_time_limited_access_to_private_media_assets). Render's local filesystem is ephemeral; it is not the durable document store.

## Private configuration

The API needs all three variables:

```dotenv
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

Keep these values only in the API environment. Do not use `NEXT_PUBLIC_` variables, frontend code, a public upload preset or a Git-tracked file. The ignored `.local/cloudinary-render.env` file is a convenient private import file for Render. Local API settings live in the ignored `apps/api/.env`; restart the API after changing them. A backup taken before adding storage settings is kept privately as `.local/api-before-cloudinary.env`.

If no Cloudinary settings are configured, account/profile features still work and documents show a storage-unavailable message. Partial or invalid Cloudinary settings fail configuration validation so a broken secret is not silently accepted.

The API key must be allowed to **create/upload media files**, read/download the authenticated assets, and delete its document assets. Naming a key does not grant those permissions. A Cloudinary HTTP 403 with `missing permissions` and `actions=["create"]` is an account/key permission issue. Use **Settings > API Keys > the key's three-dot menu > Assign Roles**. The Console's Master Admin role grants full Admin and Upload API access for the product environment; Media Library User also needs folder roles assigned programmatically. Keep a privileged backend key private and review narrower folder access when configuring a shared product environment. Do not make student documents public as a workaround. See Cloudinary's [API key permissions](https://cloudinary.com/documentation/product_environment_settings#api_key_permissions) and [role assignment instructions](https://cloudinary.com/documentation/dam_admin_role_management#assign_roles_to_api_keys).

Some Cloudinary accounts restrict PDF/ZIP delivery in product-environment security settings. Confirm PDF delivery is permitted if a valid private download is rejected. Settings and plan availability can change; use the provider's current console and support guidance. Successful upload alone does not prove downloading works.

If a secret has been shared in a chat or screenshot, rotate it in Cloudinary, update the private local/import files and Render, verify the replacement, then disable the old key. Do not paste the replacement secret into chat.

## Database and rollout

`20261017000000_student_documents` only adds document enums, a table, indexes and its user foreign key. It does not reset users or modify existing profiles. PostgreSQL stores metadata and the Cloudinary object key; PDF bytes stay in Cloudinary.

1. Review the migration and run `npm run generate`.
2. Confirm the intended database privately, then run `npm run db:migrate`. The current local API configuration may target Render; never infer the target from the command's working directory.
3. Import the three Cloudinary settings into the existing Render API service through **Environment > Add from .env**, then **Save only**. Keep database, Gmail, session and origin settings.
4. Push the document-capable code and let the configured deploy finish, or choose **Deploy latest commit** if auto-deploy is disabled. Render commands remain those in the [deployment guide](render-deployment.md).
5. Deploy the frontend containing `/documents` and `/admin/documents`. No Cloudinary secret belongs in Vercel.
6. Use a verified test student to upload, download and delete an ordinary PDF. Confirm a second student cannot access it, an administrator can download it, and an unsigned asset URL is denied.

Do not represent the module as live until the new migration, credentials, API and frontend are all deployed and a real Cloudinary upload/download has passed.

## Failure handling

The API reserves one quota slot before contacting Cloudinary and releases the database lock before network access. Files remain inaccessible until status becomes `READY`. Cloudinary/network failures do not trigger automatic reuploads. If upload outcome is uncertain, a `DELETING` reservation keeps the minted object key so cleanup can be retried; wait two minutes before removing an incomplete upload. Refresh the list after interruption rather than uploading duplicates.

Deletion first marks the document for removal, deletes the private object, then removes its metadata. If storage is unavailable, the student can retry deletion. User deletion is restricted while documents exist, preventing accidental orphaning of private files. Account suspension and existing session checks continue to apply. A signed link already issued remains a bearer link until it expires or the underlying object is deleted.

## Verification

```bash
npm run generate
npm run test:documents
npm run typecheck
npm run build
```

`test:documents` mocks database/provider operations and covers validation, ownership, administrator access, upload limits, quota reservations, interrupted upload cleanup, signed URLs and safe errors. It does not contact Cloudinary or use real credentials. A separate opt-in private live fixture check can verify one synthetic asset's upload, signed download, unsigned denial and deletion; clean up only the generated asset.
