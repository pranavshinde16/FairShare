import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

// Open dialogs lock the page's scrolling. Counted, so when one dialog hands over to another (a form
// to its confirmation and back) the page stays locked until the last one closes.
let scrollLocks = 0;
function lockScroll() {
  if (scrollLocks++ === 0) document.documentElement.style.overflow = 'hidden';
}
function unlockScroll() {
  if (--scrollLocks === 0) document.documentElement.style.overflow = '';
}

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
  size = 'sheet',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** "full": the whole screen on phones (forms with a sticky Save), a larger dialog from 640px. */
  size?: 'sheet' | 'full';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Set while this component closes the dialog itself (its `open` turned false). The browser
  // fires "close" for that too, and it must not count as the user dismissing it: a parent that
  // swaps one dialog for another (edit → conflict, settings → confirm delete) would otherwise
  // be told to close everything.
  const closingRef = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      lockScroll();
      return unlockScroll;
    }
    if (dialog.open) {
      closingRef.current = true;
      dialog.close();
    }
    return undefined;
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        if (closingRef.current) closingRef.current = false;
        else onClose();
      }}
      // A click on the backdrop lands on the <dialog> itself, outside the content box.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'm-0 mt-auto w-full max-w-none border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50',
        size === 'full'
          ? 'h-dvh max-h-none rounded-none sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:max-w-lg sm:rounded-2xl'
          : 'rounded-t-2xl sm:m-auto sm:max-w-md sm:rounded-2xl',
      )}
    >
      {open && (
        <div
          className={cn(
            'flex flex-col gap-4 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]',
            size === 'full' ? 'h-full sm:max-h-[90dvh]' : 'max-h-[85dvh]',
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && <div className="text-sm text-muted-foreground">{description}</div>}
            </div>
            {/* Phones have no Esc key, and a full-screen dialog leaves no backdrop to tap. */}
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="-mt-1 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
