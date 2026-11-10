CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"code" char(3) PRIMARY KEY NOT NULL,
	"minor_units" smallint NOT NULL,
	"symbol" text NOT NULL,
	CONSTRAINT "currencies_code_format" CHECK ("currencies"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "currencies_minor_units_range" CHECK ("currencies"."minor_units" BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auth_user_id" text,
	"name" text NOT NULL,
	"email" "citext",
	"avatar_url" text,
	"default_currency" char(3) DEFAULT 'INR' NOT NULL,
	"upi_vpa" text,
	"is_placeholder" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"merged_into" uuid,
	"activity_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "users_name_length" CHECK (length("users"."name") BETWEEN 1 AND 60),
	CONSTRAINT "users_placeholder_has_no_auth" CHECK (NOT "users"."is_placeholder" OR "users"."auth_user_id" IS NULL),
	CONSTRAINT "users_not_merged_into_self" CHECK ("users"."merged_into" IS DISTINCT FROM "users"."id")
);
--> statement-breakpoint
CREATE TABLE "direct_pairs" (
	"user_low" uuid NOT NULL,
	"user_high" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "direct_pairs_user_low_user_high_pk" PRIMARY KEY("user_low","user_high"),
	CONSTRAINT "direct_pairs_group_id_unique" UNIQUE("group_id"),
	CONSTRAINT "direct_pairs_sorted" CHECK ("direct_pairs"."user_low" < "direct_pairs"."user_high")
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id"),
	CONSTRAINT "group_members_role" CHECK ("group_members"."role" IN ('owner', 'member')),
	CONSTRAINT "group_members_left_after_joined" CHECK ("group_members"."left_at" IS NULL OR "group_members"."left_at" >= "group_members"."joined_at")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"emoji" text,
	"currency" char(3) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "groups_kind" CHECK ("groups"."kind" IN ('group', 'direct')),
	CONSTRAINT "groups_name" CHECK (("groups"."kind" = 'direct' AND "groups"."name" IS NULL) OR ("groups"."kind" = 'group' AND "groups"."name" IS NOT NULL AND length("groups"."name") BETWEEN 1 AND 60))
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"target_placeholder" uuid,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_token_hash_length" CHECK (octet_length("invites"."token_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "transaction_payers" (
	"transaction_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "transaction_payers_transaction_id_user_id_pk" PRIMARY KEY("transaction_id","user_id"),
	CONSTRAINT "transaction_payers_amount_positive" CHECK ("transaction_payers"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "transaction_shares" (
	"transaction_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "transaction_shares_transaction_id_user_id_pk" PRIMARY KEY("transaction_id","user_id"),
	CONSTRAINT "transaction_shares_amount_positive" CHECK ("transaction_shares"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"notes" text,
	"currency" char(3) NOT NULL,
	"amount" bigint NOT NULL,
	"occurred_on" date NOT NULL,
	"split_method" text,
	"split_input" jsonb,
	"payment_method" text,
	"payment_ref" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"ai_request_id" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "transactions_type" CHECK ("transactions"."type" IN ('expense', 'settlement')),
	CONSTRAINT "transactions_description_length" CHECK (length("transactions"."description") BETWEEN 1 AND 120),
	CONSTRAINT "transactions_notes_length" CHECK (length("transactions"."notes") <= 1000),
	CONSTRAINT "transactions_amount_range" CHECK ("transactions"."amount" > 0 AND "transactions"."amount" <= 10000000000),
	CONSTRAINT "transactions_occurred_on_min" CHECK ("transactions"."occurred_on" >= '2000-01-01'),
	CONSTRAINT "transactions_split_method" CHECK ("transactions"."split_method" IN ('equal', 'exact', 'percent', 'shares')),
	CONSTRAINT "transactions_payment_method" CHECK ("transactions"."payment_method" IN ('cash', 'upi', 'bank_transfer', 'other')),
	CONSTRAINT "transactions_source" CHECK ("transactions"."source" IN ('manual', 'ai_text', 'import')),
	CONSTRAINT "transactions_version_positive" CHECK ("transactions"."version" >= 1),
	CONSTRAINT "transactions_type_fields" CHECK (("transactions"."type" = 'expense' AND "transactions"."split_method" IS NOT NULL AND "transactions"."payment_method" IS NULL AND "transactions"."payment_ref" IS NULL)
       OR ("transactions"."type" = 'settlement' AND "transactions"."split_method" IS NULL AND "transactions"."split_input" IS NULL AND "transactions"."payment_method" IS NOT NULL)),
	CONSTRAINT "transactions_deleted_fields" CHECK (("transactions"."deleted_at" IS NULL) = ("transactions"."deleted_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"verb" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"target_user" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_log_entity_type" CHECK ("activity_log"."entity_type" IN ('group', 'member', 'invite', 'transaction')),
	CONSTRAINT "activity_log_verb_format" CHECK ("activity_log"."verb" ~ '^[a-z]+\.[a-z]+$')
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"path" text NOT NULL,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"input_text" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_micros" bigint,
	"latency_ms" integer,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_requests_path" CHECK ("ai_requests"."path" IN ('rules', 'llm', 'fallback')),
	CONSTRAINT "ai_requests_outcome" CHECK ("ai_requests"."outcome" IN ('ok', 'invalid_output', 'timeout', 'error', 'rate_limited')),
	CONSTRAINT "ai_requests_usage_non_negative" CHECK ("ai_requests"."input_tokens" >= 0 AND "ai_requests"."output_tokens" >= 0 AND "ai_requests"."cost_micros" >= 0 AND "ai_requests"."latency_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_user_id_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_default_currency_currencies_code_fk" FOREIGN KEY ("default_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_merged_into_users_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_pairs" ADD CONSTRAINT "direct_pairs_user_low_users_id_fk" FOREIGN KEY ("user_low") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_pairs" ADD CONSTRAINT "direct_pairs_user_high_users_id_fk" FOREIGN KEY ("user_high") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_pairs" ADD CONSTRAINT "direct_pairs_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_target_placeholder_users_id_fk" FOREIGN KEY ("target_placeholder") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_payers" ADD CONSTRAINT "transaction_payers_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_payers" ADD CONSTRAINT "transaction_payers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_shares" ADD CONSTRAINT "transaction_shares_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_shares" ADD CONSTRAINT "transaction_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ai_request_id_ai_requests_id_fk" FOREIGN KEY ("ai_request_id") REFERENCES "public"."ai_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_target_user_users_id_fk" FOREIGN KEY ("target_user") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_userId_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_userId_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email") WHERE "users"."deleted_at" IS NULL AND NOT "users"."is_placeholder";--> statement-breakpoint
CREATE INDEX "group_members_user_active_idx" ON "group_members" USING btree ("user_id") WHERE "group_members"."left_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_one_owner" ON "group_members" USING btree ("group_id") WHERE "group_members"."role" = 'owner' AND "group_members"."left_at" IS NULL;--> statement-breakpoint
CREATE INDEX "invites_group_active_idx" ON "invites" USING btree ("group_id") WHERE "invites"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "transaction_payers_user_idx" ON "transaction_payers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transaction_shares_user_idx" ON "transaction_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tx_group_feed" ON "transactions" USING btree ("group_id","occurred_on" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "transactions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "tx_group_all" ON "transactions" USING btree ("group_id","occurred_on" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "tx_search" ON "transactions" USING gin (("description" || ' ' || coalesce("notes", '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "activity_log_group_idx" ON "activity_log" USING btree ("group_id","id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "activity_log_entity_idx" ON "activity_log" USING btree ("entity_id","id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ai_requests_user_created_idx" ON "ai_requests" USING btree ("user_id","created_at" DESC NULLS FIRST);