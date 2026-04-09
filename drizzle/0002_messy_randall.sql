ALTER TABLE "dashboard_sessions" ADD COLUMN "public_title" text;--> statement-breakpoint
ALTER TABLE "dashboard_sessions" ADD COLUMN "public_description" text;--> statement-breakpoint
ALTER TABLE "dashboard_sessions" ADD COLUMN "author_display_name" text;--> statement-breakpoint
ALTER TABLE "dashboard_sessions" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
CREATE INDEX "sessions_published_idx" ON "dashboard_sessions" USING btree ("published_at");