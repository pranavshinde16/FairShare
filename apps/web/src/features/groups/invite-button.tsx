import { Share2 } from 'lucide-react';
import { useState } from 'react';
import { Button, type ButtonProps } from '../../components/ui/button';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { shareLink } from '../../lib/share';

const STATUS = {
  shared: 'Invite shared.',
  copied: 'Invite link copied.',
  cancelled: null,
  failed: 'Couldn’t share or copy the link.',
} as const;

/**
 * Creates an invite link and opens the share sheet (WhatsApp on phones), or copies the link. With
 * a placeholder, the link is aimed at them: the claim screen preselects their name.
 */
export function InviteButton({
  groupId,
  groupName,
  placeholder,
  ...buttonProps
}: {
  groupId: string;
  groupName: string;
  placeholder?: { id: string; name: string };
} & Omit<ButtonProps, 'onClick'>) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function invite() {
    setBusy(true);
    setStatus(null);
    try {
      const { url } = await api.createInvite(groupId, {
        ...(placeholder && { targetPlaceholderId: placeholder.id }),
      });
      const text = placeholder
        ? `${placeholder.name}, join ${groupName} on FairShare to see what we've shared:`
        : `Join ${groupName} on FairShare to split expenses with us:`;
      setStatus(STATUS[await shareLink(url, `Join ${groupName}`, text)]);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button {...buttonProps} loading={busy} onClick={() => void invite()}>
        {!busy && <Share2 aria-hidden />}
        {placeholder ? `Invite ${placeholder.name}` : 'Invite'}
      </Button>
      <span aria-live="polite" className="text-xs text-muted-foreground">
        {status}
      </span>
    </span>
  );
}
