// Public API of @fairshare/contracts: one definition of every API shape.
//
// Conventions:
// - Request bodies and query strings are strict: unknown keys are rejected.
// - Response objects drop unknown keys instead, so a client still open in a tab keeps working when
//   the API adds a field. Value types mirrored from core (Line, SplitInput) are strict everywhere.
// - Every schema is exported with a same-named type: `CreateExpense` is both.

export * from './primitives';
export * from './errors';
export * from './concurrency';
export * from './pagination';
export * from './health';
export * from './auth';
export * from './currencies';
export * from './users';
export * from './groups';
export * from './invites';
export * from './friends';
export * from './home';
export * from './split';
export * from './transactions';
export * from './balances';
export * from './activity';
export * from './ai';
