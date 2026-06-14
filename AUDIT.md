# FreedInk — Full Feature Audit

_Anonymous-blogging platform: SvelteKit + Postgres/Drizzle, Semaphore ZK proofs for unlinkable authorship, "Sign in with Minister" (OIDC) as the sole login._

Audit method: seven parallel domain reviews reading implementation **and** tests. Status legend: ✅ working · ◐ partial · ⚠️ stub/mock · ❌ broken/missing.

## Verdict

The foundations are genuinely strong — sound vault crypto, a real session/revocation model, content-bound proofs, production-grade pagination/FTS, and real (not stubbed) infra (EXIF stripping, pg_dump backups, web-push, graceful shutdown). The weaknesses cluster in two places: **(1) the application-level enforcement of the ZK guarantees** (the headline "one post per identity" and membership-revocation properties don't actually hold), and **(2) one classic SvelteKit authorization hole** (admin form actions bypass the operator gate). The cryptography is fine; the _enforcement around it_ has holes.

---

## Critical findings (fix before any real use)

### C1 — Privilege escalation: admin form actions have no operator gate

`?/suspend` (users) and `?/createFlag` / `?/saveFlag` / `?/setOverride` / `?/removeOverride` (flags) run with **no** `isPlatformOperator` check. SvelteKit form actions do not run the parent `+layout.server.ts` load, and hooks have no `/admin/platform` path gate — so any signed-in non-operator can POST these to **revoke arbitrary users' sessions and manipulate feature flags**. The `/api/platform/*` JSON endpoints gate correctly; only the page form actions don't.

- Evidence: `src/routes/admin/platform/users/+page.server.ts:34-48`, `src/routes/admin/platform/flags/+page.server.ts:88-178`
- Fix: add `isPlatformOperator(event.locals.user)` at the top of each form action (the API handlers already show the pattern). Add a negative-path POST test.

### C2 — "One post per identity" is unenforced (dead nullifier guard)

Post scope is per-blog (`post:${blogId}`), but DB uniqueness is `(postId, nullifier)` and every submission creates a fresh `postId` in the same transaction — so the same identity yields the same nullifier for every post, yet the two rows never share a `postId` and the unique index never fires. The `409 nullifier reuse` branch is dead code. One identity can author unlimited posts; the only brake is a per-user rate limit. (Independently confirmed by 3 auditors.)

- Evidence: scope `src/routes/api/blog/post/+server.ts:49`; uniqueness `src/lib/db/schema.ts:371`; fresh postId `src/lib/db/posts.ts:429-432`
- Fix: enforce uniqueness on `(blogId, nullifier)` (dedicated table or partial unique index) to match the per-blog scope.

### C3 — Membership revocation is unenforceable (stale snapshots never pruned)

Verification accepts **any historical** snapshot root for the blog, and snapshots are append-only with no pruning. A removed/banned member — or a rotated-away identity — can keep proving against an old root **forever**. This defeats the point of removing someone.

- Evidence: `src/lib/server/semaphore.ts:25` (`getSnapshotByRoot` accepts any past root); no snapshot deletion anywhere; `src/lib/db/members.ts:80-90` only inserts a new snapshot
- Fix: verify against the current root (or a bounded recent window), and/or invalidate prior snapshots on member removal / identity rotation.

---

## High / medium findings

### H1 — Unpublished posts are publicly readable by slug (privacy leak)

`getPostBySlug` filters only `blogId + slug + deletedAt IS NULL` — **no `status='published'`**. Draft / under-review / rejected posts are served (and their status rendered) to anyone who knows or guesses the slug. Every other public path (listings, search, feeds, sitemap) is correctly status-gated; this one query is the outlier, and it's untested. (Confirmed by 2 auditors.)

- Evidence: `src/lib/db/posts.ts:67-89`, `src/routes/b/[blog]/[slug]/+page.server.ts:11-12`
- Fix: add `eq(blogPosts.status, 'published')` to the query (or gate in the loader).

### H2 — Reviewers can re-vote after an edit

Editing a post inserts a new `post_version_id`; the review nullifier scope (`review:<versionId>`) and uniqueness are both keyed to the version, so the **same reviewer identity gets a fresh nullifier and can vote again** on the re-submitted (near-identical) content. An author who can trigger edits can farm approvals. Untested.

- Evidence: scope `src/routes/api/post/review/+server.ts:66`; new version `src/lib/db/post-editor.ts:75-118`

### M1 — Cross-snapshot vote counting vs. snapshot-pinned threshold

The tally counts **all** `postReviews` rows for the version regardless of which snapshot they were proven against, while the threshold denominator (`eligibleCount`) comes from a single snapshot. Approvals proven under a different snapshot of the same blog still count toward a bar sized for a different population.

- Evidence: `src/lib/server/tally.ts:30-36` vs `:39-46`

### M2 — No author self-vote exclusion

Nothing stops a post's author (if they hold a reviewing role) from approving their own post toward the threshold; the submission nullifier is never compared against review nullifiers.

- Evidence: `src/routes/api/post/review/+server.ts` (no author check)

### M3 — GDPR delete leaves orphaned media files on disk

`media_uploads` rows cascade-delete on account deletion, but the on-disk `static/uploads/**` image bytes are never unlinked, and `cleanup.ts` has no media-orphan pass. Personal-data survives erasure.

- Evidence: `src/routes/api/gdpr/delete/+server.ts`, `scripts/cleanup.ts`

### M4 — Soft-deleting the current post version orphans the post

Delete acts on a `version_id` with no guard that it isn't the current version. Deleting the current version 404s the post publicly while `status` stays `published` and `currentVersionId` points at a hidden row.

- Evidence: `src/routes/api/post/delete/+server.ts`, `src/lib/db/moderation.ts:10-22`

### M5 — `/metrics` is open by default

Prometheus endpoint is public unless `METRICS_BEARER` is set. Aggregate-only data limits blast radius, but it's a misconfiguration-prone exposure.

- Evidence: `src/routes/metrics/+server.ts:14-29`

---

## Low / hygiene

| Item                                                              | Evidence                                              | Note                                                                                           |
| ----------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `oidc_sessions` never reaped (schema comments say it is)          | `scripts/cleanup.ts` omits the table                  | Unbounded growth; harmless rows.                                                               |
| OIDC `state` consume is select-then-delete (TOCTOU)               | `api/auth/oidc/callback/+server.ts:40-46`             | Use `DELETE … RETURNING`.                                                                      |
| Runtime SNARK artifacts not integrity-checked + live-CDN fallback | `src/lib/client/semaphore.ts:106-128`                 | Build-time hash-pinning is solid; the runtime fetch path isn't.                                |
| Theme override FOUC                                               | `src/routes/+layout.svelte:130-143`, `src/app.html`   | `data-theme` applied only in `onMount`; add an inline head script.                             |
| Nullable `nullifier` defeats the unique index for null rows       | `src/lib/db/schema.ts`                                | API always passes a string, but any null-inserting path bypasses dedup.                        |
| `kdf` column defaults to `argon2id` while real KDF is PBKDF2      | `src/lib/db/schema.ts:194`                            | Inert (read path ignores it); write the real value or drop the column.                         |
| `getLatestSnapshot` sorts ascending → returns oldest              | `src/lib/db/snapshots.ts:125-133`                     | Dead code today, but a landmine.                                                               |
| Stale "not implemented" comment on suspend                        | `src/routes/admin/platform/users/+page.server.ts:1-6` | Suspension IS implemented; page action only revokes sessions (two divergent suspend paths).    |
| Forwarded invitations are bearer-redeemable                       | `src/lib/db/invitations.ts:5-9`                       | By design; a leaked link grants the role to whoever clicks. Worth a conscious risk acceptance. |
| FTS ranking unused                                                | `src/lib/db/tags.ts`                                  | Trigger sets weights but results order by `publishedAt`, not `ts_rank`.                        |
| i18n single-locale                                                | `src/lib/i18n/locales/en.json`                        | Only `en.json` ships; switcher hidden. By design, not a bug.                                   |

---

## Test gaps (why some of the above slipped through)

- **OIDC sign-in handlers**: only the unauth-401 gate is tested; PKCE/state/nonce/token-exchange logic has no end-to-end test.
- **Suspension/ban**: the single most security-critical control has no test asserting a suspended user is actually locked out.
- **Platform POST authorization**: `platform.test.ts` covers GET 303 redirects but not POST action authz — exactly the blind spot that hid C1.
- **Voting**: `tally.test.ts` inserts reviews via raw `db.insert`, bypassing the uniqueness index and proof path, so double-vote/re-vote-after-edit are never exercised end-to-end.
- **Public post page, delete/restore/tags handlers**: no direct integration coverage.

Suite size: 473 unit/integration/api tests + 14 e2e, all green. Coverage is broad but skews toward DB-layer happy paths over API-layer authz/abuse paths.

---

## What's genuinely solid

- **Vault crypto** — PBKDF2-HMAC-SHA-256 @ 600k iters, AES-GCM-256, per-blob random salt/nonce, the Semaphore secret never leaves the browser, plus an independent BIP-39 recovery path; exhaustive round-trip/tamper tests.
- **Session model** — HMAC-signed opaque cookie with `timingSafeEqual`, no fixation vector, per-session + revoke-all, and suspension wired end-to-end (refuse-new + loader-reject + reap).
- **Proof↔content binding** — message (title+body / vote / comment) is bound into the SNARK and re-checked server-side; a captured proof cannot be replayed against different content.
- **Snapshot ordering** — deterministic by user-creation-date so rotations touch one leaf; reproducibility unit-tested.
- **Discovery** — keyset pagination (no skips/dupes, opaque cursors, malformed-cursor resilient) and Postgres FTS via a real trigger + GIN index; feeds/sitemap correctly scoped to published content.
- **Infra is real, not stubbed** — `sharp` EXIF stripping, `pg_dump` backups with atomic rename, web-push with dead-sub pruning, graceful shutdown with request draining, deterministic feature-flag rollout, append-only audit log on every mutation. The email console-log fallback is an honest labeled shim, not a disguised stub.
- **Authz consistency** on `/api/*` — role gating and operator gating are uniform and correct on the JSON endpoints (the gap is only the page form actions).

---

## Suggested priority order

1. **C1** (admin form-action authz) — smallest fix, highest blast radius.
2. **H1** (draft leak) — one-line query fix.
3. **C2 + C3** (nullifier scoping + snapshot revocation) — the ZK abuse-resistance core; needs schema/verification design, not a one-liner.
4. **H2 / M1 / M2** (review integrity) — tighten vote scoping + tally reconciliation + author exclusion.
5. **M3** (GDPR media erasure), then the low/hygiene list.
6. Backfill the authz/abuse-path tests so these don't regress.
