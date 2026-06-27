ALTER TABLE "blog_members" ADD COLUMN "can_author" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "blog_members" ADD COLUMN "can_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "blog_members" ADD COLUMN "can_comment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "blog_members" ADD COLUMN "can_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill capabilities from the legacy single role. The role unions:
--   owner    = author + review + comment + admin (full control)
--   editor   = author + review + comment
--   reviewer = review + comment
--   author   = author + comment
--   commenter= comment
-- can_admin is set ONLY for owners (the existing ROLES_MANAGING set). This runs
-- once over every blog_members row, including soft-removed rows (harmless: the
-- active-row predicate is still removed_at IS NULL elsewhere).
UPDATE "blog_members" SET
  "can_author"  = "role" IN ('owner','editor','author'),
  "can_review"  = "role" IN ('owner','editor','reviewer'),
  "can_comment" = "role" IN ('owner','editor','reviewer','author','commenter'),
  "can_admin"   = "role" = 'owner';