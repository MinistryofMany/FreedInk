ALTER TABLE "user_identities" ALTER COLUMN "kdf" SET DEFAULT 'pbkdf2-sha256';--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN "archived_at" timestamp with time zone;