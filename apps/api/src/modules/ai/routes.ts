import { ParseExpenseRequest } from '@fairshare/contracts';
import { Hono } from 'hono';
import type { AuthedEnv } from '../../http/context';
import { validate } from '../../http/validate';
import { AiRateLimited, type AiService } from './service';

export function aiRoutes(ai: AiService) {
  return new Hono<AuthedEnv>().post(
    '/ai/parse-expense',
    validate('json', ParseExpenseRequest),
    async (c) => {
      try {
        return c.json(await ai.parseExpense(c.var.user.id, c.req.valid('json')));
      } catch (error) {
        if (error instanceof AiRateLimited) {
          c.header('Retry-After', String(error.retryAfterSeconds));
        }
        throw error;
      }
    },
  );
}
