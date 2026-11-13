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
  await expect(page.getByRole('heading', { level: 1, name: /^(Groups|Home)$/ })).toBeVisible();
}

const yourBalance = (page: Page) => page.getByRole('region', { name: 'Your balance' });
const payments = (page: Page) => page.getByRole('region', { name: 'Suggested payments' });

test('settles a suggested payment, then an old expense is corrected (Blueprint 5.5, 5.6)', async ({
  page,
}) => {
  await start(page, 'asha');
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
  await page.goto(`/groups/${group.id}?tab=balances`);
  await expect(yourBalance(page)).toContainText('You’re owed ₹1,850.00');

  // "Settle" on Bilal's suggested payment opens the form filled in with it.
  await payments(page).getByRole('link', { name: 'Settle: Bilal pays you ₹950.00' }).click();
  const form = page.getByRole('dialog', { name: 'Record a payment' });
  await expect(form.getByLabel('From')).toHaveValue(bilal);
  await expect(form.getByLabel('To')).toHaveValue(asha);
  await expect(form.getByLabel('Amount')).toHaveValue('950.00');
  await expect(form.getByRole('button', { name: 'UPI' })).toHaveAttribute('aria-pressed', 'true');
  await form.getByLabel('Reference (optional)').fill('UTR 4312');
  await form.getByRole('button', { name: 'Record payment' }).click();

  await expect(form).toBeHidden();
  await expect(page.getByRole('status')).toContainText('Recorded: Bilal paid you ₹950.00');
  await expect(page).toHaveURL(/tab=balances/);
  // A +900, B 0, C −150, D −750.
  await expect(yourBalance(page)).toContainText('You’re owed ₹900.00');
  await expect(payments(page).getByRole('listitem')).toHaveText([
    /Dev pays you\s*₹750.00/,
    /Chitra pays you\s*₹150.00/,
  ]);
  const everyone = page.getByRole('region', { name: 'Everyone’s balance' });
  const bilalRow = everyone.getByRole('listitem').filter({ hasText: 'Bilal' });
  await expect(bilalRow).toContainText('settled up');
  await bilalRow.locator('summary').click();
  await expect(bilalRow.getByRole('term')).toHaveText([
    'Paid for expenses',
    'Share of expenses',
    'Paid back',
  ]);

  // The payment in the history, as a payment.
  await page.getByRole('link', { name: /^expenses$/i }).click();
  const row = page.getByRole('link', { name: /Bilal paid you/ });
  await expect(row).toContainText('Payment · UPI');
  await expect(row).toContainText('you received ₹950.00');
  await row.click();
  await expect(page.getByRole('heading', { name: 'Bilal paid you' })).toBeVisible();
  await expect(page.getByText('UTR 4312')).toBeVisible();
  await expect(page.getByText(/recorded it$/)).toBeVisible();

  // Dinner was ₹1,500, not ₹1,200: A +800, B +200, C −250, D −750. Bilal is now owed.
  await page.goto(`/groups/${group.id}`);
  await page.getByRole('link', { name: /Dinner/ }).click();
  await page.getByRole('link', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit expense' });
  await edit.getByLabel('Amount').fill('1500');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();

  await page.goto(`/groups/${group.id}?tab=balances`);
  await expect(yourBalance(page)).toContainText('You’re owed ₹800.00');
  await expect(everyone.getByRole('listitem').filter({ hasText: 'Bilal' })).toContainText(
    'gets back ₹200.00',
  );
  await expect(everyone.getByRole('listitem').filter({ hasText: 'Chitra' })).toContainText(
    'owes ₹250.00',
  );
});

test('asks before an overpayment, and settling up reaches zero everywhere', async ({ page }) => {
  await start(page, 'esha');
  const group = await api(page).createGroup('Flat', ['Farah']);
  const [esha, farah] = group.members.map((m) => m.user.id) as [string, string];
  await api(page).expense(group.id, 'Rent', 100_000, [[esha, 100_000]], [esha, farah]);
  await page.goto(`/groups/${group.id}?tab=balances`);

  // Without a suggestion picked, the form opens on my own suggested payment.
  // On desktop the group header has it too.
  await page.getByRole('link', { name: 'Record a payment' }).first().click();
  const form = page.getByRole('dialog', { name: 'Record a payment' });
  await expect(form.getByLabel('From')).toHaveValue(farah);
  await expect(form.getByLabel('Amount')).toHaveValue('500.00');

  await form.getByLabel('Amount').fill('600');
  await expect(form.getByText('This is ₹100.00 more than Farah owes.')).toBeVisible();
  await form.getByRole('button', { name: 'Record payment' }).click();
  const question = page.getByRole('dialog', { name: 'Record anyway?' });
  await expect(question).toContainText('This is ₹100.00 more than Farah owes.');
  // "Change amount" goes back to the form as it was.
  await question.getByRole('button', { name: 'Change amount' }).click();
  await expect(form.getByLabel('Amount')).toHaveValue('600.00');
  await form.getByRole('button', { name: 'Use the suggested ₹500.00' }).click();
  await form.getByRole('button', { name: 'Cash' }).click();
  await form.getByRole('button', { name: 'Record payment' }).click();

  await expect(form).toBeHidden();
  await expect(payments(page)).toContainText('All settled up');
  await expect(yourBalance(page)).toContainText('You’re settled up');

  // Undo takes it back out.
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('status')).toContainText('Payment removed');
  await expect(yourBalance(page)).toContainText('You’re owed ₹500.00');

  // Settle it again from the suggestion; Home agrees.
  await payments(page).getByRole('link', { name: 'Settle: Farah pays you ₹500.00' }).click();
  await form.getByRole('button', { name: 'Record payment' }).click();
  await expect(yourBalance(page)).toContainText('You’re settled up');
  // Home: "Home" in the desktop sidebar, the "Groups" tab on phones.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /^(Home|Groups)$/ })
    .click();
  await expect(page.getByText('You’re all settled up', { exact: true })).toBeVisible();

  // Edit the payment: it was by bank transfer.
  await page.goto(`/groups/${group.id}`);
  await page.getByRole('link', { name: /Farah paid you/ }).click();
  await page.getByRole('link', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit payment' });
  await expect(edit.getByLabel('Amount')).toHaveValue('500.00');
  await edit.getByRole('button', { name: 'Bank' }).click();
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText(/^Method .+ → Bank$/).filter({ visible: true })).toBeVisible();
});

