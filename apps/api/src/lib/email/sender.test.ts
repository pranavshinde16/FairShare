import { describe, expect, it, vi } from 'vitest';
import {
  EmailError,
  createOutbox,
  parseAddress,
  scrubEmails,
  sendWithRetry,
  type EmailSender,
} from './sender';

const message = { to: 'asha@example.com', subject: 'Hi', text: 'Hi', html: '<p>Hi</p>' };

function failing(...errors: Error[]): EmailSender & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(() => {
    const error = errors.shift();
    return error ? Promise.reject(error) : Promise.resolve();
  });
  return { send };
}

describe('sendWithRetry', () => {
  it('sends once when the first attempt works', async () => {
    const sender = failing();
    await sendWithRetry(sender, message, { delayMs: 0 });
    expect(sender.send).toHaveBeenCalledOnce();
  });

  it('retries once after a retryable failure', async () => {
    const sender = failing(new EmailError('timeout', true));
    await sendWithRetry(sender, message, { delayMs: 0 });
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it('retries an unexpected error too, since it may be transient', async () => {
    const sender = failing(new TypeError('fetch failed'));
    await sendWithRetry(sender, message, { delayMs: 0 });
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second failure', async () => {
    const sender = failing(new EmailError('down', true), new EmailError('still down', true));
    await expect(sendWithRetry(sender, message, { delayMs: 0 })).rejects.toThrow('still down');
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it('does not retry a request the provider refused', async () => {
    const sender = failing(new EmailError('bad sender', false));
    await expect(sendWithRetry(sender, message, { delayMs: 0 })).rejects.toThrow('bad sender');
    expect(sender.send).toHaveBeenCalledOnce();
  });
});

describe('parseAddress', () => {
  it('splits a name and an address', () => {
    expect(parseAddress('FairShare <codes@fairshare.example>')).toEqual({
      name: 'FairShare',
      email: 'codes@fairshare.example',
    });
    expect(parseAddress('"Fair Share" <codes@fairshare.example>')).toEqual({
      name: 'Fair Share',
      email: 'codes@fairshare.example',
    });
  });

  it('accepts a bare address', () => {
    expect(parseAddress(' codes@fairshare.example ')).toEqual({ email: 'codes@fairshare.example' });
    expect(parseAddress('<codes@fairshare.example>')).toEqual({ email: 'codes@fairshare.example' });
  });
});

describe('scrubEmails', () => {
  it('replaces every address and keeps the rest of the text', () => {
    expect(
      scrubEmails(
        'You can only send testing emails to your own email address (owner@example.com).',
      ),
    ).toBe('You can only send testing emails to your own email address ([email]).');
    expect(scrubEmails('to: "a.b+c@x.io", d@y.co')).toBe('to: "[email]", [email]');
  });
});

describe('createOutbox', () => {
  it('collects what was sent', async () => {
    const outbox = createOutbox();
    await outbox.sender.send(message);
    expect(outbox.messages).toEqual([message]);
  });
});
