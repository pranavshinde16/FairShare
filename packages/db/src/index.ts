// Public API of @fairshare/db: the schema, the client and the migration runner.
// Test helpers live in @fairshare/db/testing.

export * from './schema';
export {
  createDb,
  findPgError,
  isLedgerInvariantError,
  LEDGER_CONSTRAINTS,
  withTx,
  type Db,
  type Tx,
} from './client';
export { MIGRATIONS_FOLDER, runMigrations } from './migrate';
export { applyReferenceData, CURRENCIES } from './reference';
export { AI_INPUT_RETENTION_DAYS, runMaintenance, type MaintenanceReport } from './maintenance';
