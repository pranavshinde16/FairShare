import { Group, InviteCreated, Transaction } from '@fairshare/contracts';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { BASE_URL } from '../playwright.config';
import { expect, guard, newEmail, signIn, test } from './fixtures';

/** Calls the API as `page`'s signed-in person does (same cookies, the app's Origin). */
const api = (page: Page) => {
  const headers = { Origin: BASE_URL };
  return {
    async createGroup(name: string, members: string[] = []) {
      const res = await page.request.post('/api/v1/groups', {
        headers,
        data: {
          id: randomUUID(),
          name,
          currency: 'INR',
          members: members.map((n) => ({ name: n })),
        },
      });
      expect(res.status()).toBe(201);
      return Group.parse(await res.json());
    },
    async inviteToken(groupId: string) {
      const res = await page.request.post(`/api/v1/groups/${groupId}/invites`, {
        headers,
        data: {},
      });
      expect(res.status()).toBe(201);
      return InviteCreated.parse(await res.json())
        .url.split('/')
        .pop()!;
    },
    async accept(token: string) {
      const res = await page.request.post(`/api/v1/invites/${token}/accept`, { headers, data: {} });
      expect(res.status()).toBe(200);
    },
    async expense(
      groupId: string,
      description: string,
      amount: number,
      payer: string,
      participants: string[],
      occurredOn = '2026-11-10',
    ) {
      const res = await page.request.post(`/api/v1/groups/${groupId}/expenses`, {
        headers,
        data: {
          id: randomUUID(),
          description,
          amount,
          currency: 'INR',
          occurredOn,
          payers: [{ userId: payer, amount }],
          split: { method: 'equal', participants },
        },
      });
      expect(res.status()).toBe(201);
      return Transaction.parse(await res.json());
    },
    async settle(groupId: string, from: string, to: string, amount: number, occurredOn: string) {
      const res = await page.request.post(`/api/v1/groups/${groupId}/settlements`, {
        headers,
        data: {
          id: randomUUID(),
          fromUserId: from,
          toUserId: to,
          amount,
          currency: 'INR',
          occurredOn,
          method: 'cash',
        },
      });
      expect(res.status()).toBe(201);
    },
    async edit(tx: Transaction, amount: number, participants: string[]) {
      const res = await page.request.put(`/api/v1/transactions/${tx.id}`, {
        headers: { ...headers, 'If-Match': `"${tx.version}"` },
        data: {
          description: tx.description,
          amount,
          currency: tx.currency,
          occurredOn: tx.occurredOn,
          payers: [{ userId: tx.payers[0].userId, amount }],
          split: { method: 'equal', participants },
        },
      });
      expect(res.status()).toBe(200);
    },
    async remove(tx: Transaction) {
      const res = await page.request.delete(`/api/v1/transactions/${tx.id}`, {
        headers: { ...headers, 'If-Match': `"${tx.version}"` },
      });
      expect(res.status()).toBe(200);
    },
    async me() {
      const res = await page.request.get('/api/v1/me');
      return ((await res.json()) as { id: string }).id;
    },
  };
};

/** Signed in once Home shows; only then does the API see the session cookie. */
async function start(page: Page, name: string) {
  await page.goto('/');
  await signIn(page, newEmail(name));
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible();
}

const activityLink = (page: Page) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Activity/ });

test('shows others’ changes in Activity, with an unread badge that clears on visiting', async ({
  page,
  browser,
}, testInfo) => {
  await start(page, 'asha');
  const asha = await api(page).me();
  const group = await api(page).createGroup('Goa Trip');
  const token = await api(page).inviteToken(group.id);

  // Bilal, in his own browser, joins and adds dinner for the two of them.
  const bilalContext = await browser.newContext({ ...testInfo.project.use });
  const bilalPage = await bilalContext.newPage();
  const bilalErrors = await guard(bilalPage);
  await start(bilalPage, 'bilal');
  const bilal = await api(bilalPage).me();
  await api(bilalPage).accept(token);
  const dinner = await api(bilalPage).expense(group.id, 'Dinner', 120_000, bilal, [asha, bilal]);

  // Asha sees two unread changes.
  await page.reload();
  await expect(activityLink(page)).toHaveAccessibleName(/^Activity \(2 unread\)$/);
  await activityLink(page).click();
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
  const rows = page.getByRole('main').getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Bilal added ‘Dinner’');
  await expect(rows.nth(0)).toContainText('you borrowed ₹600.00');
  await expect(rows.nth(0)).toContainText('Goa Trip');
  await expect(rows.nth(1)).toContainText('Bilal joined with an invite link');
  await expect(rows.nth(2)).toContainText('You created an invite link');
  await expect(rows.nth(3)).toContainText('You created the group');
  // Visiting marks them read.
  await expect(activityLink(page)).toHaveAccessibleName(/^Activity$/);

  // Bilal corrects the amount; Asha's badge picks it up on the next look.
  await api(bilalPage).edit(dinner, 150_000, [asha, bilal]);
  await page.getByRole('link', { name: 'FairShare home' }).first().click();
  await page.reload();
  await expect(activityLink(page)).toHaveAccessibleName(/^Activity \(1 unread\)$/);
  await activityLink(page).click();
  await expect(rows.nth(0)).toContainText('Bilal edited ‘Dinner’');
  await expect(rows.nth(0)).toContainText('Changed the amount ₹1,200.00 → ₹1,500.00');
  await expect(rows.nth(0)).toContainText('you borrowed ₹750.00');

  // A row opens what it's about.
  await rows.nth(0).getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Dinner' })).toBeVisible();
  await expect(page.getByText('Bilal changed the amount ₹1,200.00 → ₹1,500.00')).toBeVisible();

  await bilalContext.close();
  expect(bilalErrors, 'console errors in Bilal’s browser').toEqual([]);
});

