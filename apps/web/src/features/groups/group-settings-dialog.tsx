import type { Currency, Group } from '@fairshare/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/common/confirm-dialog';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { EmojiPicker } from './emoji-picker';
import { afterMembershipChange } from '../../lib/invalidation';
import { useUpdateGroup } from './queries';

/** Rename, change the emoji or currency, and (the owner) delete the group. */
export function GroupSettingsDialog({
  open,
  onClose,
  group,
  currencies,
}: {
  open: boolean;
  onClose: () => void;
  group: Group & { kind: 'group' };
  currencies: Currency[];
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const update = useUpdateGroup(group.id);
  const [name, setName] = useState(group.name);
  const [emoji, setEmoji] = useState(group.emoji);
  const [currency, setCurrency] = useState(group.currency);
  const [deleting, setDeleting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return setNameError('Give the group a name.');
    setNameError(null);
    update.mutate(
      { name: trimmed, emoji, ...(currency !== group.currency && { currency }) },
      { onSuccess: onClose },
    );
  }

  return (
    <>
      <Dialog open={open && !deleting} onClose={onClose} title="Group settings">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              value={name}
              aria-invalid={nameError ? true : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {nameError && (
              <p className="text-[13px] leading-[18px] text-destructive">{nameError}</p>
            )}
          </div>
          <EmojiPicker value={emoji} onChange={setEmoji} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-currency">Currency</Label>
            <div className="relative">
              <select
                id="settings-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                className="h-12 w-full appearance-none rounded-lg border bg-card pr-11 pl-3.5 text-base font-medium outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-focus-ring"
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-3.5 size-[18px] -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.9}
              />
            </div>
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              Can change only while the group has no expenses.
            </p>
          </div>
          {update.error && (
            <p
              role="alert"
              className="rounded-md bg-destructive-muted px-3 py-2 text-sm text-destructive"
            >
              {errorMessage(update.error)}
            </p>
          )}
          <Button type="submit" size="lg" loading={update.isPending}>
            Save
          </Button>
          {group.myRole === 'owner' && (
            <Button type="button" variant="destructive-ghost" onClick={() => setDeleting(true)}>
              <Trash2 aria-hidden strokeWidth={1.9} />
              Delete group
            </Button>
          )}
        </form>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${group.name}?`}
        confirmLabel="Delete group"
        destructive
        onConfirm={async () => {
          await api.deleteGroup(group.id);
          queryClient.removeQueries({ queryKey: ['group', group.id] });
          await afterMembershipChange(queryClient, group.id);
          await navigate({ to: '/' });
        }}
      >
        Everyone must be settled up first. The group disappears for all its members.
      </ConfirmDialog>
    </>
  );
}
