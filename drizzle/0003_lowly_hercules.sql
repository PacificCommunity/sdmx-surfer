CREATE TABLE "auth_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"ip" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "locked_until" timestamp;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_actor_user_id_auth_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_events_email_created_idx" ON "auth_events" USING btree ("email","created_at");