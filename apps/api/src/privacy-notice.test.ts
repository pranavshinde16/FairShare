// The privacy notice describes what the code does (apps/web/src/routes/privacy.tsx): these checks
// fail when the two drift apart on typed entry.

import { AI_INPUT_RETENTION_DAYS } from '@fairshare/db';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadEnv } from './config/env';
import { parseExpenseUserMessage } from './modules/ai/prompts/parse-expense.v1';

const notice = readFileSync(
  fileURLToPath(new URL('../../web/src/routes/privacy.tsx', import.meta.url)),
  'utf8',
).replace(/\s+/g, ' ');
const typedEntry = notice.slice(
  notice.indexOf('<h2>Typed expenses</h2>'),
  notice.indexOf('<h2>How long'),
);

describe('the privacy notice on typed entry', () => {
  it('states the retention the nightly maintenance applies', () => {
    expect(typedEntry).toContain(`keeps the sentence for ${AI_INPUT_RETENTION_DAYS} days`);
  });

  it('names the providers the configuration defaults to', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://x@localhost/x',
      AUTH_SECRET: 'a-test-secret-that-is-at-least-32-chars',
      MAILPIT_URL: 'http://localhost:8025',
    });
    expect(env.AI_PRIMARY_PROVIDER).toBe('groq');
    expect(env.AI_FALLBACK_PROVIDER).toBe('cloudflare');
    expect(typedEntry).toContain('Groq');
    expect(typedEntry).toContain('Cloudflare Workers AI');
  });

  it('lists exactly what the prompt sends besides the sentence', () => {
    const message = parseExpenseUserMessage({
      text: 'SENTENCE',
      today: 'TODAY',
      currency: 'CURRENCY',
      myName: 'NAME',
    });
    expect(message.split('\n').map((line) => line.split(':')[0])).toEqual([
      'Today',
      'Group currency',
      'Writer',
      'Message',
    ]);
    expect(typedEntry).toContain('today’s date, the group’s currency and your name');
  });

  it('says account deletion forgets the sentences', () => {
    expect(notice).toContain('sentences you typed for an AI service to read are deleted at once');
  });
});
