-- Extensions the schema depends on. Both are "trusted", so the database owner can create them
-- (including on Neon) without superuser rights.
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive emails
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- trigram search on description + notes
