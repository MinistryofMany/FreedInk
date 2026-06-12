CREATE TYPE "public"."incident_status" AS ENUM('investigating', 'identified', 'monitoring', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."rejection_reason" AS ENUM('low_quality', 'bad_formatting', 'ai_generated', 'rage_bait', 'off_topic', 'duplicate', 'factual_errors', 'harassment', 'legal', 'other');--> statement-breakpoint
CREATE TYPE "public"."status_level" AS ENUM('operational', 'degraded', 'partial_outage', 'major_outage');--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'incident.declared';--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'incident.updated';--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'incident.resolved';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "status_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"component" text NOT NULL,
	"level" "status_level" NOT NULL,
	"latency_ms" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "status_incident_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"status" "incident_status" NOT NULL,
	"body" text NOT NULL,
	"posted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "status_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"level" "status_level" NOT NULL,
	"status" "incident_status" DEFAULT 'investigating' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"declared_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blog_post_versions" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN "default_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_reviews" ADD COLUMN "rejection_reasons" "rejection_reason"[];--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "status_incident_updates" ADD CONSTRAINT "status_incident_updates_incident_id_status_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."status_incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "status_incident_updates" ADD CONSTRAINT "status_incident_updates_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "status_incidents" ADD CONSTRAINT "status_incidents_declared_by_user_id_users_id_fk" FOREIGN KEY ("declared_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_checks_component_time_idx" ON "status_checks" USING btree ("component","checked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_checks_time_idx" ON "status_checks" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_incident_updates_incident_idx" ON "status_incident_updates" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_incidents_status_idx" ON "status_incidents" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_incidents_started_idx" ON "status_incidents" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_post_versions_language_idx" ON "blog_post_versions" USING btree ("language");