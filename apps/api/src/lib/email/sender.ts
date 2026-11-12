// Email delivery behind one interface: Resend in production, Mailpit locally, an in-memory outbox
// in tests. The app sends only sign-in codes for now.

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Lets a provider drop a retried copy of a message it already accepted. */
  idempotencyKey?: string;
};

export type EmailSender = { send: (message: EmailMessage) => Promise<void> };

/** A failed send. `retryable` is false when trying again can't help (a rejected request). */
export class EmailError extends Error {
  override readonly name = 'EmailError';

  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** Sends, and on a retryable failure waits briefly and tries once more. */
export async function sendWithRetry(
  sender: EmailSender,
  message: EmailMessage,
  { delayMs = 500 }: { delayMs?: number } = {},
): Promise<void> {
  try {
    await sender.send(message);
  } catch (err) {
    if (err instanceof EmailError && !err.retryable) throw err;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await sender.send(message);
  }
}

/** Splits "FairShare <codes@fairshare.example>" into its name and address. */
export function parseAddress(value: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!match) return { email: value.trim() };
  const name = match[1]!.replace(/^"(.*)"$/, '$1');
  return name ? { name, email: match[2]!.trim() } : { email: match[2]!.trim() };
}

/** Replaces email addresses in provider error text, so recipients never reach the logs. */
export function scrubEmails(text: string): string {
  return text.replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, '[email]');
}

/** Collects messages instead of sending them. For tests. */
export function createOutbox() {
  const messages: EmailMessage[] = [];
  const sender: EmailSender = {
    send: (message) => {
      messages.push(message);
      return Promise.resolve();
    },
  };
  return { sender, messages };
}
