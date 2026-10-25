# Private student profile pictures

Students can add, replace and remove an optional profile picture on `/profile`. Their picture also appears in the account sidebar and the administrator's student directory. Picture changes are saved separately from the profile form, preserving unsaved profile edits.

## Files and privacy

- Upload a still JPEG, PNG or WebP of at most **2 MiB** and **12 megapixels**. Animated images, SVG, GIF, corrupt images and renamed files with invalid image bytes are rejected.
- The API decodes the image in a bounded worker, applies its orientation, crops it to a centered square and saves a **512 × 512 WebP**. Input metadata is discarded.
- Cloudinary stores the image with delivery type `authenticated`. PostgreSQL keeps the asset key and the account's current picture reference.
- The account workspace receives a same-origin `/api/v1/profile/picture/<userId>?v=<assetId>` URL. Session checks allow the owner and administrators to read it. Other students and signed-out visitors cannot fetch this private route.
- If the student explicitly publishes their talent profile, its directory picture is available through the separate `/api/v1/talent/<userId>/picture` route. That route checks current directory eligibility before and after downloading the image; unpublishing makes it unavailable. The underlying Cloudinary asset remains authenticated. See the [talent directory guide](talent-directory.md).
- The API retrieves the image through a short-lived server-side Cloudinary request. Cloudinary credentials and signed provider URLs are not sent to the browser. Responses use `image/webp`, `nosniff` and `private, no-store`.
- Pictures are optional and do not change the profile-completion calculation. A missing or unavailable picture falls back to the student's initial.

## Configuration and rollout

This feature reuses the API's existing `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`. No new credentials or Vercel environment variables are required. The key must permit creating, reading and deleting authenticated image assets. Keep credentials out of Git and frontend variables; see the [Cloudinary setup guide](cloudinary-documents.md).

The additive migration `20261020000000_profile_pictures` creates a private picture asset table and a nullable account reference. It does not reset accounts, profiles or documents.

1. Run `npm run generate` and review the intended database before `npm run db:migrate`.
2. Deploy the API with its existing Render build command, which generates Prisma and compiles the API. The API now declares Sharp as a direct dependency; keep npm's normal optional platform dependencies enabled.
3. Deploy the frontend. Existing API origin and session settings continue to apply.
4. Verify a student can upload, view, replace and remove a picture, an administrator can view it, another student cannot view it, and unauthenticated Cloudinary delivery fails.

If Cloudinary is not configured, the profile page identifies picture uploads as unavailable while the existing profile form continues to work.

## Routes and failure handling

- `POST /api/v1/profile/picture`: one multipart `file`; active, verified student and valid CSRF/origin required.
- `DELETE /api/v1/profile/picture`: removes the current student's picture; active student and valid CSRF/origin required.
- `GET /api/v1/profile/picture/:userId`: returns the current picture to its owner or an administrator.

The API admits two picture uploads at a time and rate-limits new uploads. A short transaction locks the owning account to reserve a new asset and later swap the current picture. Provider requests run outside database transactions. Replacement publishes the new picture before retiring the previous one; failed uploads keep the previous picture.

Private asset reservations retain cleanup keys after uncertain provider or database outcomes. Stale, non-current reservations are retried in a bounded batch on a later picture mutation after a two-minute grace period. Failed cleanup does not discard its key or expose the retired asset. A pending upload prevents deletion or a second replacement until it finishes or can be cleaned up. Image decoding and private downloads also have bounded concurrency and queues to avoid exhausting the API instance.

## Verification

```bash
npm run generate
npm run test:profile-pictures
npm run test:documents
npm run typecheck
npm run build
```

Focused tests use synthetic images and mocked provider/database operations. Live storage and end-to-end checks use disposable synthetic fixtures, remove only those fixtures, and send no email. A successful local test is separate from confirming the deployed API and website are live.
