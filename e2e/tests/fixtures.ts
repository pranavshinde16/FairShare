import { test as base, expect, type Page } from '@playwright/test';
import { randomInt, randomUUID } from 'node:crypto';

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

type MailpitSearch = { messages: { ID: string }[] };
type MailpitMessage = { Text: string };

/** The newest message Mailpit has for `email`, if any: pass it to readCode to wait for a newer one. */
export async function latestMessageId(email: string): Promise<string | undefined> {
  const query = encodeURIComponent(`to:"${email}"`);
  const search = (await (
    await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=1`)
  ).json()) as MailpitSearch;
  return search.messages[0]?.ID;
}

/**
 * Polls Mailpit for the newest sign-in code sent to `email`. With `after`, a message ID, only a
 * newer message counts (a second sign-in with the same address).
 */
export async function readCode(email: string, after?: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const id = await latestMessageId(email);
    if (id && id !== after) {
      const message = (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)
      ).json()) as MailpitMessage;
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No sign-in code reached Mailpit for ${email}`);
}

/** A fresh address per test, so tests never see each other's codes. */
export const newEmail = (name: string) => `${name}+${randomUUID().slice(0, 8)}@example.com`;

/** Signs in through the UI, starting from wherever the page already is. */
export async function signIn(page: Page, email: string) {
  const before = await latestMessageId(email);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.getByLabel('Sign-in code').fill(await readCode(email, before));
}

/**
 * Guards a page: a distinct client IP (as Railway's proxy would send) so Better Auth's per-IP limits
 * count each test separately, and a list of console errors the test asserts is empty.
 */
export async function guard(page: Page): Promise<string[]> {
  // Random over 16 million addresses: with only 254, two of ~30 tests often shared an IP, and
  // with it Better Auth's limit of 3 sign-in attempts a minute.
  const octet = () => randomInt(0, 256);
  await page.setExtraHTTPHeaders({ 'X-Real-IP': `10.${octet()}.${octet()}.${octet()}` });
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  // Every CSP violation as its own error, not only the ones the browser logs (Blueprint 9.1: the
  // CSP is verified by end-to-end runs without violations).
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(
        `CSP violation: ${event.effectiveDirective} blocked ${event.blockedURI} (${event.sourceFile}:${event.lineNumber}:${event.columnNumber})`,
      );
    });
  });
  return errors;
}

export const test = base.extend<{ expectedConsoleErrors: RegExp[] }>({
  /** Console errors a test causes on purpose (requests failing while offline). Nothing else. */
  expectedConsoleErrors: [[], { option: true }],
  page: async ({ page, expectedConsoleErrors }, use) => {
    // A distinct client IP per test, as Railway's proxy would send, so Better Auth's per-IP
    // limits (3 codes a minute) count each test separately.
    // Any console error fails the test: a CSP violation, a crash, a React warning. The browser's
    // own note for an expected 4xx answer (a wrong code) is not an app error.
    const errors = await guard(page);
    await use(page);
    const unexpected = errors.filter((e) => !expectedConsoleErrors.some((re) => re.test(e)));
    expect(unexpected, 'console errors').toEqual([]);
  },
});

export { expect };
