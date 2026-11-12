import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from './storage';

// Kept in step with public/theme.js, which applies the theme before the first paint.
const KEY = 'fairshare.theme';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const isTheme = (value: unknown): value is Theme => THEMES.includes(value as Theme);
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)');

let current: Theme = isTheme(readStored('local', KEY))
  ? (readStored('local', KEY) as Theme)
  : 'system';
const listeners = new Set<() => void>();

function apply() {
  const dark = current === 'dark' || (current === 'system' && systemDark().matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Starts following the system setting while the theme is "system". Call once at startup. */
export function initTheme() {
  apply();
  systemDark().addEventListener('change', apply);
}

/** Saves the choice on this device only (Blueprint 4.1: theme isn't part of the profile). */
export function setTheme(theme: Theme) {
  current = theme;
  writeStored('local', KEY, theme);
  apply();
  for (const listener of listeners) listener();
}

/** The saved theme choice, re-rendering when it changes. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