test('settles up with a friend from their page, past what they owe', async ({ page }) => {
  await start(page, 'gita');
  await page.getByRole('button', { name: 'Add a friend' }).first().click();
  const add = page.getByRole('dialog', { name: 'Add a friend' });
  await add.getByLabel('Name').fill('Hari');
  await add.getByRole('button', { name: 'Add friend' }).click();
  await expect(page.getByRole('heading', { name: 'Hari', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add expense' }).click();
  const expense = page.getByRole('dialog', { name: 'Add expense' });
  await expense.getByLabel('Amount').fill('300');
  await expense.getByLabel('Description').fill('Movie');
  await expense.getByRole('button', { name: 'Save' }).click();
  // A friendship takes my default currency, which follows the browser's locale (USD here).
  await expect(page.getByText('Hari owes you $150.00', { exact: true })).toBeVisible();

  await page
    .getByRole('region', { name: 'By group' })
    .getByRole('link', { name: 'Settle: Just the two of you' })
    .click();
  const form = page.getByRole('dialog', { name: 'Record a payment' });
  await expect(form.getByLabel('Amount')).toHaveValue('150.00');
  // Cash is the default away from rupees.
  await expect(form.getByRole('button', { name: 'Cash' })).toHaveAttribute('aria-pressed', 'true');
  await form.getByLabel('Amount').fill('200');
  await form.getByRole('button', { name: 'Record payment' }).click();
  await page
    .getByRole('dialog', { name: 'Record anyway?' })
    .getByRole('button', { name: 'Record anyway' })
    .click();

  await expect(form).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Hari', exact: true })).toBeVisible();
  await expect(page.getByText('You owe Hari $50.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Hari paid you/ })).toContainText(
    'you received $200.00',
  );
});
