import type { NewMember, UserRef } from '@fairshare/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Avatar } from '../../components/common/avatar';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
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
}: {
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="person-name">Name</Label>
        <Input
          id="person-name"
          value={name}
          autoComplete="off"
          placeholder="e.g. Rahul"
          aria-invalid={error ? true : undefined}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addNew();
            }
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="person-email">
          Email <span className="font-normal text-muted-foreground">(optional)</span>
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
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="button" loading={busy} onClick={addNew}>
        {submitLabel}
      </Button>

      {matches.length > 0 && (
        <section aria-label="People you know" className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            People you know
          </h3>
          <ul className="flex flex-col gap-1">
            {matches.slice(0, 8).map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick({ userId: person.id }, person)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-muted disabled:opacity-50"
                >
                  <Avatar name={person.name} src={person.avatarUrl} size="sm" />
                  <span className="flex-1 text-sm font-medium">{person.name}</span>
                  {person.isPlaceholder && (
                    <span className="text-xs text-muted-foreground">Not joined</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
