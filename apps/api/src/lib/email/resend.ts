import { EmailError, scrubEmails, type EmailSender } from './sender';

const RESEND_URL = 'https://api.resend.com/emails';

export type ResendOptions = {
  apiKey: string;
  /** The sender, e.g. "FairShare <codes@fairshare.example>", on a domain verified in Resend. */
  from: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** Sends through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export function createResendSender({
  apiKey,
  from,
  fetch = globalThis.fetch,
  timeoutMs = 10_000,
}: ResendOptions): EmailSender {
  return {
    async send(message) {
      let res: Response;
      try {
        res = await fetch(RESEND_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(message.idempotencyKey && { 'Idempotency-Key': message.idempotencyKey }),
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw new EmailError('Resend could not be reached', true, { cause });
      }
      if (res.ok) return;
      const detail = scrubEmails((await res.text().catch(() => '')).slice(0, 300));
      // 429 (rate limit) and 5xx are worth one retry; anything else is a request Resend refuses.
      throw new EmailError(
        `Resend answered ${res.status}: ${detail}`,
        res.status === 429 || res.status >= 500,
      );
    },
  };
}
