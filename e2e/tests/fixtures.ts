import { test as base, expect, type Page } from '@playwright/test';
import { randomInt, randomUUID } from 'node:crypto';

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

type MailpitSearch = { messages: { ID: string }[] };
type MailpitMessage = { Text: string };

/** Polls Mailpit for the newest sign-in code sent to `email`. */
export async function readCode(email: string): Promise<string> {
  const query = encodeURIComponent(`to:"${email}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = (await (
      await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=1`)
    ).json()) as MailpitSearch;
    const id = search.messages[0]?.ID;
    if (id) {
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
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.getByLabel('Sign-in code').fill(await readCode(email));
}

/**
 * Guards a page: a distinct client IP (as Railway's proxy would send) so Better Auth's per-IP limits
 * count each test separately, and a list of console errors the test asserts is empty.
 */
export async function guard(page: Page): Promise<string[]> {
  await page.setExtraHTTPHeaders({ 'X-Real-IP': `198.51.100.${randomInt(1, 255)}` });
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

export const test = base.extend({
  page: async ({ page }, use) => {
    // A distinct client IP per test, as Railway's proxy would send, so Better Auth's per-IP
    // limits (3 codes a minute) count each test separately.
    // Any console error fails the test: a CSP violation, a crash, a React warning. The browser's
    // own note for an expected 4xx answer (a wrong code) is not an app error.
    const errors = await guard(page);
    await use(page);
    expect(errors, 'console errors').toEqual([]);
  },
});

export { expect };
