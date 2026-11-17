// The AI module only drafts (Blueprint 8.1, 10.4): nothing in it can reach the transactions module
// or the transaction tables, so the only way money moves is the person saving the normal form.
// ESLint enforces the same; this test also catches an inline eslint-disable.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));
const AI = join(SRC, 'modules', 'ai');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** Every module specifier a file imports or re-exports, statically or dynamically. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) for (const m of source.matchAll(pattern)) found.push(m[1]!);
  return found;
}

/** The names a file imports from @fairshare/db. */
function dbImports(source: string): string[] {
  return [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@fairshare\/db['"]/g)]
    .flatMap((m) => m[1]!.split(','))
    .map(
      (name) =>
        name
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]!,
    )
    .filter(Boolean);
}

describe('architecture: the AI module only drafts', () => {
  const files = sourceFiles(AI);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files.map((f) => [relative(SRC, f), f]))(
    '%s imports nothing from the transactions module',
    (_, file) => {
      const reached = specifiers(readFileSync(file, 'utf8')).filter((s) =>
        /(^|\/)transactions(\/|$)/.test(s),
      );
      expect(reached).toEqual([]);
    },
  );

  it.each(files.map((f) => [relative(SRC, f), f]))('%s uses no transaction tables', (_, file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/import\s+\*\s+as\s+\w+\s+from\s+['"]@fairshare\/db['"]/);
    expect(
      dbImports(source).filter((name) =>
        ['transactions', 'transactionPayers', 'transactionShares', 'ledger'].includes(name),
      ),
    ).toEqual([]);
  });

  it('would catch an import of the transactions repository', () => {
    expect(specifiers(`import * as repo from '../transactions/repo';`)).toEqual([
      '../transactions/repo',
    ]);
    expect(dbImports(`import { aiRequests, transactions as t } from '@fairshare/db';`)).toEqual([
      'aiRequests',
      'transactions',
    ]);
  });
});
