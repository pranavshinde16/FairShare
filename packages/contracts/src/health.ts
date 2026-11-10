import { z } from 'zod';

/** GET /api/health: unauthenticated liveness check. Deliberately reveals nothing else. */
export const HealthResponse = z.strictObject({
  ok: z.boolean(),
  db: z.enum(['up', 'down']),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
