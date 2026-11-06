CREATE TABLE "email_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"password_hash" text NOT NULL,
	"browser_secret_hash" text NOT NULL,
	"ip" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"verified_at" timestamp,
	"consumed_at" timestamp,
	"rejection" text,
	CONSTRAINT "email_proofs_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE INDEX "email_proofs_email_created_idx" ON "email_proofs" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "email_proofs_ip_created_idx" ON "email_proofs" USING btree ("ip","created_at");