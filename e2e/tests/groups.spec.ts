import { InviteCreated } from '@fairshare/contracts';
import { expect, guard, newEmail, signIn, test } from './fixtures';

test('creates a group with a placeholder, who joins through the invite and claims their place', async ({
  page,
  browser,
}, testInfo) => {
  // Asha starts a group with "Bilal", who has no account yet.
  await page.goto('/');
  await signIn(page, newEmail('asha'));
  await page.getByRole('link', { name: 'Start a group' }).first().click();
  await expect(page).toHaveURL(/\/groups\/new$/);
  await page.getByLabel('Group name').fill('Goa Trip');
  // The radios are visually hidden inside their labels; people tap the label.
  await page.locator('label').filter({ hasText: '🏖️' }).click();
  await expect(page.getByRole('radio', { name: '🏖️' })).toBeChecked();
  await page.getByLabel('Name', { exact: true }).fill('Bilal');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByRole('button', { name: 'Remove Bilal' })).toBeVisible();
  await page.getByRole('button', { name: 'Create group' }).click();

  await expect(page.getByRole('heading', { name: 'Goa Trip' })).toBeVisible();
  await expect(page.getByText('Group created.')).toBeVisible();
  const members = page.getByRole('list', { name: 'Members' });
  await expect(members.getByText('Not joined yet')).toBeVisible();

  // She invites Bilal; the link is what she'd share on WhatsApp.
  const created = page.waitForResponse(
    (r) => r.url().includes('/invites') && r.request().method() === 'POST',
  );
  await members.getByRole('button', { name: 'Invite Bilal' }).click();
  const { url } = InviteCreated.parse(await (await created).json());

  // Bilal opens the link in his own browser, signs up, and picks "I'm Bilal".
  const bilalContext = await browser.newContext({ ...testInfo.project.use });
  const bilal = await bilalContext.newPage();
  const bilalErrors = await guard(bilal);
  await bilal.goto(new URL(url).pathname);
  await expect(
    bilal.getByRole('heading', { name: /Asha invited you to 🏖️ Goa Trip/ }),
  ).toBeVisible();
  await bilal.getByRole('link', { name: 'Sign in to join' }).click();
  await signIn(bilal, newEmail('bilal'));
  await expect(bilal.getByRole('radio', { name: 'I’m Bilal' })).toBeChecked();
  await bilal.getByRole('button', { name: 'Join' }).click();

  await expect(bilal.getByRole('heading', { name: 'Goa Trip' })).toBeVisible();
  const seenByBilal = bilal.getByRole('list', { name: 'Members' });
  await expect(seenByBilal.getByText('Bilal (you)')).toBeVisible();
  await expect(seenByBilal.getByText('Not joined yet')).toHaveCount(0);
  expect(bilalErrors, 'console errors in Bilal’s browser').toEqual([]);
  await bilalContext.close();

  // Asha sees him as a member now.
  await page.reload();
  await expect(members.getByText('Bilal', { exact: true })).toBeVisible();
  await expect(members.getByText('Not joined yet')).toHaveCount(0);
});

test('adds a friend by name and opens the friendship', async ({ page }) => {
  await page.goto('/');
  await signIn(page, newEmail('esha'));

  await page.getByRole('button', { name: 'Add a friend' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add a friend' });
  await dialog.getByLabel('Name').fill('Chitra');
  await dialog.getByRole('button', { name: 'Add friend' }).click();

  await expect(page.getByRole('heading', { name: 'You & Chitra' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite Chitra' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Chitra')).toBeVisible();
});

test('a member leaves a group after confirming', async ({ page }) => {
  await page.goto('/groups/new');
  await signIn(page, newEmail('farah'));
  await page.getByLabel('Group name').fill('Flat');
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('heading', { name: 'Flat' })).toBeVisible();

  await page.getByRole('button', { name: 'Leave group' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave Flat?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Leave' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Start a group' })).toBeVisible();
});

test('the owner deletes a settled group from its settings', async ({ page }) => {
  await page.goto('/groups/new');
  await signIn(page, newEmail('gita'));
  await page.getByLabel('Group name').fill('Old trip');
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('heading', { name: 'Old trip' })).toBeVisible();

  await page.getByRole('button', { name: 'Group settings' }).click();
  await page
    .getByRole('dialog', { name: 'Group settings' })
    .getByRole('button', { name: 'Delete group' })
    .click();
  // The settings dialog gives way to the confirmation, which must stay open.
  const confirm = page.getByRole('dialog', { name: 'Delete Old trip?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete group' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Start a group' })).toBeVisible();
});
