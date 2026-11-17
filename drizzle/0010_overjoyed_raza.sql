ALTER TABLE "auth_users" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "deleted_email" text;