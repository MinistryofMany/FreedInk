-- Per-capability membership snapshots. Each tree (author / comment) gets its own
-- rows keyed by (blog_id, capability, root). Votes do NOT use a tree (blind
-- tokens), so there is no 'review' tree.
--
-- Migration safety (design R4 — do NOT reinterpret the legacy mixed proving
-- group as a specific capability tree):
--   1. Drop the old (blog_id, root) unique.
--   2. Add `capability` nullable.
--   3. Mark every existing (legacy, mixed) snapshot row capability='legacy'. The
--      sentinel 'legacy' is never produced by the app and never looked up as an
--      author/comment tree root, so an in-flight proof against a legacy root
--      fails closed (the client re-fetches the new per-capability tree and
--      re-proves). Legacy rows are kept (not deleted) so any historical
--      snapshot_root reference on already-stored content still resolves; they are
--      dead for new proofs. They can be reaped after a grace window.
--   4. Make `capability` NOT NULL and add the new unique + lookup indexes.
-- The app recomputes the fresh author/comment trees lazily (refreshSnapshot /
-- the group endpoint) on next access; no bulk recompute is needed in SQL.
DROP INDEX "blog_member_snapshots_blog_root_key";--> statement-breakpoint
ALTER TABLE "blog_member_snapshots" ADD COLUMN "capability" text;--> statement-breakpoint
UPDATE "blog_member_snapshots" SET "capability" = 'legacy' WHERE "capability" IS NULL;--> statement-breakpoint
ALTER TABLE "blog_member_snapshots" ALTER COLUMN "capability" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "blog_member_snapshots_blog_cap_root_key" ON "blog_member_snapshots" USING btree ("blog_id","capability","root");--> statement-breakpoint
CREATE INDEX "blog_member_snapshots_blog_cap_idx" ON "blog_member_snapshots" USING btree ("blog_id","capability");