test('finds an old expense with search and filters, edits it, and restores a deleted one', async ({
  page,
}) => {
  await start(page, 'esha');
  const group = await api(page).createGroup('Flat', ['Farah', 'Gopal']);
  const [esha, farah, gopal] = group.members.map((m) => m.user.id) as [string, string, string];
  const all = [esha, farah, gopal];
  await api(page).expense(group.id, 'Taxi to airport', 90_000, farah, all, '2026-09-14');
  await api(page).expense(group.id, 'Taxi home', 60_000, esha, [esha, gopal], '2026-11-08');
  await api(page).expense(group.id, 'Groceries', 30_000, esha, all, '2026-09-20');
  await api(page).settle(group.id, gopal, esha, 30_000, '2026-11-09');
  const gone = await api(page).expense(group.id, 'Lamp', 45_000, esha, all, '2026-11-01');
  await api(page).remove(gone);
  await page.goto(`/groups/${group.id}`);
  // Expense rows read "Farah paid ₹900.00"; the payment reads "Gopal paid you".
  const list = page.getByRole('main').getByRole('link', { name: /paid ₹/ });
  await expect(list).toHaveCount(3);

  // "taxi", paid by Farah, in September: the old one.
  await page.getByLabel('Search expenses').fill('taxi');
  await expect(list).toHaveCount(2);
  await page.getByLabel('Person').selectOption({ label: 'Farah' });
  await page.getByRole('button', { name: /^Dates/ }).click();
  const dates = page.getByRole('dialog', { name: 'Dates' });
  await dates.getByLabel('From').fill('2026-09-01');
  await dates.getByLabel('To').fill('2026-09-30');
  await dates.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('button', { name: 'Dates: Sep 1 – Sep 30' })).toBeVisible();
  await expect(list).toHaveCount(1);
  await expect(list).toContainText('Taxi to airport');
  // The filters are in the address, so they survive a reload.
  await page.reload();
  await expect(page.getByLabel('Search expenses')).toHaveValue('taxi');
  await expect(list).toHaveCount(1);

  await list.click();
  await page.getByRole('link', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit expense' });
  await edit.getByLabel('Amount').fill('1200');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();
  await expect(page.locator('header').getByText('₹1,200.00', { exact: true })).toBeVisible();
  // Saving went back to the expense; one more Back is the filtered list (not the editor again).
  await page.goBack();
  await expect(page).toHaveURL(/q=taxi/);
  await expect(list).toContainText('Farah paid ₹1,200.00');

  // Payments only, then everything again.
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByLabel('Search expenses')).toHaveValue('');
  await page.getByLabel('Type').selectOption({ label: 'Payments' });
  const payments = page.getByRole('main').getByRole('link', { name: /Gopal paid you/ });
  await expect(payments).toHaveCount(1);
  await expect(list).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(list).toHaveCount(3);
  await expect(payments).toHaveCount(1);

  // Show deleted: the lamp, with a way back.
  await page.getByLabel('Show deleted').check();
  const lamp = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Lamp' });
  await expect(lamp).toContainText('deleted');
  await lamp.getByRole('button', { name: 'Restore ‘Lamp’' }).click();
  await expect(page.getByRole('status')).toContainText('Restored ‘Lamp’');
  await expect(lamp).not.toContainText('deleted');
  await expect(lamp.getByRole('button', { name: /Restore/ })).toHaveCount(0);
});
