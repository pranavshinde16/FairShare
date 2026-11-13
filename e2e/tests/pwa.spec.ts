import { Group } from '@fairshare/contracts';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { BASE_URL } from '../playwright.config';
import { expect, newEmail, signIn, test } from './fixtures';

async function start(page: Page, name: string) {
  await page.goto('/');
  await signIn(page, newEmail(name));
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible();
}

// Offline, requests to the API fail, and the browser says so.
test.use({ expectedConsoleErrors: [/^TypeError: Failed to fetch/] });

const offlineBanner = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'You’re offline' });

test('installable: a manifest with its icons, and a service worker that opens the app offline', async ({
  page,
  context,
}) => {
  await start(page, 'ira');

  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.headers()['content-type']).toContain('application/manifest+json');
  const body = (await manifest.json()) as { icons: { src: string; purpose: string }[] };
  expect(body).toMatchObject({ name: 'FairShare', display: 'standalone', start_url: '/' });
  expect(body.icons.map((i) => i.purpose).sort()).toEqual(['any', 'any', 'maskable']);
  for (const icon of body.icons) {
    const res = await page.request.get(icon.src);
    expect(res.headers()['content-type'], icon.src).toBe('image/png');
  }
  // The service worker file itself is always revalidated, so a deploy is noticed.
  expect((await page.request.get('/sw.js')).headers()['cache-control']).toBe('no-cache');

  // Installed on the first visit; it controls the page from the next load.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // Offline, the app still opens from the cache, and says it's offline.
  await context.setOffline(true);
  await page.goto('/activity');
  await expect(offlineBanner(page)).toBeVisible();
  await context.setOffline(false);
  await expect(offlineBanner(page)).toBeHidden();
});

test('offline, Save is off until the connection is back', async ({ page, context }) => {
  await start(page, 'jai');
  const res = await page.request.post('/api/v1/groups', {
    headers: { Origin: BASE_URL },
    data: { id: randomUUID(), name: 'Trip', currency: 'INR', members: [{ name: 'Kabir' }] },
  });
  const group = Group.parse(await res.json());
  await page.goto(`/groups/${group.id}`);
  await page.getByRole('button', { name: 'Add expense' }).first().click();
  const form = page.getByRole('dialog', { name: 'Add expense' });
  await form.getByLabel('Amount').fill('500');
  await form.getByLabel('Description').fill('Taxi');
  const save = form.getByRole('button', { name: 'Save' });
  await expect(save).toBeEnabled();

  await context.setOffline(true);
  await expect(offlineBanner(page)).toBeVisible();
  await expect(save).toBeDisabled();
  // Ctrl+Enter doesn't get around it either.
  await form.getByLabel('Description').press('Control+Enter');
  await expect(form).toBeVisible();

  await context.setOffline(false);
  await expect(offlineBanner(page)).toBeHidden();
  await save.click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('link', { name: /Taxi/ })).toBeVisible();
});
