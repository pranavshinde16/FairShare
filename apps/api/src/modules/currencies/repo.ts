import { currencies, type Db, type Tx } from '@fairshare/db';
import { asc, eq } from 'drizzle-orm';

type Handle = Db | Tx;

export async function exists(db: Handle, code: string): Promise<boolean> {
  const [row] = await db
    .select({ code: currencies.code })
    .from(currencies)
    .where(eq(currencies.code, code));
  return row !== undefined;
}

export function listAll(db: Handle) {
  return db
    .select({
      code: currencies.code,
      minorUnits: currencies.minorUnits,
      symbol: currencies.symbol,
    })
    .from(currencies)
    .orderBy(asc(currencies.code));
}
