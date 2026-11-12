import {
  CurrencyList,
  HealthResponse,
  Profile,
  SignInOptions,
  type UpdateProfile,
} from '@fairshare/contracts';
import { createTransport, type TransportOptions } from './transport';

export type ApiClientOptions = TransportOptions;

/**
 * The typed FairShare API. Methods are added here as their endpoints land. Sign-in itself (email
 * codes, Google, sign-out) goes through Better Auth's own client at /api/auth/*, not this one.
 */
export function createApiClient(options: ApiClientOptions) {
  const { request } = createTransport(options);

  return {
    health: (signal?: AbortSignal) => request(HealthResponse, '/api/health', { signal }),

    /** Public: which sign-in methods to offer. */
    signInOptions: (signal?: AbortSignal) =>
      request(SignInOptions, '/api/v1/sign-in-options', { signal }),

    currencies: (signal?: AbortSignal) => request(CurrencyList, '/api/v1/currencies', { signal }),

    me: (signal?: AbortSignal) => request(Profile, '/api/v1/me', { signal }),
    updateMe: (body: UpdateProfile) => request(Profile, '/api/v1/me', { method: 'PATCH', body }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
