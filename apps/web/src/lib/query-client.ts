import { ApiError } from '@fairshare/api-client';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

const isUnauthenticated = (error: unknown) => error instanceof ApiError && error.status === 401;

/**
 * Server state for the whole app. Any 401 from the API means the session is gone (signed out
 * elsewhere, expired), so it calls `onUnauthenticated`, which sends the user to sign in.
 */
export function createQueryClient(onUnauthenticated: () => void) {
  const handle = (error: unknown) => {
    if (isUnauthenticated(error)) onUnauthenticated();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: handle }),
    mutationCache: new MutationCache({ onError: handle }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Retry what might be transient (network, 5xx), never a request the server refused.
        retry: (failures, error) =>
          failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
    },
  });
}
