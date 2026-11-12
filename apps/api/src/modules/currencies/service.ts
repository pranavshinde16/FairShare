import type { CurrencyList } from '@fairshare/contracts';
import type { Db } from '@fairshare/db';
import * as repo from './repo';

export type CurrenciesService = ReturnType<typeof createCurrenciesService>;

export function createCurrenciesService(db: Db) {
  let cached: CurrencyList | undefined;
  return {
    /** Reference data, applied at deploy time, so it's read once per process. */
    async list(): Promise<CurrencyList> {
      cached ??= { items: await repo.listAll(db) };
      return cached;
    },
  };
}
