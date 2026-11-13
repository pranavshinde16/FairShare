import { X } from 'lucide-react';
import { dismissToast, useToasts } from '../../lib/toast';
import { cn } from '../../lib/utils';

/** Where toasts appear: above the tab bar and the floating button on phones, bottom-centre on desktop. */
export function Toaster() {
  const toasts = useToasts();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[160px] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg py-2 pr-2 pl-4 text-sm font-semibold shadow-pop',
            t.tone === 'error'
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-foreground text-background',
          )}
        >
          <span className="flex-1 py-1.5">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="min-h-11 rounded-md px-3 font-extrabold underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-current"
              onClick={() => {
                dismissToast(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            className="inline-flex size-11 items-center justify-center rounded-md opacity-75 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current"
            onClick={() => dismissToast(t.id)}
          >
            <X aria-hidden className="size-[18px]" />
          </button>
        </div>
      ))}
    </div>
  );
}
