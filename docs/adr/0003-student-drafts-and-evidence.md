---
status: Accepted
date: 2026-10-09
---
# ADR 0003: Student drafts and private evidence storage

Continuation of the implementation authorized by the project owner. Complements ADR 0001 and accepted ADR 0002; does not close Sprint 4 UAT.

## Decisions
- This increment supports draft creation, partial save, private uploads and a review of entered information. DRAFT never means submitted, accepted or signed. No reviewer task, official document generation or signature verification is created.
- Only active students with an active academic profile may operate on their own drafts and files. Current database authority is checked on every operation; JWT claims alone are insufficient. Other owners' identifiers return 404.
- Only ONLINE/HYBRID published procedures accept drafts. STUDENT_CONFIRMATION remains OFFLINE at CTSV. New drafts pin the published version and a public configuration snapshot. Retired versions remain readable but cannot be edited or uploaded to.
- A student has one draft per procedure version. Writes require the expected revision; conflicting edits preserve client input. Service row then draft row locks serialize publication, creation and file limits.
- Profile fields come from the server's current student profile on creation/save. Unknown keys, profile overrides, invalid field types, invalid dates and invalid options are rejected. Missing required answers/evidence are allowed in drafts and displayed in the review summary.
- Original uploaded bytes are stored privately under generated UUID keys, outside the web public tree and Git. Metadata includes SHA-256, size, media type and original display name. Owner-only attachment downloads use no-store and nosniff. Removed evidence is unlinked by soft deletion; original files are retained.
- Uploads are limited to one PDF/PNG/JPEG at a time, 5 MiB per file, configuration count/size limits and 20 MiB total. Basic signature/header checks do not mean antivirus scanning, complete format validation or digital-signature validation. Every file has NOT_CHECKED signature status.
- Unsafe cookie-authenticated requests require the configured frontend Origin. Audit metadata contains identifiers/revisions/counts, not student answers or private storage keys. Database writes and audit events share a transaction. Failed new uploads clean up the newly created storage object.
- Local private storage is an initial adapter, configurable through SUBMISSION_STORAGE_ROOT. Production requires durable protected storage, operational access controls, backup/retention and malware scanning before rollout. No public URL is generated.

## Follow-up
Actual submission, review routing, official documents and signature-provider integration require separate implementations and acceptance. Real institutional signer authority and provider credentials are still outstanding.
