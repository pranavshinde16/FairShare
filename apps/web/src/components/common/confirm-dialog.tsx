import { TriangleAlert, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../lib/errors';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

/**
 * "Are you sure?" (DESIGN_SPEC §4 ConfirmSheet): the title, one sentence on what happens, the
 * action and Cancel, full width. A bottom sheet on phones, a dialog on desktop. The action's own
 * error shows in place if it fails. `notice` explains why the action can't be taken yet, with
 * `confirmDisabled`.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  destructive = false,
  icon: Icon,
  notice,
  confirmDisabled = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Beside the action's label (Delete has a bin). */
  icon?: LucideIcon;
  /** Why the action is blocked, shown above the buttons ("… owes ₹11,200.00 …"). */
  notice?: ReactNode;
  confirmDisabled?: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={title} description={children}>
      {notice && (
        <div className="flex items-start gap-2.5 rounded-lg bg-owe-muted px-3.5 py-3 text-sm leading-5 font-semibold text-owe-muted-foreground">
          <TriangleAlert aria-hidden className="mt-px size-[18px] shrink-0" strokeWidth={1.9} />
          <p>{notice}</p>
        </div>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
      )}
      <div className="flex flex-col gap-2.5">
        <Button
          size="lg"
          variant={destructive ? 'destructive' : 'default'}
          loading={busy}
          disabled={confirmDisabled}
          onClick={() => void confirm()}
        >
          {Icon && !busy && <Icon aria-hidden strokeWidth={1.9} />}
          {confirmLabel}
        </Button>
        <Button size="lg" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
