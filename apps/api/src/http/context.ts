import type { Logger } from 'pino';

/** What every request carries, set by the first middlewares in app.ts. */
export type AppEnv = {
  Variables: {
    requestId: string;
    /** The app logger, bound to this request's ID. */
    log: Logger;
  };
};

/** The signed-in user: the domain user's ID and the Better Auth user behind it. */
export type SessionUser = { id: string; authUserId: string };

/** Routes behind requireUser, where the signed-in user is always set. */
export type AuthedEnv = { Variables: AppEnv['Variables'] & { user: SessionUser } };
