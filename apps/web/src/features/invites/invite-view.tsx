import { ApiError } from '@fairshare/api-client';
import type { InvitePreview } from '@fairshare/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Clock, Link2Off, UserCheck, type LucideIcon } from 'lucide-react';
import { Avatar } from '../../components/common/avatar';
import { GroupTile } from '../../components/common/tiles';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { cn } from '../../lib/utils';
import { afterMembershipChange } from '../../lib/invalidation';
import { plural } from '../../lib/money';

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

  if (preview.expired) {
    return (
      <Message icon={Clock} title="This invite has expired">
        Ask {preview.invitedBy.name} for a new link.
      </Message>
    );
  }
  if (direct && preview.placeholders.length === 0) {
    return (
      <Message icon={UserCheck} title="This link has been used">
        The friend it was made for has joined.
      </Message>
    );
  }

  const inviter = preview.invitedBy.name;
  const groupName = preview.group.name ?? '';
  return (
    // The invite card (DESIGN_SPEC §5 m-invite, d-invite): who invited you, to what, then join.
    <section className="flex flex-col rounded-2xl border bg-card p-[22px] shadow-card">
      <h1>
        <span className="flex items-center gap-2 text-[15px] leading-[22px] font-normal text-muted-foreground">
          <Avatar name={inviter} size={24} className="size-7" />
          <span>
            <b className="font-bold text-foreground">{inviter}</b>
            {direct ? ' added you as a friend on FairShare' : ' invited you to'}
          </span>
        </span>
        {!direct && (
          <span className="mt-4 flex items-center gap-3.5">
            <GroupTile emoji={preview.group.emoji} name={groupName} seed={groupName} size={64} />
            <span className="flex min-w-0 flex-col">
              <span className="text-[28px] leading-[34px] font-extrabold tracking-[-0.02em] break-words">
                {groupName}
              </span>
              <span className="mt-0.5 text-[15px] leading-[22px] font-normal text-muted-foreground">
                {plural(preview.group.memberCount, 'person', 'people')} so far
              </span>
            </span>
          </span>
        )}
      </h1>
      <div aria-hidden className="my-5 h-px bg-border" />

      {!signedIn ? (
        <div className="flex flex-col gap-3.5">
          <p className="text-[15px] leading-[22px] text-muted-foreground">
            Sign in or create an account to join.
          </p>
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
              <legend className="mb-2 text-[13px] font-bold">
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
    </section>
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
        'flex min-h-[52px] cursor-pointer items-center gap-3 rounded-lg px-4 text-[15px] font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-focus-ring',
        checked ? 'border-2 border-primary bg-accent' : 'border hover:bg-muted/60',
      )}
    >
      <input
        type="radio"
        name="who"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="size-5 accent-[var(--primary)]"
      />
      {children}
    </label>
  );
}

function AcceptError({ error }: { error: unknown }) {
  const already = error instanceof ApiError && error.code === 'ALREADY_MEMBER';
  return (
    <p role="alert" className="rounded-md bg-destructive-muted px-3 py-2 text-sm text-destructive">
      {already ? 'You’re already in this group. ' : errorMessage(error)}
      {already && (
        <Link to="/" className="font-bold underline">
          Go to Home
        </Link>
      )}
    </p>
  );
}

/** An invite that can't be used (D11): an icon, what happened, and the way on. */
export function Message({
  icon: Icon = Link2Off,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-[22px] shadow-card">
      <span className="inline-flex size-12 items-center justify-center rounded-[14px] bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-6" strokeWidth={1.9} />
      </span>
      <h1 className="text-[22px] leading-7 font-extrabold tracking-[-0.02em]">{title}</h1>
      <p className="text-[15px] leading-[22px] text-muted-foreground">{children}</p>
      <Button asChild variant="secondary" className="mt-1">
        <Link to="/">Go to FairShare</Link>
      </Button>
    </section>
  );
}
