import { useEffect, useState } from 'react';

/** Whole seconds left until `until` (a timestamp in ms), updating every second; 0 once passed. */
export function useCountdown(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => {
    if (left === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [left]);
  return left;
}
