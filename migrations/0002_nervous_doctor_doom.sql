CREATE TYPE "public"."report_status" AS ENUM('open', 'reviewing', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target" AS ENUM('post', 'comment', 'user', 'blog');--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'user.suspended';--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'user.unsuspended';--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'abuse.reported';--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'abuse.resolved';--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'abuse.dismissed';--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'feature_flag.changed';--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'media.uploaded';--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'media.deleted';--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'push.subscribed';--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'push.unsubscribed';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "abuse_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_user_id" uuid,
	"reporter_ip" "inet",
	"target_type" "report_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feature_flag_overrides" (
	"flag_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flag_overrides_flag_key_user_id_pk" PRIMARY KEY("flag_key","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout_percentage" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploader_user_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"exif_stripped_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_flag_key_feature_flags_key_fk" FOREIGN KEY ("flag_key") REFERENCES "public"."feature_flags"("key") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_uploader_user_id_users_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abuse_reports_status_idx" ON "abuse_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abuse_reports_target_idx" ON "abuse_reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abuse_reports_reporter_idx" ON "abuse_reports" USING btree ("reporter_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_flag_overrides_user_idx" ON "feature_flag_overrides" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_flags_enabled_idx" ON "feature_flags" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_uploads_uploader_idx" ON "media_uploads" USING btree ("uploader_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_uploads_sha256_uploader_key" ON "media_uploads" USING btree ("uploader_user_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_suspended_idx" ON "users" USING btree ("suspended_at");