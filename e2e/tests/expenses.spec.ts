import { Group, Transaction } from '@fairshare/contracts';
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
  async transaction(id: string) {
    return Transaction.parse(await (await page.request.get(`/api/v1/transactions/${id}`)).json());
  },
  async rename(id: string, version: number, body: Record<string, unknown>) {
    const res = await page.request.put(`/api/v1/transactions/${id}`, {
      headers: { Origin: BASE_URL, 'If-Match': `"${version}"` },
      data: body,
    });
    expect(res.status()).toBe(200);
  },
});

async function addExpense(page: Page, amount: string, description: string) {
  await page.getByRole('button', { name: 'Add expense' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add expense' });
  await dialog.getByLabel('Amount').fill(amount);
  await dialog.getByLabel('Description').fill(description);
  return dialog;
}

test('adds, opens, edits, deletes and restores an expense', async ({ page }) => {
  await page.goto('/');
  await signIn(page, newEmail('asha'));
  // Signed in once Home shows; only then does the API see the session cookie.
  await expect(page.getByRole('heading', { level: 1, name: /^(Groups|Home)$/ })).toBeVisible();
  const group = await api(page).createGroup('Goa Trip', ['Bilal']);
  await page.goto(`/groups/${group.id}`);

  const dialog = await addExpense(page, '1200', 'Dinner');
  await expect(dialog.getByRole('region', { name: 'Each person’s share' })).toContainText(
    '₹600.00 / person',
  );
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Added ‘Dinner’ · ₹1,200.00')).toBeVisible();
  const row = page.getByRole('link', { name: /Dinner/ });
  await expect(row).toContainText('You paid ₹1,200.00');
  await expect(row).toContainText('you lent ₹600.00');

  await row.click();
  await expect(page.getByRole('heading', { name: 'Dinner' })).toBeVisible();
  await expect(page.getByText('You lent ₹600.00')).toBeVisible();
  await expect(page.getByText('Asha added it')).toBeVisible();

  await page.getByRole('link', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit expense' });
  await edit.getByLabel('Amount').fill('1500');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();
  await expect(page.locator('header').getByText('₹1,500.00', { exact: true })).toBeVisible();
  // The history lists each change on its own line (DESIGN_SPEC §6.3).
  await expect(page.getByText('Asha changed it')).toBeVisible();
  await expect(page.getByText('Amount ₹1,200.00 → ₹1,500.00')).toBeVisible();

  await page.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete ‘Dinner’?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/groups/${group.id}`));
  await expect(page.getByRole('heading', { name: 'No expenses yet' })).toBeVisible();
  // The "Added" toast may still be up; undo the deletion, not the adding.
  await page
    .getByRole('status')
    .locator('div', { hasText: 'Deleted ‘Dinner’' })
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(page.getByRole('link', { name: /Dinner/ })).toBeVisible();
});

test('undoes an expense straight after adding it', async ({ page }) => {
  await page.goto('/');
  await signIn(page, newEmail('bilal'));
  // Signed in once Home shows; only then does the API see the session cookie.
  await expect(page.getByRole('heading', { level: 1, name: /^(Groups|Home)$/ })).toBeVisible();
  const group = await api(page).createGroup('Flat', ['Chitra']);
  await page.goto(`/groups/${group.id}`);

  const dialog = await addExpense(page, '300', 'Milk');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();

  await expect(page.getByText('Removed ‘Milk’')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No expenses yet' })).toBeVisible();
});

test('shows a conflict when someone else saved first, and reloads their version', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page, newEmail('chitra'));
  // Signed in once Home shows; only then does the API see the session cookie.
  await expect(page.getByRole('heading', { level: 1, name: /^(Groups|Home)$/ })).toBeVisible();
  const group = await api(page).createGroup('Trip', ['Dev']);
  await page.goto(`/groups/${group.id}`);
  const dialog = await addExpense(page, '800', 'Taxi');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('link', { name: /Taxi/ }).click();
  const id = page.url().split('/').pop()!;

  await page.getByRole('link', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit expense' });
  await edit.getByLabel('Description').fill('Taxi to the airport');
  // Meanwhile, someone else changes it.
  const current = await api(page).transaction(id);
  if (current.type !== 'expense') throw new Error('expected an expense');
  await api(page).rename(id, current.version, {
    description: 'Cab',
    amount: current.amount,
    currency: current.currency,
    occurredOn: current.occurredOn,
    payers: current.payers,
    split: current.splitInput,
  });
  await edit.getByRole('button', { name: 'Save changes' }).click();

  const conflict = page.getByRole('dialog', { name: 'Someone changed this expense' });
  await expect(conflict).toBeVisible();
  await conflict.getByRole('button', { name: 'Reload' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Edit expense' }).getByLabel('Description'),
  ).toHaveValue('Cab');
});

test('closes the add-expense form without saving, with ✕ or the Back button', async ({ page }) => {
  await page.goto('/');
  await signIn(page, newEmail('dev'));
  await expect(page.getByRole('heading', { level: 1, name: /^(Groups|Home)$/ })).toBeVisible();
  const group = await api(page).createGroup('Weekend', ['Esha']);
  await page.goto(`/groups/${group.id}`);

  await addExpense(page, '500', 'Snacks');
  await page
    .getByRole('dialog', { name: 'Add expense' })
    .getByRole('button', { name: 'Close' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Add expense' })).toBeHidden();

  await addExpense(page, '500', 'Snacks');
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Add expense' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'No expenses yet' })).toBeVisible();
});
