import { HealthResponse } from '@fairshare/contracts';
import { createTransport, type TransportOptions } from './transport';

export type ApiClientOptions = TransportOptions;

/** The typed FairShare API. Methods are added here as their endpoints land. */
export function createApiClient(options: ApiClientOptions) {
  const { request } = createTransport(options);

  return {
    health: (signal?: AbortSignal) => request(HealthResponse, '/api/health', { signal }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
