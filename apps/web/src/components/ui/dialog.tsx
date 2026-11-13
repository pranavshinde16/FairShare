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

/** Width from `lg` (DESIGN_SPEC §2: dialogs on desktop). */
const WIDTHS = {
  md: 'lg:max-w-[440px]',
  lg: 'lg:max-w-[560px]',
  xl: 'lg:max-w-[960px]',
} as const;

/**
 * The one responsive sheet/dialog (DESIGN_SPEC §2, §4), on the browser's own <dialog>: it traps
 * focus, closes on Esc, makes the page behind it inert and is named by its title. Not Radix Dialog
 * or vaul (shadcn's Drawer): their scroll lock injects a <style> element, which the CSP blocks;
 * locking scroll here goes through element.style, which the CSP allows.
 *
 * - sheet: confirmations and short forms. A bottom sheet below `lg`, a centred dialog from `lg`.
 * - full: create/edit forms. Full screen below `lg` with a header (✕ left, title centred, an
 *   optional text action right), a wide dialog from `lg`. `footer` is a bar pinned to the bottom.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  size = 'sheet',
  width,
  action,
  reserveAction = false,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  size?: 'sheet' | 'full';
  /** The dialog's width from `lg`. Sheets default to md, full forms to lg. */
  width?: keyof typeof WIDTHS;
  /** full only: a text action in the header ("Save", "Done"). */
  action?: ReactNode;
  /**
   * full only: keep room at the header's right for an action the content places there itself (a
   * form's own submit button, positioned over the header on phones).
   */
  reserveAction?: boolean;
  /** A bar pinned to the bottom (the form's main button). */
  footer?: ReactNode;
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
      if (!dialog.open) {
        dialog.showModal();
        // React's autoFocus ran while the dialog was still closed (and so unfocusable), and the
        // browser then focuses the first control, the Close button. Hand focus to the field the
        // form asked for instead.
        dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      }
      lockScroll();
      return unlockScroll;
    }
    if (dialog.open) {
      closingRef.current = true;
      dialog.close();
    }
    return undefined;
  }, [open]);

  const full = size === 'full';
  // Phones have no Esc key, and a full-screen dialog leaves no backdrop to tap.
  const close = (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:outline-1 focus-visible:outline-primary',
        full ? 'order-first lg:order-last lg:-mt-2 lg:-mr-2.5' : '-mt-2 -mr-2.5',
      )}
    >
      <X aria-hidden className="size-5" strokeWidth={1.9} />
    </button>
  );

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
        'group/dialog m-0 w-full max-w-none p-0 text-foreground shadow-pop backdrop:bg-overlay lg:m-auto lg:rounded-2xl lg:border lg:bg-card',
        full
          ? 'h-dvh max-h-none rounded-none bg-background lg:h-auto lg:max-h-[90dvh]'
          : 'mt-auto max-h-[90dvh] rounded-t-2xl bg-card lg:max-h-[85dvh]',
        WIDTHS[width ?? (full ? 'lg' : 'md')],
      )}
    >
      {open && (
        <div
          className={cn(
            'relative flex flex-col',
            full ? 'h-dvh lg:h-auto lg:max-h-[90dvh]' : 'max-h-[90dvh] lg:max-h-[85dvh]',
          )}
        >
          {full ? (
            <header className="flex min-h-[60px] shrink-0 items-center gap-1 border-b px-2 py-1.5 max-lg:group-has-[[data-hide-header]]/dialog:hidden lg:items-start lg:gap-2 lg:border-0 lg:px-6 lg:pt-6 lg:pb-2">
              {close}
              <div className="min-w-0 flex-1 text-center lg:text-left">
                <h2
                  id={titleId}
                  className="text-[17px] leading-6 font-extrabold lg:text-[21px] lg:leading-7 lg:tracking-[-0.01em]"
                >
                  {title}
                </h2>
                {description && (
                  <div className="text-xs text-muted-foreground lg:mt-1.5 lg:text-[15px] lg:leading-[22px]">
                    {description}
                  </div>
                )}
              </div>
              {action ?? (
                <span
                  aria-hidden
                  className={cn('shrink-0 lg:hidden', reserveAction ? 'w-24' : 'w-11')}
                />
              )}
            </header>
          ) : (
            <header className="flex shrink-0 flex-col px-5 pt-2 lg:px-6 lg:pt-6">
              <span
                aria-hidden
                className="mx-auto mb-1 h-1 w-10 shrink-0 rounded-full bg-border lg:hidden"
              />
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h2
                    id={titleId}
                    className="text-[21px] leading-7 font-extrabold tracking-[-0.01em]"
                  >
                    {title}
                  </h2>
                  {description && (
                    <div className="mt-1.5 text-[15px] leading-[22px] text-muted-foreground">
                      {description}
                    </div>
                  )}
                </div>
                {close}
              </div>
            </header>
          )}
          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto',
              full
                ? 'px-4 py-4 lg:px-6 lg:pb-6'
                : 'px-5 pt-4 pb-[max(1.75rem,env(safe-area-inset-bottom))] lg:px-6 lg:pb-6',
              footer && 'pb-4 lg:pb-4',
            )}
          >
            {children}
          </div>
          {footer && (
            <div className="shrink-0 border-t bg-background px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:border-0 lg:bg-card lg:px-6 lg:pt-2 lg:pb-6">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
