import { useEffect, useRef } from 'react';

/**
 * The desktop shortcut (Blueprint 7.1): "n" starts a new expense, unless someone is typing or a
 * dialog is open.
 */
export function useNewExpenseShortcut(onNew: () => void) {
  const latest = useRef(onNew);
  useEffect(() => {
    latest.current = onNew;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target.closest('input, textarea, select, [contenteditable], dialog')) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
