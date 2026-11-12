import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * A modal on the browser's own <dialog>: it traps focus, closes on Esc and makes the page behind it
 * inert. A bottom sheet on phones, centered from 640px. (Not Radix's Dialog: its scroll lock injects
 * a <style> element, which the CSP blocks. Locking scroll here goes through element.style, which the
 * CSP allows.)
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = 'hidden';
    }
    if (!open && dialog.open) dialog.close();
    return () => {
      if (open) document.documentElement.style.overflow = '';
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> itself, outside the content box.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'm-0 mt-auto w-full max-w-none rounded-t-2xl border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50',
        'sm:m-auto sm:max-w-md sm:rounded-2xl',
      )}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {description && <div className="text-sm text-muted-foreground">{description}</div>}
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
