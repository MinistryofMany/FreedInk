CREATE TYPE "public"."audit_event" AS ENUM('session.created', 'session.destroyed', 'session.revoked', 'passkey.added', 'passkey.removed', 'wallet.linked', 'wallet.unlinked', 'email.changed', 'email.verified', 'identity.created', 'identity.rotated', 'blog.created', 'blog.archived', 'blog.unarchived', 'blog.member_added', 'blog.member_removed', 'blog.member_role_changed', 'blog.threshold_changed', 'post.submitted', 'post.edited', 'post.published', 'post.rejected', 'post.deleted', 'post.restored', 'comment.posted', 'comment.deleted', 'review.cast', 'recovery.requested', 'recovery.completed', 'gdpr.export', 'gdpr.deletion');--> statement-breakpoint
CREATE TYPE "public"."challenge_kind" AS ENUM('register', 'auth');--> statement-breakpoint
CREATE TYPE "public"."identity_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'editor', 'reviewer', 'author', 'commenter');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'under_review', 'published', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_vote" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_recoveries" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_ip" "inet",
	"requested_user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" "audit_event" NOT NULL,
	"actor_user_id" uuid,
	"subject_user_id" uuid,
	"subject_blog_id" uuid,
	"ip" "inet",
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blog_id" uuid NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_member_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blog_id" uuid NOT NULL,
	"root" text NOT NULL,
	"identities" text[] NOT NULL,
	"eligible_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blog_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_post_tags" (
	"post_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "blog_post_tags_post_id_tag_id_pk" PRIMARY KEY("post_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_post_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"slug" text NOT NULL,
	"proof" jsonb,
	"snapshot_root" text,
	"nullifier" text,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"search_tsv" "tsvector",
	"submitted_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blog_id" uuid NOT NULL,
	"current_version_id" uuid,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"approval_numerator" integer DEFAULT 2 NOT NULL,
	"approval_denominator" integer DEFAULT 3 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_verifications" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "passkey_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" "bytea" NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[],
	"aaguid" uuid,
	"nickname" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_version_id" uuid NOT NULL,
	"body" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"proof" jsonb NOT NULL,
	"snapshot_root" text NOT NULL,
	"nullifier" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_version_id" uuid NOT NULL,
	"vote" "review_vote" NOT NULL,
	"proof" jsonb NOT NULL,
	"snapshot_root" text NOT NULL,
	"nullifier" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_submission_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"blog_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "siwe_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"idc" text NOT NULL,
	"public_key" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"kdf" text DEFAULT 'argon2id' NOT NULL,
	"kdf_salt" "bytea" NOT NULL,
	"kdf_params" jsonb NOT NULL,
	"nonce" "bytea" NOT NULL,
	"status" "identity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"email" text,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text,
	"challenge" text NOT NULL,
	"kind" "challenge_kind" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_recoveries" ADD CONSTRAINT "account_recoveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_subject_blog_id_blogs_id_fk" FOREIGN KEY ("subject_blog_id") REFERENCES "public"."blogs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_invitations" ADD CONSTRAINT "blog_invitations_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_invitations" ADD CONSTRAINT "blog_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_invitations" ADD CONSTRAINT "blog_invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_member_snapshots" ADD CONSTRAINT "blog_member_snapshots_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_members" ADD CONSTRAINT "blog_members_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_members" ADD CONSTRAINT "blog_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_members" ADD CONSTRAINT "blog_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_post_tags" ADD CONSTRAINT "blog_post_tags_post_id_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_post_tags" ADD CONSTRAINT "blog_post_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_post_versions" ADD CONSTRAINT "blog_post_versions_post_id_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_version_id_blog_post_versions_id_fk" FOREIGN KEY ("post_version_id") REFERENCES "public"."blog_post_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_reviews" ADD CONSTRAINT "post_reviews_post_version_id_blog_post_versions_id_fk" FOREIGN KEY ("post_version_id") REFERENCES "public"."blog_post_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_submission_nonces" ADD CONSTRAINT "post_submission_nonces_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_submission_nonces" ADD CONSTRAINT "post_submission_nonces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_recoveries_user_idx" ON "account_recoveries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_recoveries_expires_idx" ON "account_recoveries" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_subject_user_idx" ON "audit_log" USING btree ("subject_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_subject_blog_idx" ON "audit_log" USING btree ("subject_blog_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_event_idx" ON "audit_log" USING btree ("event","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blog_invitations_token_key" ON "blog_invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_invitations_blog_idx" ON "blog_invitations" USING btree ("blog_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_invitations_email_idx" ON "blog_invitations" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blog_member_snapshots_blog_root_key" ON "blog_member_snapshots" USING btree ("blog_id","root");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_member_snapshots_blog_idx" ON "blog_member_snapshots" USING btree ("blog_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blog_members_blog_user_active_key" ON "blog_members" USING btree ("blog_id","user_id") WHERE "blog_members"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_members_blog_idx" ON "blog_members" USING btree ("blog_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_members_user_idx" ON "blog_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_post_tags_tag_idx" ON "blog_post_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_post_versions_post_idx" ON "blog_post_versions" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blog_post_versions_post_nullifier_key" ON "blog_post_versions" USING btree ("post_id","nullifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_post_versions_slug_idx" ON "blog_post_versions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_posts_blog_idx" ON "blog_posts" USING btree ("blog_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_posts_status_idx" ON "blog_posts" USING btree ("blog_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blogs_slug_key" ON "blogs" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blogs_title_key" ON "blogs" USING btree ("title");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "passkey_credentials_credential_id_key" ON "passkey_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passkey_credentials_user_idx" ON "passkey_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "post_comments_version_nullifier_key" ON "post_comments" USING btree ("post_version_id","nullifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_comments_version_idx" ON "post_comments" USING btree ("post_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "post_reviews_version_nullifier_key" ON "post_reviews" USING btree ("post_version_id","nullifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_reviews_version_idx" ON "post_reviews" USING btree ("post_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_submission_nonces_blog_idx" ON "post_submission_nonces" USING btree ("blog_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_submission_nonces_expires_idx" ON "post_submission_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limits_expires_idx" ON "rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tags_name_key" ON "tags" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tags_slug_key" ON "tags" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_identities_idc_key" ON "user_identities" USING btree ("idc");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_identities_user_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_identities_user_status_idx" ON "user_identities" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_addresses_address_key" ON "wallet_addresses" USING btree ("address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_addresses_user_idx" ON "wallet_addresses" USING btree ("user_id");