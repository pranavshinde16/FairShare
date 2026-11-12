import { ApiError } from '@fairshare/api-client';
import {
  CurrencyCode,
  UPI_VPA_PATTERN,
  ValidationFailedDetails,
  type Currency,
  type Profile,
} from '@fairshare/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { errorMessage } from '../../lib/errors';
import { useUpdateProfile } from './queries';

/**
 * The form's view of UpdateProfile, with friendlier messages: every field present, an empty UPI ID
 * meaning "none". The rules match the contract's (PersonName: trimmed, 1–60 characters).
 */
const ProfileFields = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(60, 'Use at most 60 characters.'),
  defaultCurrency: CurrencyCode,
  upiVpa: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || UPI_VPA_PATTERN.test(value),
      'Enter a UPI ID like name@bank.',
    ),
});
type ProfileFields = z.infer<typeof ProfileFields>;

const currencyName = (() => {
  const names = new Intl.DisplayNames(undefined, { type: 'currency' });
  return (code: string) => names.of(code) ?? code;
})();

export function ProfileForm({ profile, currencies }: { profile: Profile; currencies: Currency[] }) {
  const update = useUpdateProfile();
  const [saved, setSaved] = useState(false);
  const form = useForm({
    resolver: zodResolver(ProfileFields),
    values: {
      name: profile.name,
      defaultCurrency: profile.defaultCurrency,
      upiVpa: profile.upiVpa ?? '',
    },
  });
  const { errors, isDirty } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setSaved(false);
    try {
      await update.mutateAsync({ ...values, upiVpa: values.upiVpa || null });
      setSaved(true);
    } catch (error) {
      // Point a server-side rejection (an unsupported currency, say) at its field.
      const details =
        error instanceof ApiError ? ValidationFailedDetails.safeParse(error.details) : null;
      for (const issue of details?.success ? details.data.issues : []) {
        const field = issue.path[0];
        if (field === 'name' || field === 'defaultCurrency' || field === 'upiVpa') {
          form.setError(field, { message: issue.message });
        }
      }
    }
  });

  const field = (name: keyof ProfileFields) => ({
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
  });
  const fieldError = (name: keyof ProfileFields) =>
    errors[name] && (
      <p id={`${name}-error`} className="text-sm text-destructive">
        {errors[name].message}
      </p>
    );

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" autoComplete="name" {...field('name')} {...form.register('name')} />
        {fieldError('name')}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="defaultCurrency">Default currency</Label>
        <select
          id="defaultCurrency"
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 sm:text-sm"
          {...field('defaultCurrency')}
          {...form.register('defaultCurrency')}
        >
          {currencies.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.code} · {currencyName(currency.code)}
            </option>
          ))}
        </select>
        <p className="text-sm text-muted-foreground">New groups start in this currency.</p>
        {fieldError('defaultCurrency')}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="upiVpa">
          UPI ID <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="upiVpa"
          placeholder="name@bank"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          {...field('upiVpa')}
          {...form.register('upiVpa')}
        />
        <p className="text-sm text-muted-foreground">So friends can pay you back by UPI.</p>
        {fieldError('upiVpa')}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={form.formState.isSubmitting} disabled={!isDirty}>
          Save changes
        </Button>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {saved && !isDirty && 'Saved.'}
        </p>
      </div>
      {update.error &&
        !(update.error instanceof ApiError && update.error.code === 'VALIDATION_FAILED') && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(update.error)}
          </p>
        )}
    </form>
  );
}
