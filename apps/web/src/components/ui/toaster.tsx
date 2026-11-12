import { X } from 'lucide-react';
import { dismissToast, useToasts } from '../../lib/toast';
import { cn } from '../../lib/utils';

/** Where toasts appear: above the bottom tabs on phones, bottom-centre on desktop. */
export function Toaster() {
  const toasts = useToasts();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-lg',
            t.tone === 'error'
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-foreground text-background',
          )}
        >
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="min-h-9 rounded-md px-2 font-semibold underline-offset-4 hover:underline"
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
            className="inline-flex size-8 items-center justify-center rounded-md opacity-70 hover:opacity-100"
            onClick={() => dismissToast(t.id)}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
