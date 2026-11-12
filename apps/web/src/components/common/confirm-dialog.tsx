import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../lib/errors';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

/** "Are you sure?" with the action's own error shown in place if it fails. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
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
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'default'}
          loading={busy}
          onClick={() => void confirm()}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
