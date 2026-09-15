---
name: Offline sync consistency
description: Durable rules for maintaining correctness across offline state, retries, uploads, and server confirmation.
---

Treat each local visit revision as one immutable synchronization operation. Persist its operation ID and every allocated photo path before starting the corresponding network effect. A response may mark a visit synchronized only if the current local operation ID still matches the one sent; otherwise preserve the newer pending revision and only advance its server version.

**Why:** Type checks did not detect several cross-layer runtime failures: mismatched audit names, poisoned persistence queues, upload crash windows, and older confirmations swallowing newer edits. These only surfaced when mobile and server behavior were reviewed together.

**How to apply:** For changes to lifecycle, outbox, restoration, or photos, verify the complete close → retry → restore → reopen cycle across both client and server. Keep canonical section and audit vocabularies aligned, serialize server writes by visit, and make local persistence failures recoverable.

Photo deletion is also a durable operation: serialize local cleanup-queue updates, register copied files before they become references, and reconcile server objects only while holding the visit lock and confirming the accepted server version.

**Why:** Concurrent provisional copies can overwrite an unprotected cleanup queue, while stale idempotent replays can otherwise delete photos introduced by a newer revision.

**How to apply:** Protect referenced local IDs during cleanup, retry failed file deletion after hydration, and skip server reconciliation whenever the current visit version is newer than the replayed confirmation.

Standalone evidence fields are part of the visit photo outbox even when their local value is serialized inside responses; use the field ID as the stable point relationship and restore the uploaded photo back into that response.

**Why:** Keeping only finding photos in the wire snapshot silently drops evidence such as the complete tower photo during remote synchronization and export.

**How to apply:** When adding a standalone photo field, cover local persistence, upload metadata, VisitPhoto serialization, server restoration, and its explicit workbook target together.