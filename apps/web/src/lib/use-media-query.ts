import { useSyncExternalStore } from 'react';

/** Whether a CSS media query matches now, following it as it changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  );
}

/** The `lg` breakpoint (DESIGN_SPEC §2): the desktop shell from 1024px. */
export const DESKTOP = '(min-width: 1024px)';
