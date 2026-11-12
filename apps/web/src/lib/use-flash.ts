import { useState } from 'react';

/**
 * A short highlight when a shown balance changes (Blueprint 7.2: after a payment, "the balance card
 * animates to its new value"). Returns a key that changes with each new value, which restarts the
 * CSS animation, and the class that plays it; nothing on first show. `identity` is what the value
 * belongs to (a group, a person): switching to another one isn't a change worth flashing.
 */
export function useFlash(value: string, identity = ''): { key: number; className?: string } {
  const [seen, setSeen] = useState({ value, identity, count: 0 });
  let current = seen;
  if (seen.value !== value || seen.identity !== identity) {
    current = { value, identity, count: seen.identity === identity ? seen.count + 1 : 0 };
    setSeen(current);
  }
  return current.count > 0
    ? { key: current.count, className: 'balance-flash' }
    : { key: current.count };
}
