import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '../../components/ui/button';

const HOUR = 60 * 60 * 1000;

/**
 * The service worker's update prompt (Blueprint 4 "PWA"): a new version is downloaded in the
 * background and waits; the person reloads when they choose, so nothing typed is lost.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // An app left open for days still hears about new versions.
      if (registration) setInterval(() => void registration.update(), HOUR);
    },
  });
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(94px+env(safe-area-inset-bottom))] z-50 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-[15px] shadow-pop lg:inset-x-auto lg:right-6 lg:bottom-6 lg:max-w-sm"
    >
      <p className="min-w-0 flex-1 font-semibold">A new version of FairShare is ready.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="plain" onClick={() => setNeedRefresh(false)}>
          Later
        </Button>
        <Button size="sm" onClick={() => void updateServiceWorker(true)}>
          Reload
        </Button>
      </div>
    </div>
  );
}
