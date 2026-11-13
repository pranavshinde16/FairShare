import { Group, Transaction } from '@fairshare/contracts';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { BASE_URL } from '../playwright.config';
import { expect, newEmail, signIn, test } from './fixtures';

async function start(page: Page, name: string) {
  await page.goto('/');
  await signIn(page, newEmail(name));
  await expect(page.getByRole('heading', { level: 1, name: /^(Groups|Home)$/ })).toBeVisible();
}

async function createGroup(page: Page, name: string, members: string[]) {
  const res = await page.request.post('/api/v1/groups', {
    headers: { Origin: BASE_URL },
    data: { id: randomUUID(), name, currency: 'INR', members: members.map((n) => ({ name: n })) },
  });
  expect(res.status()).toBe(201);
  return Group.parse(await res.json());
}

async function openAddExpense(page: Page, groupId: string) {
  await page.goto(`/groups/${groupId}`);
  await page.getByRole('button', { name: 'Add expense' }).first().click();
  return page.getByRole('dialog', { name: 'Add expense' });
}

test('a simple sentence fills the form and saves (Blueprint 10.5 "AI entry")', async ({ page }) => {
  await start(page, 'asha');
  const group = await createGroup(page, 'Goa Trip', ['Rahul', 'Amit', 'Chitra']);
  const [asha, rahul, amit] = group.members.map((m) => m.user.id);
  const form = await openAddExpense(page, group.id);

  await form.getByLabel('Type it').fill('I paid 2400 for dinner with Rahul and Amit');
  await form.getByLabel('Type it').press('Enter');
  await expect(form.getByLabel('Amount')).toHaveValue('2,400.00');
  await expect(form.getByLabel('Description')).toHaveValue('Dinner');
  await expect(form.getByRole('button', { name: /^Paid by/ })).toContainText(
    'Paid by you and split equally',
  );
  await expect(form.getByRole('region', { name: 'Each person’s share' })).toContainText(
    '3 of 4 people',
  );
  await expect(form.getByRole('region', { name: 'Each person’s share' })).toContainText(
    '₹800.00 / person',
  );
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();

  await page.getByRole('link', { name: /Dinner/ }).click();
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const tx = Transaction.parse(await (await page.request.get(`/api/v1/transactions/${id}`)).json());
  expect(tx.type === 'expense' && tx.splitInput).toEqual({
    method: 'equal',
    participants: expect.arrayContaining([asha, rahul, amit]) as unknown,
  });
  expect(tx.shares.map((s) => s.amount)).toEqual([80_000, 80_000, 80_000]);
});

test('asks which Rahul, and adds someone who isn’t in the group', async ({ page }) => {
  await start(page, 'esha');
  const group = await createGroup(page, 'Flat', ['Rahul Sharma', 'Rahul Kumar']);
  const form = await openAddExpense(page, group.id);

  await form.getByLabel('Type it').fill('taxi 900 with Rahul and Zara');
  await form.getByRole('button', { name: 'Fill' }).click();
  await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();
  await form
    .getByRole('group', { name: 'Which Rahul?' })
    .getByRole('button', { name: 'Rahul Kumar' })
    .click();
  const zara = form.getByRole('group', { name: 'Zara isn’t in the group' });
  await expect(zara).toContainText('Zara isn’t in Flat.');
  await zara.getByRole('button', { name: 'Add as new member' }).click();
  await expect(zara).toBeHidden();
  await expect(form.getByRole('region', { name: 'Each person’s share' })).toContainText(
    '3 of 4 people',
  );
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();

  // Zara is a member now (not joined yet), and in the expense.
  await page.getByRole('link', { name: /^members$/i }).click();
  await expect(page.getByRole('main').getByText('Zara', { exact: true })).toBeVisible();
});

test('typed on Home, it goes to the group the names belong to', async ({ page }) => {
  await start(page, 'gita');
  await createGroup(page, 'Goa Trip', ['Bilal', 'Chitra']);
  const flat = await createGroup(page, 'Flat', ['Farah']);
  await page.reload();

  await page.getByLabel('Type an expense').fill('groceries 900 with Farah yesterday');
  await page.getByLabel('Type an expense').press('Enter');

  await expect(page).toHaveURL(new RegExp(`/groups/${flat.id}/expenses/new`));
  const form = page.getByRole('dialog', { name: 'Add expense' });
  await expect(form.getByLabel('Type it')).toHaveValue('groceries 900 with Farah yesterday');
  await expect(form.getByLabel('Description')).toHaveValue('Groceries');
  await expect(form.getByRole('button', { name: 'Yesterday' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
  // The group page's own balance line (the desktop sidebar's group row says it too).
  await expect(
    page.getByRole('main').getByRole('link', { name: /you’re owed ₹450.00/i }),
  ).toBeVisible();
});
