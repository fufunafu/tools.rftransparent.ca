# Pictures on problem tickets

The new and existing ticket forms at `/customer-service/problems` accept multiple pictures. Users see previews before saving and a picture-count button on tickets with saved pictures. Saved JPEG, PNG, WebP and GIF pictures can be opened at full size. HEIC/HEIF originals can be uploaded and downloaded. Each picture is limited to 4 MB, leaving room for multipart headers under the host's request limit.

The ticket is saved before its pictures upload. If an upload fails, the editor remains open, successful pictures stay saved, and the remaining pictures can be retried. A stable picture ID prevents a retry of a lost response from creating duplicates. Retrying a newly created ticket uses its saved ID instead of creating another ticket.

## Access and storage

- Every upload and image read requires the existing authorized staff session.
- Only the uploader or an admin can remove an individual saved picture.
- Ticket deletion remains admin-only and cleans up attached objects after the database deletion succeeds.
- `problem_attachments` has RLS enabled and no direct anon/authenticated table access. The server uses the service role.
- The `problem-attachments` bucket is private. Files are served through `/api/problems/attachments/[id]`, with no public or signed links and no shared caching.
- File size, MIME type, and image signature are checked before upload. SVG and other active-content formats are rejected.
- Storage failures after metadata deletion are logged with the orphaned paths. Remove those paths from the private bucket after confirming no metadata row refers to them. Do not delete unrelated storage objects.

## Release

This change requires `supabase/migrations/20260925120000_problem_attachments.sql` before deploying the application. Existing ticket rows are not rewritten. The migration adds a metadata table, index, permissions, and a private bucket, and requests a PostgREST schema-cache reload.

Follow `docs/database-migrations.md`: back up the target database, compare migration history, rehearse against a recent non-production copy, apply this specific migration once, then verify. Do not run a broad migration push from the shared workspace, which contains unrelated pending migrations.

After applying the migration, confirm the bucket is private and its limit is 4194304 bytes. Deploy from the current production source with only this feature's changes; the shared checkout contains unrelated work. The production release was prepared from the deployed GitHub source, commit `63286e4b9a7e6b8123afa3a938369a822be0671a`, with only the 13 picture-attachment feature, test and documentation files added or changed.

After deployment, use an authorized test ticket to upload, reopen and remove a picture. Verify unauthenticated image requests return 401, then remove the test ticket. Before release, a fresh 13 MB application database backup was saved locally and the migration was rehearsed with the production table definitions and all 64 ticket rows. The rehearsal verified that existing rows were unchanged. Supabase-managed storage triggers were excluded from the local PGlite copy. The production migration was applied on September 25, 2026 using an isolated migration directory; no unrelated pending migration was applied.

Rollback the application if needed while retaining the new private table and bucket. Keeping them preserves uploaded pictures for a later corrected release.

## Verification

Focused tests cover upload authentication, file validation, retry idempotency, storage cleanup, removal permissions, Unicode filenames, private responses, partial-upload recovery in the UI, and metadata constraints/cascade behavior in PGlite.

```sh
npx vitest run src/app/api/problems/attachments/route.test.ts src/components/admin/ProblemsDashboard.test.tsx src/lib/problem-attachments.test.ts
```

Desktop and mobile browser checks use the real components with a mocked API. They verify new/existing tickets, persistence on reload, pending/saved removal, and a 390-pixel viewport without horizontal overflow. Screenshots and the browser receipt are under ignored `output/problems-photo-check/`.

All 26 focused tests, ESLint, and the isolated Next.js production build passed again using the actual production baseline `63286e4b9a7e6b8123afa3a938369a822be0671a` plus the feature files. The full shared workspace type check is affected by an unrelated Deno handoff file; a broad generated-type include also encounters an existing duplicate `routes.d 2.ts` file. Neither issue was changed as part of this feature.
