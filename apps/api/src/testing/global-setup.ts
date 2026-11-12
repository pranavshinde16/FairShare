// Vitest globalSetup (see vitest.config.ts): migrate the template database once per run. Each
// integration test file then clones its own copy (createTestDatabase).
export { setupTemplateDatabase as default } from '@fairshare/db/testing';
