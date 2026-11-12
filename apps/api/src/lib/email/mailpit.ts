import { EmailError, parseAddress, type EmailSender } from './sender';

export type MailpitOptions = {
  /** Mailpit's web address, e.g. http://localhost:8025 (docker-compose.yml). */
  url: string;
  from: string;
  fetch?: typeof fetch;
};

/** Delivers to the local Mailpit inbox through its send API, for development and end-to-end tests. */
export function createMailpitSender({
  url,
  from,
  fetch = globalThis.fetch,
}: MailpitOptions): EmailSender {
  const sender = parseAddress(from);
  return {
    async send(message) {
      let res: Response;
      try {
        res = await fetch(new URL('/api/v1/send', url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            From: { Email: sender.email, Name: sender.name ?? '' },
            To: [{ Email: message.to }],
            Subject: message.subject,
            Text: message.text,
            HTML: message.html,
          }),
        });
      } catch (cause) {
        throw new EmailError(`Mailpit could not be reached at ${url}`, true, { cause });
      }
      if (!res.ok) throw new EmailError(`Mailpit answered ${res.status}`, res.status >= 500);
    },
  };
}
