import AxeBuilder from '@axe-core/playwright';
import { Group, InviteCreated } from '@fairshare/contracts';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { BASE_URL } from '../playwright.config';
import { expect, newEmail, signIn, test } from './fixtures';

// The accessibility pass (Blueprint 7.1, 13): every screen checked by axe against WCAG 2.1 A and AA,
// colour contrast included, in the light and the dark theme. Keyboard use and focus are covered by
// the flows themselves (dialogs, the split sheet, chips) and the checks at the end.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** No violations on what's on screen now; failures name the rule and the elements. */
async function check(page: Page, screen: string) {
  // Let entering animations finish, so contrast is measured on the final colours.
  await page.waitForTimeout(300);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const found = violations.map((v) => ({
    screen,
    rule: v.id,
    impact: v.impact,
    nodes: v.nodes
      .map(
        (n) => `${n.target.join(' ')}: ${n.failureSummary?.split('\n').slice(1).join(' ').trim()}`,
      )
      .slice(0, 5),
  }));
  expect(found, `${screen}: ${JSON.stringify(found, null, 2)}`).toEqual([]);
}

async function setUp(page: Page, name: string) {
  await page.goto('/');
  await signIn(page, newEmail(name));
  await expect(page.getByRole('heading', { level: 1, name: /^(Groups|Home)$/ })).toBeVisible();
  const created = await page.request.post('/api/v1/groups', {
    headers: { Origin: BASE_URL },
    data: { id: randomUUID(), name: 'Goa Trip', currency: 'INR', members: [{ name: 'Rahul' }] },
  });
  const group = Group.parse(await created.json());
  const [me, rahul] = group.members.map((m) => m.user.id);
  const expenseId = randomUUID();
  await page.request.post(`/api/v1/groups/${group.id}/expenses`, {
    headers: { Origin: BASE_URL },
    data: {
      id: expenseId,
      description: 'Dinner',
      amount: 240_000,
      currency: 'INR',
      occurredOn: '2026-11-10',
      payers: [{ userId: me, amount: 240_000 }],
      split: { method: 'equal', participants: [me, rahul] },
    },
  });
  return { group, rahul: rahul!, expenseId };
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test('signed-out screens', async ({ page }) => {
      await page.goto('/sign-in');
      await check(page, 'sign-in');
      await page.getByLabel('Email').fill(newEmail('axe'));
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
      await check(page, 'sign-in code');
      await page.goto('/privacy');
      await check(page, 'privacy notice');
      await page.goto('/terms');
      await check(page, 'terms');
      await page.goto('/nowhere');
      await check(page, 'not found');
    });

    test('a group and its dialogs', async ({ page }) => {
      const { group } = await setUp(page, 'asha');
      await page.goto(`/groups/${group.id}`);
      await expect(page.getByRole('link', { name: /Dinner/ })).toBeVisible();
      await check(page, 'group: expenses');
      const sections = page.getByRole('navigation', { name: 'Group sections' });
      await sections.getByRole('link', { name: 'balances' }).click();
      await expect(page).toHaveURL(/tab=balances/);
      await expect(page.getByRole('main').getByText('Rahul').first()).toBeVisible();
      await check(page, 'group: balances');
      await sections.getByRole('link', { name: 'members' }).click();
      await expect(page.getByRole('list', { name: 'Members' })).toBeVisible();
      await check(page, 'group: members');

      await page.getByRole('button', { name: 'Add expense' }).first().click();
      const form = page.getByRole('dialog', { name: 'Add expense' });
      await expect(form.getByLabel('Amount')).toBeVisible();
      await check(page, 'add expense');
      await form.getByRole('button', { name: /^Paid by/ }).click();
      await check(page, 'add expense: split');
      await page.keyboard.press('Escape');
      await expect(form).toBeHidden();

      await page.goto(`/groups/${group.id}/settle`);
      await expect(page.getByRole('dialog')).toBeVisible();
      await check(page, 'settle up');
    });

    test('everything else signed in', async ({ page }) => {
      const { group, rahul, expenseId } = await setUp(page, 'bilal');
      await page.goto('/');
      await expect(page.getByRole('link', { name: /Goa Trip/ }).first()).toBeVisible();
      await check(page, 'home');
      await page.goto(`/transactions/${expenseId}`);
      await expect(page.getByRole('heading', { name: 'Dinner' })).toBeVisible();
      await check(page, 'expense');
      await page.goto(`/friends/${rahul}`);
      await expect(page.getByRole('heading', { name: 'Rahul' })).toBeVisible();
      await check(page, 'friend');
      await page.goto('/activity');
      await expect(page.getByText(/added ‘Dinner’/).first()).toBeVisible();
      await check(page, 'activity');
      await page.goto('/groups/new');
      await expect(page.getByLabel('Group name')).toBeVisible();
      await check(page, 'new group');
      await page.goto('/settings');
      await expect(page.getByLabel('Name')).toBeVisible();
      await check(page, 'settings');
      await page.goto('/settings/delete-account');
      await expect(page.getByRole('list', { name: 'Balances not settled' })).toBeVisible();
      await check(page, 'delete account');

      // An invite, as someone signed out sees it.
      const invite = InviteCreated.parse(
        await (
          await page.request.post(`/api/v1/groups/${group.id}/invites`, {
            headers: { Origin: BASE_URL },
            data: {},
          })
        ).json(),
      );
      await page.context().clearCookies();
      await page.goto(new URL(invite.url).pathname);
      await expect(page.getByRole('heading', { name: /Goa Trip/ })).toBeVisible();
      await check(page, 'invite');
    });
  });
}

test('the keyboard reaches everything, and focus is always visible', async ({ page }) => {
  await setUp(page, 'chitra');
  await page.goto('/');
  // Tab through Home: every stop is a visible, labelled control with a focus ring.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        name: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '',
        visible: rect.width > 0 && rect.height > 0,
        // On the control itself, or drawn by its wrapper (an input inside a styled field).
        ring:
          style.outlineStyle !== 'none' ||
          style.boxShadow !== 'none' ||
          (el.parentElement?.className.includes('focus-within:ring') ?? false),
      };
    });
    if (!stop) continue;
    expect(stop.visible, JSON.stringify(stop)).toBe(true);
    expect(stop.name, 'every stop has a name').not.toBe('');
    expect(stop.ring, `${stop.name} shows focus`).toBe(true);
  }
});
