DROP TABLE "wallet_addresses" CASCADE;--> statement-breakpoint
DROP TABLE "passkey_credentials" CASCADE;--> statement-breakpoint
DROP TABLE "webauthn_challenges" CASCADE;--> statement-breakpoint
DROP TABLE "siwe_nonces" CASCADE;--> statement-breakpoint
DROP TABLE "email_verifications" CASCADE;--> statement-breakpoint
DROP TABLE "account_recoveries" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "email_verified_at";--> statement-breakpoint
DROP TYPE "public"."challenge_kind";
