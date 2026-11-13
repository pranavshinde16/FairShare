import { InviteToken } from '@fairshare/contracts';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

/** The token in a pasted invite link (…/invite/<token>), or null if it isn't one. */
export function tokenFromLink(text: string): string | null {
  const match = /\/invite\/([A-Za-z0-9_-]+)/.exec(text.trim());
  const token = match?.[1] ?? text.trim();
  return InviteToken.safeParse(token).success ? token : null;
}

/** "Have an invite link? Paste it." */
export function JoinWithLink() {
  const navigate = useNavigate();
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const token = tokenFromLink(link);
        if (!token) return setError('That doesn’t look like a FairShare invite link.');
        void navigate({ to: '/invite/$token', params: { token } });
      }}
    >
      <Label htmlFor="invite-link">Invite link</Label>
      <div className="flex gap-2">
        <Input
          id="invite-link"
          value={link}
          placeholder="Paste the link"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'invite-link-error' : undefined}
          onChange={(event) => {
            setLink(event.target.value);
            setError(null);
          }}
        />
        <Button type="submit" variant="secondary">
          Open
        </Button>
      </div>
      {error && (
        <p id="invite-link-error" className="text-[13px] leading-5 text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
