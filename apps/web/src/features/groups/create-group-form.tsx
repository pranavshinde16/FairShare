import { ApiError } from '@fairshare/api-client';
import type { Currency, NewMember, Profile } from '@fairshare/contracts';
import { useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { errorMessage } from '../../lib/errors';
import { uuidv7 } from '../../lib/ids';
import { EmojiPicker } from './emoji-picker';
import { PersonPicker } from './person-picker';
import { useCreateGroup } from './queries';

type Chip = { key: string; member: NewMember; name: string };

const currencyName = (() => {
  const names = new Intl.DisplayNames(undefined, { type: 'currency' });
  return (code: string) => names.of(code) ?? code;
})();

/** Blueprint 7.2 "Create group": name, emoji, currency, people (known ones or new placeholders). */
export function CreateGroupForm({ me, currencies }: { me: Profile; currencies: Currency[] }) {
  const navigate = useNavigate();
  const create = useCreateGroup();
  // One ID per form: a retry after a network error can't create the group twice.
  const id = useRef(uuidv7()).current;
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [currency, setCurrency] = useState(me.defaultCurrency);
  const [chips, setChips] = useState<Chip[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);

  const chosenIds = chips.flatMap((c) => ('userId' in c.member ? [c.member.userId] : []));
  const duplicateNames = new Set(
    chips
      .map((c) => c.name.toLowerCase())
      .filter((n, i, all) => all.indexOf(n) !== i || n === me.name.toLowerCase()),
  );

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return setNameError('Give the group a name.');
    if (trimmed.length > 60) return setNameError('Use at most 60 characters.');
    setNameError(null);
    try {
      const group = await create.mutateAsync({
        id,
        name: trimmed,
        currency,
        ...(emoji && { emoji }),
        members: chips.map((c) => c.member),
      });
      await navigate({
        to: '/groups/$groupId',
        params: { groupId: group.id },
        search: { tab: 'members', created: true },
      });
    } catch {
      // Shown below from create.error.
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="group-name">Group name</Label>
        <Input
          id="group-name"
          value={name}
          autoFocus
          placeholder="e.g. Goa Trip"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'group-name-error' : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {nameError && (
          <p id="group-name-error" className="text-sm text-destructive">
            {nameError}
          </p>
        )}
      </div>

      <EmojiPicker value={emoji} onChange={setEmoji} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="group-currency">Currency</Label>
        <select
          id="group-currency"
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 sm:text-sm"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {currencyName(c.code)}
            </option>
          ))}
        </select>
      </div>

      <section aria-labelledby="people-heading" className="flex flex-col gap-3">
        <h2 id="people-heading" className="text-sm font-medium">
          People <span className="font-normal text-muted-foreground">(you’re added as owner)</span>
        </h2>
        {chips.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <li
                key={chip.key}
                className="inline-flex h-9 items-center gap-1 rounded-full border bg-muted pr-1 pl-3 text-sm"
              >
                {chip.name}
                <button
                  type="button"
                  aria-label={`Remove ${chip.name}`}
                  className="inline-flex size-7 items-center justify-center rounded-full hover:bg-background"
                  onClick={() => setChips(chips.filter((c) => c.key !== chip.key))}
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {duplicateNames.size > 0 && (
          <p className="text-sm text-muted-foreground">
            Two people have the same name. That’s fine if they really are different people.
          </p>
        )}
        <PersonPicker
          exclude={chosenIds}
          submitLabel="Add person"
          onPick={(member, display) =>
            setChips([...chips, { key: uuidv7(), member, name: display.name }])
          }
        />
      </section>

      {create.error && (
        <p role="alert" className="text-sm text-destructive">
          {create.error instanceof ApiError ? errorMessage(create.error) : 'Something went wrong.'}
        </p>
      )}
      <Button type="submit" size="lg" loading={create.isPending}>
        Create group
      </Button>
    </form>
  );
}
