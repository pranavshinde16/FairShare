// A stand-in for an OpenAI-compatible provider (Groq, Cloudflare) in the end-to-end tests, so the
// server's real provider code runs against canned answers and nothing calls the internet. Answers
// are keyed by the sentence; any other sentence gets a 500, which exercises the fallback.

import { createServer, type Server } from 'node:http';

const me = { name: 'me', isMe: true };
const base = {
  currency: null,
  date: null,
  payer: { kind: 'me', name: null },
  people: [],
  includesEveryone: false,
  split: { method: 'equal', values: null },
  category: null,
  notes: null,
};

/** What the "model" answers for each sentence the tests type. */
export const ANSWERS: Record<string, unknown> = {
  'dinner ka 2400 maine diya, sab mein barabar': {
    ...base,
    amount: '2400',
    description: 'Dinner',
    includesEveryone: true,
  },
  'Priya ne cab ke 450 diye, sirf hum dono': {
    ...base,
    amount: '450',
    description: 'Cab',
    payer: { kind: 'person', name: 'Priya' },
    people: [me, { name: 'Priya', isMe: false }],
  },
  'Rahul ka 600 aur mera 400, lunch': {
    ...base,
    amount: null,
    description: 'Lunch',
    people: [{ name: 'Rahul', isMe: false }, me],
    split: {
      method: 'exact',
      values: [
        { name: 'Rahul', value: '600' },
        { name: 'me', value: '400' },
      ],
    },
  },
};

export function startLlmStub(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404).end();
        return;
      }
      const request = JSON.parse(body) as { messages: { content: string }[] };
      const sentence = /Message: """([\s\S]*)"""/.exec(request.messages[1]?.content ?? '')?.[1];
      const answer = sentence === undefined ? undefined : ANSWERS[sentence];
      if (answer === undefined) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'server_error' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(answer) } }],
          usage: { prompt_tokens: 512, completion_tokens: 64 },
        }),
      );
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
