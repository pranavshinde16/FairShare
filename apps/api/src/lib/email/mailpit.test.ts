import { describe, expect, it, vi } from 'vitest';
import { createMailpitSender } from './mailpit';

describe('createMailpitSender', () => {
  it('posts the message to Mailpit’s send API', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ ID: 'x' }));
    const sender = createMailpitSender({
      url: 'http://localhost:8025',
      from: 'FairShare <codes@fairshare.local>',
      fetch,
    });

    await sender.send({ to: 'asha@example.com', subject: 'S', text: 'T', html: '<p>H</p>' });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toEqual(new URL('http://localhost:8025/api/v1/send'));
    expect(JSON.parse(init?.body as string)).toEqual({
      From: { Email: 'codes@fairshare.local', Name: 'FairShare' },
      To: [{ Email: 'asha@example.com' }],
      Subject: 'S',
      Text: 'T',
      HTML: '<p>H</p>',
    });
  });

  it('fails with a clear message when Mailpit is not running', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const sender = createMailpitSender({ url: 'http://localhost:8025', from: 'x@y.z', fetch });

    await expect(sender.send({ to: 'a@b.c', subject: 'S', text: 'T', html: 'H' })).rejects.toThrow(
      'Mailpit could not be reached at http://localhost:8025',
    );
  });
});
