import { ApiError } from '@fairshare/api-client';
import type { InvitePreview } from '@fairshare/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { cn } from '../../lib/utils';
import { afterMembershipChange } from '../../lib/invalidation';

const NEW = 'new';

/** What an invite leads to, and the choice of who to join as (Blueprint 7.2 "Invite"). */
export function InviteView({
  token,
  preview,
  signedIn,
}: {
  token: string;
  preview: InvitePreview;
  signedIn: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const direct = preview.group.name === null;
  const [choice, setChoice] = useState<string>(
    preview.targetPlaceholderId ?? (direct ? (preview.placeholders[0]?.id ?? NEW) : NEW),
  );
  const accept = useMutation({
    mutationFn: () => api.acceptInvite(token, choice === NEW ? {} : { claimPlaceholderId: choice }),
    onSuccess: async ({ groupId }) => {
      // Claiming a placeholder can change other groups it was in, too.
      await afterMembershipChange(queryClient, choice === NEW ? groupId : undefined);
      await navigate({ to: '/groups/$groupId', params: { groupId }, search: { tab: 'members' } });
    },
  });

  const heading = direct
    ? `${preview.invitedBy.name} added you as a friend on FairShare`
    : `${preview.invitedBy.name} invited you to ${preview.group.emoji ?? ''} ${preview.group.name}`.replace(
        /\s+/g,
        ' ',
      );

  if (preview.expired) {
    return (
      <Message title="This invite has expired">
        Ask {preview.invitedBy.name} for a new link.
      </Message>
    );
  }
  if (direct && preview.placeholders.length === 0) {
    return (
      <Message title="This link has been used">The friend it was made for has joined.</Message>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        {!direct && (
          <p className="text-sm text-muted-foreground">{preview.group.memberCount} people so far</p>
        )}
      </div>

      {!signedIn ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Sign in or create an account to join.</p>
          <Button asChild size="lg">
            <Link to="/sign-in" search={{ returnTo: `/invite/${token}` }}>
              Sign in to join
            </Link>
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            accept.mutate();
          }}
        >
          {(preview.placeholders.length > 0 || !direct) && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">
                {preview.placeholders.length > 0 ? 'Which one is you?' : 'Join as yourself'}
              </legend>
              {preview.placeholders.map((p) => (
                <Choice key={p.id} value={p.id} checked={choice === p.id} onChange={setChoice}>
                  I’m {p.name}
                </Choice>
              ))}
              {!direct && (
                <Choice value={NEW} checked={choice === NEW} onChange={setChoice}>
                  {preview.placeholders.length > 0
                    ? 'I’m not listed: join as myself'
                    : 'Join the group'}
                </Choice>
              )}
            </fieldset>
          )}
          {accept.error && <AcceptError error={accept.error} />}
          <Button type="submit" size="lg" loading={accept.isPending}>
            Join
          </Button>
        </form>
      )}
    </div>
  );
}

function Choice({
  value,
  checked,
  onChange,
  children,
}: {
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        checked ? 'border-primary bg-accent' : 'hover:bg-muted',
      )}
    >
      <input
        type="radio"
        name="who"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="size-4 accent-[var(--primary)]"
      />
      {children}
    </label>
  );
}

function AcceptError({ error }: { error: unknown }) {
  const already = error instanceof ApiError && error.code === 'ALREADY_MEMBER';
  return (
    <p role="alert" className="text-sm text-destructive">
      {already ? 'You’re already in this group. ' : errorMessage(error)}
      {already && (
        <Link to="/" className="underline">
          Go to Home
        </Link>
      )}
    </p>
  );
}

export function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
      <Link to="/" className="mt-2 text-sm text-primary underline-offset-4 hover:underline">
        Go to FairShare
      </Link>
    </div>
  );
}
