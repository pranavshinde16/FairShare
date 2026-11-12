import { Group } from '@fairshare/contracts';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { BASE_URL } from '../playwright.config';
import { expect, newEmail, signIn, test } from './fixtures';

/** Calls the API as the signed-in browser does (same cookies, the app's Origin). */
const api = (page: Page) => ({
  async createGroup(name: string, members: string[]) {
    const res = await page.request.post('/api/v1/groups', {
      headers: { Origin: BASE_URL },
      data: { id: randomUUID(), name, currency: 'INR', members: members.map((n) => ({ name: n })) },
    });
    expect(res.status()).toBe(201);
    return Group.parse(await res.json());
  },
  async expense(
    groupId: string,
    description: string,
    amount: number,
    payers: [string, number][],
    participants: string[],
  ) {
    const res = await page.request.post(`/api/v1/groups/${groupId}/expenses`, {
      headers: { Origin: BASE_URL },
      data: {
        id: randomUUID(),
        description,
        amount,
        currency: 'INR',
        occurredOn: '2026-11-10',
        payers: payers.map(([userId, paid]) => ({ userId, amount: paid })),
        split: { method: 'equal', participants },
      },
    });
    expect(res.status()).toBe(201);
  },
});

/** Signed in once Home shows; only then does the API see the session cookie. */
async function start(page: Page, name: string) {
  await page.goto('/');
  await signIn(page, newEmail(name));
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible();
}

test('the Goa example: balances, Home and the friend page agree', async ({ page }) => {
  await start(page, 'asha');
  // Blueprint 5.3, with Asha signed in and the others not joined yet.
  const group = await api(page).createGroup('Goa Trip', ['Bilal', 'Chitra', 'Dev']);
  const [asha, bilal, chitra, dev] = group.members.map((m) => m.user.id) as [
    string,
    string,
    string,
    string,
  ];
  const all = [asha, bilal, chitra, dev];
  await api(page).expense(group.id, 'Hotel', 400_000, [[asha, 400_000]], all);
  await api(page).expense(group.id, 'Dinner', 120_000, [[bilal, 120_000]], [asha, bilal, chitra]);
  await api(page).expense(
    group.id,
    'Fuel',
    300_000,
    [
      [chitra, 200_000],
      [dev, 100_000],
    ],
    all,
  );

  await page.goto(`/groups/${group.id}`);
  await expect(page.getByRole('link', { name: /you’re owed ₹1,850.00/ })).toBeVisible();
  await page.getByRole('link', { name: /^balances$/i }).click();

  await expect(page.getByText('You’re owed ₹1,850.00', { exact: true })).toBeVisible();
  // Blueprint 5.4: three payments, all to Asha.
  const payments = page.getByRole('region', { name: 'Suggested payments' });
  await expect(payments.getByRole('listitem')).toHaveText([
    /Bilal pays you\s*₹950.00/,
    /Dev pays you\s*₹750.00/,
    /Chitra pays you\s*₹150.00/,
  ]);
  // Anyone can check a number: Bilal paid ₹1,200 and his share is ₹2,150, so he owes ₹950.
  const everyone = page.getByRole('region', { name: 'Everyone’s balance' });
  const bilalRow = everyone.getByRole('listitem').filter({ hasText: 'Bilal' });
  await expect(bilalRow).toContainText('owes ₹950.00');
  await bilalRow.locator('summary').click();
  await expect(bilalRow.getByRole('definition')).toHaveText(['₹1,200.00', '₹2,150.00']);

  await page.getByRole('link', { name: 'FairShare home' }).first().click();
  await expect(page.getByText('You’re owed ₹1,850.00', { exact: true })).toBeVisible();
  const people = page.getByRole('main').getByRole('region', { name: 'People' });
  await expect(people.getByRole('link', { name: /Bilal/ })).toContainText('owes you ₹950.00');
  await expect(people.getByRole('link', { name: /Dev/ })).toContainText('owes you ₹750.00');

  await people.getByRole('link', { name: /Bilal/ }).click();
  await expect(page.getByRole('heading', { name: 'Bilal', exact: true })).toBeVisible();
  await expect(page.getByText('Bilal owes you ₹950.00', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'By group' }).getByRole('link', { name: /Goa Trip/ }),
  ).toContainText('owes you ₹950.00');
});

test('adds an expense from Home, and the balances follow without a reload', async ({ page }) => {
  await start(page, 'esha');
  const group = await api(page).createGroup('Flat', ['Farah']);
  await page.reload();

  await page.getByRole('button', { name: 'Add expense' }).click();
  const picker = page.getByRole('dialog', { name: 'Add expense' });
  await picker.getByRole('button', { name: /Flat/ }).click();

  const form = page.getByRole('dialog', { name: 'Add expense' });
  await form.getByLabel('Amount').fill('900');
  await form.getByLabel('Description').fill('Groceries');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/groups/${group.id}`));
  await expect(page.getByRole('link', { name: /you’re owed ₹450.00/ })).toBeVisible();

  await page.getByRole('link', { name: 'FairShare home' }).first().click();
  await expect(page.getByText('You’re owed ₹450.00', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('main')
      .getByRole('region', { name: 'People' })
      .getByRole('link', { name: /Farah/ }),
  ).toContainText('owes you ₹450.00');
});

test('adds an expense with a friend from their page', async ({ page }) => {
  await start(page, 'gita');

  await page.getByRole('button', { name: 'Add a friend' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add a friend' });
  await dialog.getByLabel('Name').fill('Hari');
  await dialog.getByRole('button', { name: 'Add friend' }).click();
  await expect(page.getByRole('heading', { name: 'Hari', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add expense' }).click();
  const form = page.getByRole('dialog', { name: 'Add expense' });
  await form.getByLabel('Amount').fill('300');
  await form.getByLabel('Description').fill('Movie');
  // A friendship takes my default currency, which follows the browser's locale (USD here).
  await expect(form.getByRole('button', { name: /Split equally between all 2/ })).toContainText(
    '$150.00 each',
  );
  await form.getByRole('button', { name: 'Save' }).click();

  // Back on Hari's page, with the expense and the new balance.
  await expect(form).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Hari', exact: true })).toBeVisible();
  await expect(page.getByText('Hari owes you $150.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Movie/ })).toContainText('you lent $150.00');
});
