import { ApiError } from '@fairshare/api-client';
import type { Currency, NewMember, Profile } from '@fairshare/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronDown, X } from 'lucide-react';
import { Avatar } from '../../components/common/avatar';
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

/** "Indian Rupee" for INR, in the browser's language: currency pickers show "INR · Indian Rupee". */
export const currencyName = (() => {
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

  const select =
    'h-12 w-full appearance-none rounded-lg border bg-card pr-11 pl-3.5 text-base font-medium outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-focus-ring';
  return (
    <form
      noValidate
      className="flex flex-col gap-[18px] lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {/* Desktop (d-new-group): the group in one card, its people in another. */}
      <div className="flex flex-col gap-[18px] lg:rounded-xl lg:border lg:bg-card lg:p-5 lg:shadow-card">
        <div className="flex flex-col gap-1.5">
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
            <p id="group-name-error" className="text-[13px] leading-[18px] text-destructive">
              {nameError}
            </p>
          )}
        </div>

        <EmojiPicker value={emoji} onChange={setEmoji} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="group-currency">Currency</Label>
          <div className="relative">
            <select
              id="group-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              className={select}
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {currencyName(c.code)}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-3.5 size-[18px] -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.9}
            />
          </div>
        </div>
      </div>

      <div aria-hidden className="h-px bg-border lg:hidden" />

      <section
        aria-labelledby="people-heading"
        className="flex flex-col gap-3 lg:rounded-xl lg:border lg:bg-card lg:p-5 lg:shadow-card"
      >
        <div>
          <h2 id="people-heading" className="text-[13px] font-bold lg:text-base">
            People
          </h2>
          <p className="text-[13px] leading-5 text-muted-foreground">You’re added as the owner.</p>
        </div>
        <ul className="flex flex-wrap gap-2">
          <li className="inline-flex h-10 items-center gap-2 rounded-full bg-muted pr-3 pl-1 text-sm font-bold">
            <Avatar name={me.name} src={me.avatarUrl} seed={me.id} size={32} />
            You · owner
          </li>
          {chips.map((chip) => (
            <li
              key={chip.key}
              className="inline-flex h-10 items-center gap-1 rounded-full bg-muted pr-1 pl-3.5 text-sm font-bold"
            >
              {chip.name}
              <button
                type="button"
                aria-label={`Remove ${chip.name}`}
                className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-card hover:text-foreground focus-visible:ring-3 focus-visible:ring-focus-ring"
                onClick={() => setChips(chips.filter((c) => c.key !== chip.key))}
              >
                <X aria-hidden className="size-4" strokeWidth={1.9} />
              </button>
            </li>
          ))}
        </ul>
        {duplicateNames.size > 0 && (
          <p className="text-[13px] leading-5 text-muted-foreground">
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

      {/* The bottom bar: full width on phones (m-new-group), Cancel and Create on desktop. */}
      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t bg-background px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:static lg:col-span-2 lg:pb-0 lg:mx-0 lg:flex-row lg:items-center lg:border-0 lg:bg-transparent lg:px-0 lg:pt-1">
        {create.error && (
          <p
            role="alert"
            className="rounded-md bg-destructive-muted px-3 py-2 text-sm text-destructive lg:flex-1"
          >
            {create.error instanceof ApiError
              ? errorMessage(create.error)
              : 'Something went wrong.'}
          </p>
        )}
        <div className="flex gap-2.5 lg:ml-auto">
          <Button asChild variant="secondary" size="md" className="hidden lg:inline-flex">
            <Link to="/">Cancel</Link>
          </Button>
          <Button
            type="submit"
            size="lg"
            className="flex-1 lg:h-12 lg:flex-none"
            loading={create.isPending}
          >
            Create group
          </Button>
        </div>
      </div>
    </form>
  );
}
