CREATE TABLE "rate_limit_counters" (
	"bucket" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_limit_counters_bucket_window_start_key_hash_pk" PRIMARY KEY("bucket","window_start","key_hash")
);
