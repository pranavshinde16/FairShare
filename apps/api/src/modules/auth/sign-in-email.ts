import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { ErrorReporter } from '../../http/error-handler';
import { currentRequest } from '../../http/request-context';
import { sendWithRetry, type EmailSender } from '../../lib/email/sender';

/** How long a sign-in code is valid. Also what the email says. */
export const CODE_TTL_MINUTES = 5;

/** The email that carries a sign-in code. The code is digits only, so nothing needs escaping. */
export function signInCodeEmail(code: string) {
  const subject = `${code} is your FairShare sign-in code`;
  const text = [
    `Your FairShare sign-in code is ${code}.`,
    '',
    `It expires in ${CODE_TTL_MINUTES} minutes and works once.`,
    '',
    "If you didn't ask for it, ignore this email. Nobody can sign in without the code.",
  ].join('\n');
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#111827">
    <p style="margin:0 0 16px">Your FairShare sign-in code is</p>
    <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px">${code}</p>
    <p style="margin:0 0 16px">It expires in ${CODE_TTL_MINUTES} minutes and works once.</p>
    <p style="margin:0;color:#6b7280">If you didn't ask for it, ignore this email. Nobody can sign in without the code.</p>
  </body>
</html>`;
  return { subject, text, html };
}

export type SignInCodeSenderDeps = {
  sender: EmailSender;
  logger: Logger;
  reportError: ErrorReporter;
};

/**
 * Sends a code inside the request, with one retry. Better Auth swallows a failure here and answers
 * "sent" either way, so a failure is logged and reported for us to see; the person can ask for a
 * new code after the cooldown.
 */
export function createSignInCodeSender({ sender, logger, reportError }: SignInCodeSenderDeps) {
  return async (email: string, code: string): Promise<void> => {
    try {
      await sendWithRetry(sender, {
        to: email,
        ...signInCodeEmail(code),
        idempotencyKey: `sign-in-code/${randomUUID()}`,
      });
    } catch (err) {
      const request = currentRequest();
      (request?.log ?? logger).error({ err }, 'sign-in code email failed');
      reportError(err, { requestId: request?.requestId });
    }
  };
}
