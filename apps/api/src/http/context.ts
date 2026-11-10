import type { Logger } from 'pino';

/** What every request carries, set by the first middlewares in app.ts. */
export type AppEnv = {
  Variables: {
    requestId: string;
    /** The app logger, bound to this request's ID. */
    log: Logger;
  };
};
