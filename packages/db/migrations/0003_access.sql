-- Who may do what. Roles are cluster-wide, so they're created only if missing. They are NOLOGIN
-- group roles: each environment's login user is granted membership outside migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fairshare_app') THEN
    CREATE ROLE fairshare_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fairshare_readonly') THEN
    CREATE ROLE fairshare_readonly NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO fairshare_app, fairshare_readonly;
--> statement-breakpoint

-- The API. Domain data is soft-deleted (deleted_at, left_at, revoked_at), so DELETE is granted only
-- where rows really are removed: payer/share rows replaced on edit, direct_pairs rows dropped when a
-- placeholder merge folds two direct groups into one, and Better Auth's own tables.
GRANT SELECT ON currencies, ledger TO fairshare_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON users, groups, group_members, invites, transactions, ai_requests
  TO fairshare_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON transaction_payers, transaction_shares, direct_pairs,
  auth_user, auth_session, auth_account, auth_verification
  TO fairshare_app;
--> statement-breakpoint
-- Append-only (I11).
GRANT SELECT, INSERT ON activity_log TO fairshare_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE activity_log_id_seq, ai_requests_id_seq TO fairshare_app;
--> statement-breakpoint

-- The nightly invariant job reads everything and writes nothing.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fairshare_readonly;
--> statement-breakpoint

-- Grants don't bind a table's owner, and on hosted Postgres the default connection role usually is
-- the owner. This trigger keeps activity_log append-only whoever is connected.
CREATE FUNCTION reject_activity_log_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER activity_log_append_only
  BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION reject_activity_log_change();
--> statement-breakpoint
CREATE TRIGGER activity_log_no_truncate
  BEFORE TRUNCATE ON activity_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_activity_log_change();
