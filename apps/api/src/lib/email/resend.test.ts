import { describe, expect, it, vi } from 'vitest';
import { createResendSender } from './resend';
import { EmailError } from './sender';

const message = {
  to: 'asha@example.com',
  subject: 'Your code',
  text: 'Code: 123456',
  html: '<p>123456</p>',
  idempotencyKey: 'otp-1',
};

function resend(response: Response | Error) {
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  const sender = createResendSender({
    apiKey: 're_test_key',
    from: 'FairShare <codes@fairshare.example>',
    fetch,
  });
  return { sender, fetch };
}

describe('createResendSender', () => {
  it('posts the message to Resend with the key and an idempotency key', async () => {
    const { sender, fetch } = resend(Response.json({ id: 'email-id' }));

    await sender.send(message);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer re_test_key',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'otp-1',
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      from: 'FairShare <codes@fairshare.example>',
      to: ['asha@example.com'],
      subject: 'Your code',
      text: 'Code: 123456',
      html: '<p>123456</p>',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('marks rate limits and server errors as retryable, refusals as not', async () => {
    for (const [status, retryable] of [
      [429, true],
      [500, true],
      [503, true],
      [400, false],
      [403, false],
      [422, false],
    ] as const) {
      const { sender } = resend(new Response('{}', { status }));
      const error = await sender.send(message).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({
        retryable,
        message: expect.stringContaining(`${status}`) as string,
      });
    }
  });

  it('keeps the provider’s reason but not the addresses in it', async () => {
    const body = JSON.stringify({
      name: 'validation_error',
      message: 'You can only send testing emails to your own email address (owner@example.com).',
    });
    const { sender } = resend(new Response(body, { status: 403 }));

    const error = (await sender.send(message).catch((e: unknown) => e)) as EmailError;

    expect(error.message).toContain('validation_error');
    expect(error.message).toContain('[email]');
    expect(error.message).not.toContain('owner@example.com');
  });

  it('treats a network failure as retryable', async () => {
    const { sender } = resend(new TypeError('fetch failed'));
    await expect(sender.send(message)).rejects.toMatchObject({
      name: 'EmailError',
      retryable: true,
    });
  });
});
