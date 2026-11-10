// Contracts and core describe the same values. These checks fail typecheck (or the test) if the two
// drift apart, so a shape parsed at the API boundary can always be handed straight to core.

import * as core from '@fairshare/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { TransactionSnapshot } from './activity';
import type { Balances, Transfer } from './balances';
import { Line } from './primitives';
import type { SplitInput } from './split';
import { createExpense, expenseTransaction, ids } from './testing/fixtures';
import { CreateExpense } from './transactions';

describe('contracts ⇄ core types', () => {
  it('SplitInput, Line and TransactionSnapshot are interchangeable', () => {
    expectTypeOf<z.output<typeof SplitInput>>().toExtend<core.SplitInput>();
    expectTypeOf<core.SplitInput>().toExtend<z.input<typeof SplitInput>>();
    expectTypeOf<z.output<typeof Line>>().toExtend<core.Line>();
    expectTypeOf<z.output<typeof TransactionSnapshot>>().toExtend<core.TransactionSnapshot>();
    expectTypeOf<core.TransactionSnapshot>().toExtend<z.input<typeof TransactionSnapshot>>();
  });

  it('core’s balance output fits the Balances response', () => {
    expectTypeOf<core.Transfer>().toExtend<Transfer>();
    expectTypeOf<core.CurrencyNets & { transfers: core.Transfer[] }>().toExtend<Balances>();
  });
});

describe('contracts → core at runtime', () => {
  it('a parsed CreateExpense goes straight into computeShares', () => {
    const body = CreateExpense.parse(createExpense);
    const shares = core.computeShares(body.amount, body.split, body.id);
    expect(shares).toEqual(expenseTransaction.shares);
    for (const line of shares) expect(Line.parse(line)).toEqual(line);
  });

  it('a core snapshot parses as a TransactionSnapshot and feeds diffSnapshots', () => {
    const before = core.canonicalSnapshot({
      description: 'Dinner',
      amount: 120_000,
      currency: 'INR',
      occurredOn: '2026-11-05',
      notes: null,
      splitMethod: 'equal',
      splitInput: { method: 'equal', participants: [ids.d, ids.c, ids.b, ids.a] },
      payers: [{ userId: ids.b, amount: 120_000 }],
      shares: core.computeShares(
        120_000,
        { method: 'equal', participants: [ids.a, ids.b, ids.c, ids.d] },
        ids.dinner,
      ),
    });
    // What the activity log stores is JSON; what the web app reads back is parsed.
    const stored = TransactionSnapshot.parse(JSON.parse(JSON.stringify(before)));
    const after = TransactionSnapshot.parse({ ...stored, amount: 150_000 });
    expect(core.diffSnapshots(stored, after)).toEqual([
      { field: 'amount', from: 120_000, to: 150_000 },
    ]);
  });
});
