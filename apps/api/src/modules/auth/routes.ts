import { Hono } from 'hono';
import type { AppEnv } from '../../http/context';
import type { AuthGateway } from './auth';

/** GET /sign-in-options: public, so the sign-in screen knows whether to offer Google. */
export function signInOptionsRoutes(auth: AuthGateway) {
  return new Hono<AppEnv>().get('/sign-in-options', (c) => c.json(auth.signInOptions));
}
