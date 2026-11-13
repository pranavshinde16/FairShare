import type { NewMember, UserRef } from '@fairshare/contracts';
import { useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../../components/common/avatar';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { cn } from '../../lib/utils';
import { peopleQuery } from './queries';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Chooses someone to add: a person I already share a group with, or someone new by name (with an
 * optional email, so they can claim their place when they sign up with it).
 */
export function PersonPicker({
  exclude = [],
  onPick,
  submitLabel,
  busy = false,
  list = false,
}: {
  /** The sheets' layout: people you know listed under the button, not as a typeahead. */
  list?: boolean;
  /** People who shouldn't be offered (already in the group). */
  exclude?: string[];
  onPick: (member: NewMember, display: UserRef | { name: string }) => void;
  submitLabel: string;
  busy?: boolean;
}) {
  const people = useQuery(peopleQuery);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const known = (people.data?.items ?? []).filter((p) => !exclude.includes(p.id));
  const matches = name.trim()
    ? known.filter((p) => p.name.toLowerCase().includes(name.trim().toLowerCase()))
    : known;

  function addNew() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a name.');
    if (trimmed.length > 60) return setError('Use at most 60 characters.');
    if (email.trim() && !EMAIL.test(email.trim())) return setError('Enter a valid email address.');
    setError(null);
    onPick(email.trim() ? { name: trimmed, email: email.trim() } : { name: trimmed }, {
      name: trimmed,
    });
    setName('');
    setEmail('');
  }

  // The people I already share a group with, narrowed by what's typed: under the name as a
  // typeahead (New group), or listed below the button in the Add a friend / Add a person sheets.
  const suggestions = matches.length > 0 && (
    <section
      aria-label="People you know"
      className={cn(
        'flex flex-col',
        !list && 'rounded-lg border bg-card px-3 py-1 shadow-card',
        list && 'mt-2',
      )}
    >
      <h3 className="mt-2 text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
        People you know
      </h3>
      <ul className="flex flex-col">
        {matches.slice(0, 8).map((person) => (
          <li key={person.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick({ userId: person.id }, person)}
              className="-mx-1 flex min-h-[52px] w-[calc(100%+0.5rem)] items-center gap-3 rounded-md px-1 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-focus-ring disabled:opacity-45"
            >
              <Avatar name={person.name} src={person.avatarUrl} seed={person.id} size={36} />
              <span className="flex-1 text-[15px] font-semibold">{person.name}</span>
              {person.isPlaceholder && (
                <span className="text-[13px] text-muted-foreground">Not joined</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-name">Name</Label>
        <Input
          id="person-name"
          value={name}
          autoComplete="off"
          placeholder="e.g. Rahul"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'person-error' : undefined}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addNew();
            }
          }}
        />
        {!list && known.length > 0 && suggestions}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-email">
          Email <span className="font-medium text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="person-email"
          type="email"
          value={email}
          autoComplete="off"
          placeholder="So they can join when they sign up"
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      {error && (
        <p id="person-error" role="alert" className="text-[13px] leading-[18px] text-destructive">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant={list ? 'default' : 'tint'}
        size={list ? 'lg' : 'md'}
        className={list ? undefined : 'lg:self-start'}
        loading={busy}
        onClick={addNew}
      >
        {!list && !busy && <UserPlus aria-hidden strokeWidth={1.9} />}
        {submitLabel}
      </Button>
      {list && suggestions}
    </div>
  );
}
