import { useSyncExternalStore } from 'react';

/**
 * Whether the browser thinks it's online (Blueprint C9: no expense entry without a connection).
 * "Online" can still mean a request fails; "offline" is certain, so Save is disabled on it.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}
