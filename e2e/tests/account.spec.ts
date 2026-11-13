import { Group } from '@fairshare/contracts';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { BASE_URL } from '../playwright.config';
import { expect, newEmail, signIn, test } from './fixtures';

async function createGroup(page: Page, name: string, members: string[]) {
  const res = await page.request.post('/api/v1/groups', {
    headers: { Origin: BASE_URL },
    data: { id: randomUUID(), name, currency: 'INR', members: members.map((n) => ({ name: n })) },
  });
  expect(res.status()).toBe(201);
  return Group.parse(await res.json());
}

test('deleting the account shows what’s unsettled, signs out, and the address starts afresh', async ({
  page,
}) => {
  const email = newEmail('dana');
  await page.goto('/');
  await signIn(page, email);
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible();
  const group = await createGroup(page, 'Flat', ['Rahul']);
  const [me, rahul] = group.members.map((m) => m.user.id);
  // Rahul paid ₹600 for both of us: I owe him ₹300.
  const res = await page.request.post(`/api/v1/groups/${group.id}/expenses`, {
    headers: { Origin: BASE_URL },
    data: {
      id: randomUUID(),
      description: 'Groceries',
      amount: 60_000,
      currency: 'INR',
      occurredOn: '2026-11-10',
      payers: [{ userId: rahul, amount: 60_000 }],
      split: { method: 'equal', participants: [me, rahul] },
    },
  });
  expect(res.status()).toBe(201);

  await page.goto('/settings');
  await page.getByRole('link', { name: 'Delete account' }).click();
  await expect(page.getByRole('heading', { name: 'Delete your account' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Balances not settled' }).getByRole('listitem'),
  ).toHaveText([/Rahul\s*you owe ₹300\.00/]);
  const remove = page.getByRole('button', { name: 'Delete my account' });
  await expect(remove).toBeDisabled();
  await page.getByLabel('I understand that my account is deleted for good.').check();
  await remove.click();

  await expect(page).toHaveURL(/\/sign-in/);
  await expect(
    page.getByText('Your account was deleted. Thanks for using FairShare.'),
  ).toBeVisible();
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);

  // The same address again: a new account, with nothing in it.
  await signIn(page, email);
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible();
  expect(await (await page.request.get('/api/v1/groups')).json()).toEqual({ items: [] });
});

test('the privacy notice and terms are open to anyone, and linked from sign-in', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'privacy notice' }).click();
  await expect(page.getByRole('heading', { name: 'Privacy notice', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your rights' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Legal' })
    .getByRole('link', { name: 'Terms of use' })
    .click();
  await expect(page.getByRole('heading', { name: 'Terms of use', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Back to FairShare' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});
