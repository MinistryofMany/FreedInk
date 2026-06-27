CREATE TABLE "blog_vote_token_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blog_id" uuid NOT NULL,
	"public_key_spki" "bytea" NOT NULL,
	"private_key_pkcs8" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vote_token_issuances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blog_id" uuid NOT NULL,
	"post_version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_reviews" ALTER COLUMN "proof" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_reviews" ALTER COLUMN "snapshot_root" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_reviews" ALTER COLUMN "nullifier" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_reviews" ADD COLUMN "token_nonce" text;--> statement-breakpoint
ALTER TABLE "blog_vote_token_keys" ADD CONSTRAINT "blog_vote_token_keys_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_token_issuances" ADD CONSTRAINT "vote_token_issuances_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_token_issuances" ADD CONSTRAINT "vote_token_issuances_post_version_id_blog_post_versions_id_fk" FOREIGN KEY ("post_version_id") REFERENCES "public"."blog_post_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_token_issuances" ADD CONSTRAINT "vote_token_issuances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blog_vote_token_keys_blog_active_key" ON "blog_vote_token_keys" USING btree ("blog_id") WHERE "blog_vote_token_keys"."retired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "blog_vote_token_keys_blog_idx" ON "blog_vote_token_keys" USING btree ("blog_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vote_token_issuances_version_user_key" ON "vote_token_issuances" USING btree ("post_version_id","user_id");--> statement-breakpoint
CREATE INDEX "vote_token_issuances_version_idx" ON "vote_token_issuances" USING btree ("post_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_reviews_version_token_nonce_key" ON "post_reviews" USING btree ("post_version_id","token_nonce") WHERE "post_reviews"."token_nonce" IS NOT NULL;