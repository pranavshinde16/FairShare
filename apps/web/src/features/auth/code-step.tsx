import { useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { authClient } from '../../lib/auth-client';
import { useCountdown } from '../../lib/use-countdown';
import { signInErrorMessage, type AuthClientError } from './errors';
import { CODE_LENGTH, OtpInput } from './otp-input';
import { safeReturnTo } from './return-to';
import { pendingSignIn, sessionQuery, type PendingSignIn } from './session';

/** Matches the server's allowedAttempts: after this many wrong codes, a new code is needed. */
const MAX_TRIES = 3;
const RESEND_COOLDOWN_MS = 60_000;

type Problem = { message: string; needsNewCode: boolean };

/** Step 2: the 6-digit code from the email. */
export function CodeStep({ pending, returnTo }: { pending: PendingSignIn; returnTo?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [failures, setFailures] = useState(0);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [sentAt, setSentAt] = useState(pending.sentAt);
  const resendIn = useCountdown(sentAt + RESEND_COOLDOWN_MS);

  function explain(error: AuthClientError): Problem {
    if (error.code === 'INVALID_OTP') {
      const left = MAX_TRIES - (failures + 1);
      setFailures(failures + 1);
      return left > 0
        ? {
            message: `Code is incorrect (${left} ${left === 1 ? 'try' : 'tries'} left).`,
            needsNewCode: false,
          }
        : { message: 'Too many tries. Get a new code.', needsNewCode: true };
    }
    if (error.code === 'OTP_EXPIRED') return { message: 'Code expired.', needsNewCode: true };
    if (error.code === 'TOO_MANY_ATTEMPTS') {
      return { message: 'Too many tries. Get a new code.', needsNewCode: true };
    }
    return { message: signInErrorMessage(error), needsNewCode: false };
  }

  async function submit(value: string) {
    if (value.length !== CODE_LENGTH || submitting) return;
    setSubmitting(true);
    setProblem(null);
    setNotice(null);
    const result = await authClient.signIn.emailOtp({ email: pending.email, otp: value });
    if (result.error) {
      setSubmitting(false);
      setCode('');
      setProblem(explain(result.error));
      return;
    }
    pendingSignIn.clear();
    // The session cookie is set; re-read the session so the guards let the user in.
    await queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
    await router.navigate({ href: safeReturnTo(returnTo), replace: true });
  }

  async function resend() {
    setResending(true);
    setNotice(null);
    const result = await authClient.emailOtp.sendVerificationOtp({
      email: pending.email,
      type: 'sign-in',
    });
    setResending(false);
    if (result.error) {
      setProblem({ message: signInErrorMessage(result.error), needsNewCode: true });
      return;
    }
    pendingSignIn.set(pending.email);
    setSentAt(Date.now());
    setFailures(0);
    setProblem(null);
    setCode('');
    setNotice('We sent a new code.');
  }

  const locked = problem?.needsNewCode ?? false;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(code);
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Sign-in code</Label>
        <OtpInput
          id="code"
          value={code}
          autoFocus
          disabled={submitting || locked}
          invalid={problem !== null}
          aria-describedby="code-status"
          onChange={(value) => {
            setCode(value);
            if (value.length === CODE_LENGTH) void submit(value);
          }}
        />
      </div>
      <div id="code-status" aria-live="polite" className="min-h-5 text-sm">
        {problem && <p className="font-semibold text-destructive">{problem.message}</p>}
        {notice && !problem && <p className="text-muted-foreground">{notice}</p>}
      </div>
      {!locked && (
        <Button type="submit" size="lg" loading={submitting} disabled={code.length !== CODE_LENGTH}>
          Sign in
        </Button>
      )}
      <Button
        type="button"
        size="lg"
        variant={locked ? 'default' : 'secondary'}
        loading={resending}
        disabled={resendIn > 0}
        onClick={() => void resend()}
      >
        {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
      </Button>
      <p className="text-center text-sm">
        <Link
          to="/sign-in"
          search={{ returnTo }}
          className="inline-flex min-h-11 items-center font-bold text-primary underline-offset-4 hover:underline"
        >
          Use a different email
        </Link>
      </p>
    </form>
  );
}
