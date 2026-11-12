import {
  CreateExpense,
  CreateSettlement,
  parseIfMatch,
  TransactionListQuery,
  Uuid,
} from '@fairshare/contracts';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AuthedEnv } from '../../http/context';
import { AppError } from '../../http/errors';
import { validate } from '../../http/validate';
import type { GroupEnv } from '../groups/membership';
import type { TransactionsService } from './service';

/**
 * Under /groups/:groupId, behind requireMembership: the group's list, adding expenses and
 * recording payments. Both creates answer 201, or 200 for an idempotent replay of the same body.
 */
export function groupTransactionsRoutes(transactions: TransactionsService) {
  return new Hono<GroupEnv>()
    .get('/transactions', validate('query', TransactionListQuery), async (c) =>
      c.json(
        await transactions.listTransactions(c.var.user.id, c.var.membership, c.req.valid('query')),
      ),
    )
    .post('/expenses', validate('json', CreateExpense), async (c) => {
      const { transaction, created } = await transactions.createExpense(
        c.var.user.id,
        c.var.membership,
        c.req.valid('json'),
      );
      return c.json(transaction, created ? 201 : 200);
    })
    .post('/settlements', validate('json', CreateSettlement), async (c) => {
      const { transaction, created } = await transactions.createSettlement(
        c.var.user.id,
        c.var.membership,
        c.req.valid('json'),
      );
      return c.json(transaction, created ? 201 : 200);
    });
}

/** A transaction's ID from the path; anything that isn't a UUID can't exist, so it's 404. */
const transactionId = (c: Context) => {
  const id = Uuid.safeParse(c.req.param('id'));
  if (!id.success) {
    throw new AppError('NOT_FOUND', 'This doesn’t exist, or you’re not in its group.');
  }
  return id.data;
};

/** The version an edit, delete or restore was based on (If-Match), required. */
const ifMatch = (c: Context) => {
  const version = parseIfMatch(c.req.header('If-Match'));
  if (version === null) {
    throw new AppError(
      'IF_MATCH_REQUIRED',
      'Send the version you edited as If-Match, so a newer change isn’t overwritten.',
    );
  }
  return version;
};

/**
 * /transactions/:id, for expenses and settlements alike. Access is checked against the
 * transaction's group: only its active members see it (404 for everyone else).
 */
export function transactionRoutes(transactions: TransactionsService) {
  return (
    new Hono<AuthedEnv>()
      .get('/transactions/:id', async (c) =>
        c.json(await transactions.getTransaction(c.var.user.id, transactionId(c))),
      )
      // The body's shape depends on the stored type (UpdateExpense or UpdateSettlement), so the
      // service validates it once it knows which; here it only has to be JSON.
      .put('/transactions/:id', validate('json', z.unknown()), async (c) =>
        c.json(
          await transactions.updateTransaction(
            c.var.user.id,
            transactionId(c),
            ifMatch(c),
            c.req.valid('json'),
          ),
        ),
      )
      .delete('/transactions/:id', async (c) =>
        c.json(await transactions.deleteTransaction(c.var.user.id, transactionId(c), ifMatch(c))),
      )
      .post('/transactions/:id/restore', async (c) =>
        c.json(await transactions.restoreTransaction(c.var.user.id, transactionId(c), ifMatch(c))),
      )
      .get('/transactions/:id/history', async (c) =>
        c.json(await transactions.history(c.var.user.id, transactionId(c))),
      )
  );
}
