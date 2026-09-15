CREATE TABLE "allowed_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"organisation" text,
	"note" text,
	"added_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "allowed_domains" ADD CONSTRAINT "allowed_domains_added_by_auth_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;