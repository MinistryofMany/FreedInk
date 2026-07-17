DROP INDEX "user_identities_user_status_idx";--> statement-breakpoint
ALTER TABLE "user_identities" ADD COLUMN "blog_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "user_identities" ADD COLUMN "anon_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "anon_epoch" integer;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_user_blog_active_key" ON "user_identities" USING btree ("user_id","blog_id") WHERE "user_identities"."status" = 'active';--> statement-breakpoint
CREATE INDEX "user_identities_blog_status_idx" ON "user_identities" USING btree ("blog_id","status");--> statement-breakpoint
ALTER TABLE "user_identities" DROP COLUMN "public_key";--> statement-breakpoint
ALTER TABLE "user_identities" DROP COLUMN "ciphertext";--> statement-breakpoint
ALTER TABLE "user_identities" DROP COLUMN "kdf";--> statement-breakpoint
ALTER TABLE "user_identities" DROP COLUMN "kdf_salt";--> statement-breakpoint
ALTER TABLE "user_identities" DROP COLUMN "kdf_params";--> statement-breakpoint
ALTER TABLE "user_identities" DROP COLUMN "nonce";--> statement-breakpoint
ALTER TABLE "user_identities" DROP COLUMN "device_label";