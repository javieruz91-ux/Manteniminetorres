---
name: Offline sync consistency
description: Durable rules for maintaining correctness across offline state, retries, uploads, and server confirmation.
---

Treat each local visit revision as one immutable synchronization operation. Persist its operation ID and every allocated photo path before starting the corresponding network effect. A response may mark a visit synchronized only if the current local operation ID still matches the one sent; otherwise preserve the newer pending revision and only advance its server version.

**Why:** Type checks did not detect several cross-layer runtime failures: mismatched audit names, poisoned persistence queues, upload crash windows, and older confirmations swallowing newer edits. These only surfaced when mobile and server behavior were reviewed together.

**How to apply:** For changes to lifecycle, outbox, restoration, or photos, verify the complete close → retry → restore → reopen cycle across both client and server. Keep canonical section and audit vocabularies aligned, serialize server writes by visit, and make local persistence failures recoverable.