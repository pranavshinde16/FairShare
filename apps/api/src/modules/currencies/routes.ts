import { Hono } from 'hono';
import type { AuthedEnv } from '../../http/context';
import type { CurrenciesService } from './service';

/** GET /currencies: the supported currencies, for pickers. */
export function currenciesRoutes(currencies: CurrenciesService) {
  return new Hono<AuthedEnv>().get('/currencies', async (c) => c.json(await currencies.list()));
}
