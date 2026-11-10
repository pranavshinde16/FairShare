-- The ledger and the commit-time checks that keep it balanced.

-- paid − share per user and transaction. + means the user is owed, − means they owe.
-- Deleted transactions are excluded (I4), so delete and restore are instant and exact.
CREATE VIEW ledger AS
  SELECT t.id AS transaction_id, t.group_id, t.currency, p.user_id, p.amount AS amount
  FROM transactions t
  JOIN transaction_payers p ON p.transaction_id = t.id
  WHERE t.deleted_at IS NULL
UNION ALL
  SELECT t.id, t.group_id, t.currency, s.user_id, -s.amount
  FROM transactions t
  JOIN transaction_shares s ON s.transaction_id = t.id
  WHERE t.deleted_at IS NULL;
--> statement-breakpoint

-- Checks one transaction: Σ payers = Σ shares = amount (I1–I3), and a settlement has exactly one
-- payer and one share, for different people (I9). Raises check_violation with a constraint name
-- the API can recognize: transaction_sums or settlement_shape.
CREATE FUNCTION assert_transaction_balanced(tid uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  tx_type     text;
  tx_amount   bigint;
  payer_count integer;
  payer_sum   numeric;
  payer_user  uuid;
  share_count integer;
  share_sum   numeric;
  share_user  uuid;
BEGIN
  SELECT type, amount INTO tx_type, tx_amount FROM transactions WHERE id = tid;
  IF NOT FOUND THEN
    RETURN; -- the transaction itself was removed; its rows went with it
  END IF;

  SELECT count(*), coalesce(sum(amount), 0), (array_agg(user_id))[1]
    INTO payer_count, payer_sum, payer_user
    FROM transaction_payers WHERE transaction_id = tid;
  SELECT count(*), coalesce(sum(amount), 0), (array_agg(user_id))[1]
    INTO share_count, share_sum, share_user
    FROM transaction_shares WHERE transaction_id = tid;

  IF payer_sum <> tx_amount OR share_sum <> tx_amount THEN
    RAISE EXCEPTION 'Ledger invariant violated for transaction %: amount %, payers %, shares %',
      tid, tx_amount, payer_sum, share_sum
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transaction_sums';
  END IF;

  IF tx_type = 'settlement' AND (payer_count <> 1 OR share_count <> 1 OR payer_user = share_user) THEN
    RAISE EXCEPTION 'Settlement % must have one payer and one recipient, and they must differ', tid
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlement_shape';
  END IF;
END
$$;
--> statement-breakpoint

-- Trigger on transactions: the row's own id.
CREATE FUNCTION check_transaction_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_transaction_balanced(NEW.id);
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- Trigger on payer and share rows: the transaction they belong to, before and after the change.
CREATE FUNCTION check_line_transaction_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM assert_transaction_balanced(OLD.transaction_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM assert_transaction_balanced(NEW.transaction_id);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- Deferred to COMMIT, so a transaction and its rows can be written in any order, and an edit can
-- replace every row, before anything is checked.
CREATE CONSTRAINT TRIGGER transactions_balanced
  AFTER INSERT OR UPDATE OF amount, type ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_transaction_balanced();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transaction_payers_balanced
  AFTER INSERT OR UPDATE OR DELETE ON transaction_payers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_line_transaction_balanced();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transaction_shares_balanced
  AFTER INSERT OR UPDATE OR DELETE ON transaction_shares
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_line_transaction_balanced();
