import { useSyncExternalStore } from 'react';

export type Toast = {
  id: number;
  message: string;
  tone: 'default' | 'error';
  action?: { label: string; run: () => void };
};

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Shows a short message at the bottom of the screen, with an optional action ("Undo"). */
export function toast(
  message: string,
  options: { tone?: Toast['tone']; action?: Toast['action']; durationMs?: number } = {},
): number {
  const item: Toast = {
    id: nextId++,
    message,
    tone: options.tone ?? 'default',
    action: options.action,
  };
  toasts = [...toasts.slice(-2), item]; // at most three at once
  emit();
  setTimeout(() => dismissToast(item.id), options.durationMs ?? 6000);
  return item.id;
}

export function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
  );
}
