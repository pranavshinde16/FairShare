import { WifiOff } from 'lucide-react';
import { useOnline } from '../../lib/online';

/**
 * Shown while the device is offline (Blueprint C9: no expense entry without a connection). The
 * cached app still opens, and what was already loaded can be read; Save buttons are disabled.
 */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-foreground px-4 py-2.5 text-center text-sm font-semibold text-background"
    >
      <WifiOff aria-hidden className="size-[18px] shrink-0" strokeWidth={1.9} />
      You’re offline. Saving is off until you’re back online.
    </div>
  );
}
