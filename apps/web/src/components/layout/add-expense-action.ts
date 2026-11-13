import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * What "Add expense" does on the current page (DESIGN_SPEC §2): the desktop top bar's button and
 * the phones' floating button are the shell's, but a group or a friend page knows what they should
 * open (its own form). A page registers that here; without one the shell opens "Who is it with?".
 *
 * A page that registers also gets the floating button on phones (Groups, Friends, a group, a
 * friend), so only the pages that should show it do.
 */
export type AddExpenseAction = {
  /** What the button does; null for the shell's "Who is it with?" picker. */
  run: (() => void) | null;
  /** The action is starting (a friendship being opened): the button shows a spinner. */
  busy?: boolean;
};

let current: AddExpenseAction | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** The current page's action, or null when the page shows no floating button. */
export function useAddExpenseAction(): AddExpenseAction | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

/**
 * In a page: what "Add expense" does here (`run`), or the shell's picker (`null`). `enabled: false`
 * hides the floating button (a deleted friend can't be in new expenses).
 */
export function useRegisterAddExpense(
  run: (() => void) | null,
  { busy = false, enabled = true }: { busy?: boolean; enabled?: boolean } = {},
) {
  // The latest handler, without re-registering on every render.
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  const hasRun = run !== null;
  useEffect(() => {
    if (!enabled) return;
    const action: AddExpenseAction = {
      run: hasRun ? () => latest.current?.() : null,
      busy,
    };
    current = action;
    emit();
    return () => {
      if (current === action) {
        current = null;
        emit();
      }
    };
  }, [enabled, hasRun, busy]);
}
