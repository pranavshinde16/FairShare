import { Group, Transaction } from '@fairshare/contracts';
import type { Locator, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { BASE_URL } from '../playwright.config';
import { expect, newEmail, signIn, test } from './fixtures';

async function start(page: Page, name: string) {
  await page.goto('/');
  await signIn(page, newEmail(name));
  await expect(page.getByRole('heading', { level: 1, name: /^(Groups|Home)$/ })).toBeVisible();
}

async function createGroup(page: Page, members: string[]) {
  const res = await page.request.post('/api/v1/groups', {
    headers: { Origin: BASE_URL },
    data: {
      id: randomUUID(),
      name: 'Goa Trip',
      currency: 'INR',
      members: members.map((n) => ({ name: n })),
    },
  });
  expect(res.status()).toBe(201);
  return Group.parse(await res.json());
}

/** Opens Add expense in the group and fills amount and description. */
async function addExpense(page: Page, groupId: string, amount: string, description: string) {
  await page.goto(`/groups/${groupId}`);
  await page.getByRole('button', { name: 'Add expense' }).first().click();
  const form = page.getByRole('dialog', { name: 'Add expense' });
  await form.getByLabel('Amount').fill(amount);
  await form.getByLabel('Description').fill(description);
  await form.getByRole('button', { name: /^Paid by/ }).click();
  return form;
}

/** Phones show the split editor full-screen; Done goes back to the form (desktop shows both). */
async function backToForm(form: Locator) {
  const done = form.getByRole('button', { name: 'Done' });
  if (await done.isVisible()) await done.click();
}

/** The saved expense, read back from the API by the ID in the page's address. */
async function saved(page: Page): Promise<Transaction> {
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const res = await page.request.get(`/api/v1/transactions/${id}`);
  return Transaction.parse(await res.json());
}

const amountIn = (row: Locator) => row.locator('span.tabular-nums').last();

test('a percent split: preview, save, the expense page, and edit reopen as entered', async ({
  page,
}) => {
  await start(page, 'asha');
  const group = await createGroup(page, ['Bilal', 'Chitra']);
  const form = await addExpense(page, group.id, '1000', 'Hotel');

  await form.getByRole('button', { name: 'Percentages', exact: true }).click();
  // It starts from the equal split: 33.33 / 33.33 / 33.34 in some order.
  await expect(form.getByRole('status')).toHaveText('All assigned · 100%');
  for (const [name, pct] of [
    ['Asha (you)', '50'],
    ['Bilal', '30'],
    ['Chitra', '15'],
  ]) {
    await form.getByLabel(`${name}’s percentage`).fill(pct!);
  }
  await expect(form.getByRole('status')).toHaveText('5% left to assign');
  await backToForm(form);
  await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();
  await form.getByRole('button', { name: /^Paid by/ }).click();
  await form.getByLabel('Fill remainder').selectOption({ label: 'Chitra' });
  await expect(form.getByLabel('Chitra’s percentage')).toHaveValue('20');
  await expect(form.getByText('₹500.00', { exact: true })).toBeVisible();
  await backToForm(form);
  await expect(form.getByRole('button', { name: /^Paid by/ })).toContainText(
    'split by percentages',
  );
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();

  await page.getByRole('link', { name: /Hotel/ }).click();
  await expect(page.getByRole('heading', { name: 'Split by percentages' })).toBeVisible();
  const split = page.getByRole('region', { name: 'Split by percentages' });
  await expect(split.getByRole('listitem').filter({ hasText: 'Bilal' })).toContainText(
    '30% · ₹300.00',
  );
  await expect(split.getByRole('listitem').filter({ hasText: 'Chitra' })).toContainText(
    '20% · ₹200.00',
  );
  const tx = await saved(page);
  expect(tx.type === 'expense' && tx.splitInput).toEqual({
    method: 'percent',
    basisPoints: expect.arrayContaining([
      { userId: group.members[0]!.user.id, bp: 5000 },
      { userId: group.members[1]!.user.id, bp: 3000 },
      { userId: group.members[2]!.user.id, bp: 2000 },
    ]) as unknown,
  });

  await page.getByRole('link', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit expense' });
  await expect(edit.getByRole('button', { name: 'Percentages', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(edit.getByLabel('Asha (you)’s percentage')).toHaveValue('50');
  await expect(edit.getByLabel('Bilal’s percentage')).toHaveValue('30');
  await expect(edit.getByLabel('Chitra’s percentage')).toHaveValue('20');
  // Saving it unchanged changes nothing.
  await backToForm(edit);
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();
  expect((await saved(page)).version).toBe(1);
});

test('two people paid: “Split payment equally”, and the balances follow', async ({ page }) => {
  await start(page, 'esha');
  const group = await createGroup(page, ['Farah', 'Gopal']);
  const form = await addExpense(page, group.id, '3000', 'Fuel');

  await form.getByRole('button', { name: 'Several people paid' }).click();
  await form.getByRole('checkbox', { name: 'Farah paid' }).check();
  const paidBy = form.getByRole('group', { name: 'Paid by' });
  await expect(paidBy.getByRole('status')).toHaveText('All paid');
  await form.getByLabel('What Esha (you) paid').fill('2000');
  await expect(paidBy.getByRole('status')).toHaveText('₹1,000.00 left to assign');
  await expect(form.getByText('₹1,000.00 of what was paid is still to assign.')).toBeVisible();
  await form.getByRole('button', { name: 'Split payment equally' }).click();
  await expect(form.getByLabel('What Esha (you) paid')).toHaveValue('1500.00');
  await expect(form.getByLabel('What Farah paid')).toHaveValue('1500.00');
  await form.getByLabel('What Esha (you) paid').fill('2000');
  await form.getByLabel('What Farah paid').fill('1000');
  await backToForm(form);
  await expect(form.getByRole('button', { name: /^Paid by/ })).toContainText('Paid by 2 people');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();

  // ₹1,000 each: Esha paid 2,000 (+1,000), Farah 1,000 (0), Gopal nothing (−1,000).
  // The group page's own balance line (the desktop sidebar's group row says it too).
  await expect(
    page.getByRole('main').getByRole('link', { name: /you’re owed ₹1,000.00/i }),
  ).toBeVisible();
  await page.getByRole('link', { name: /Fuel/ }).click();
  const payers = page.getByRole('region', { name: 'Paid by' }).getByRole('listitem');
  await expect(payers).toHaveCount(2);
  await expect(payers.filter({ hasText: 'Farah' })).toContainText('₹1,000.00');
  await expect(payers.filter({ hasText: 'You' })).toContainText('₹2,000.00');

  // It reopens with both payers.
  await page.getByRole('link', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit expense' });
  await expect(edit.getByLabel('What Farah paid')).toHaveValue('1000.00');
  await expect(edit.getByRole('checkbox', { name: 'Gopal paid' })).not.toBeChecked();
});

test('what the form shows is what is saved, to the paisa (same seed)', async ({ page }) => {
  await start(page, 'hari');
  const group = await createGroup(page, ['Isha', 'Jay']);
  const form = await addExpense(page, group.id, '100', 'Snacks');

  // ₹100 three ways: one person pays the extra paisa, chosen by the expense's ID.
  await expect(form.getByText('₹33.33 each, and ₹0.01 more for 1 person')).toBeVisible();
  const shown = new Map<string, string>();
  for (const member of group.members) {
    const label = member.user.name === 'Hari' ? 'Hari (you)' : member.user.name;
    const row = form
      .locator('label')
      .filter({ hasText: label })
      .filter({ has: page.getByRole('checkbox') });
    shown.set(member.user.id, (await amountIn(row).textContent())!);
  }
  await backToForm(form);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
  await page.getByRole('link', { name: /Snacks/ }).click();
  const tx = await saved(page);
  expect(tx.shares).toHaveLength(3);
  for (const share of tx.shares) {
    expect(shown.get(share.userId)).toBe(`₹${(share.amount / 100).toFixed(2)}`);
  }
});
