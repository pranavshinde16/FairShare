import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { authClient } from '../../lib/auth-client';
import { signInErrorMessage } from './errors';
import { pendingSignIn } from './session';

const EmailForm = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .pipe(z.email('Enter a valid email address.').max(254, 'That address is too long.')),
});

/** Step 1: the address to send a code to. */
export function EmailStep({ returnTo }: { returnTo?: string }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(EmailForm),
    defaultValues: { email: pendingSignIn.get()?.email ?? '' },
  });
  const fieldError = form.formState.errors.email?.message;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    const result = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
    if (result.error) {
      setError(signInErrorMessage(result.error));
      return;
    }
    pendingSignIn.set(email);
    await navigate({ to: '/sign-in/verify', search: { returnTo } });
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          placeholder="you@example.com"
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'email-error' : undefined}
          {...form.register('email')}
        />
        {fieldError && (
          <p id="email-error" className="text-[13px] leading-[18px] text-destructive">
            {fieldError}
          </p>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-md bg-destructive-muted px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
        Continue
      </Button>
    </form>
  );
}
