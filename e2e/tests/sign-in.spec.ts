import { expect, newEmail, readCode, signIn, test } from './fixtures';

test('signs up with an email code and lands on an empty Home', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2F$/);

  await signIn(page, newEmail('asha.kapoor'));

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Hi, Asha' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No groups yet' })).toBeVisible();
});

test('comes back to the page that asked for sign-in, keeps profile edits, signs out', async ({
  page,
}) => {
  await page.goto('/settings');
  await signIn(page, newEmail('bilal'));

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  const name = page.getByLabel('Name');
  await expect(name).toHaveValue('Bilal');
  await name.fill('Bilal Khan');
  await page.getByLabel('Default currency').selectOption('EUR');
  await page.getByLabel(/UPI ID/).fill('bilal@okaxis');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.reload();
  await expect(name).toHaveValue('Bilal Khan');
  await expect(page.getByLabel('Default currency')).toHaveValue('EUR');
  await expect(page.getByLabel(/UPI ID/)).toHaveValue('bilal@okaxis');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fsettings$/);
});

test('rejects an invalid UPI ID before saving', async ({ page }) => {
  await page.goto('/settings');
  await signIn(page, newEmail('chitra'));

  await page.getByLabel(/UPI ID/).fill('not-a-upi-id');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('Enter a UPI ID like name@bank.')).toBeVisible();
  await expect(page.getByLabel(/UPI ID/)).toHaveAttribute('aria-invalid', 'true');
});

test('counts down the tries left for a wrong code', async ({ page }) => {
  const email = newEmail('dev');
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  const code = await readCode(email);
  const wrong = code === '000000' ? '111111' : '000000';

  await page.getByLabel('Sign-in code').fill(wrong);
  await expect(page.getByText('Code is incorrect (2 tries left).')).toBeVisible();
  await expect(page.getByRole('button', { name: /Resend code in \d+s/ })).toBeDisabled();

  await page.getByLabel('Sign-in code').fill(code);
  await expect(page.getByRole('heading', { name: 'Hi, Dev' })).toBeVisible();
});

test('remembers the theme on this device', async ({ page }) => {
  await page.goto('/settings');
  await signIn(page, newEmail('esha'));

  await page.getByText('Dark', { exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);

  await page.getByText('Light', { exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
});

test('shows the layout for the screen size', async ({ page }, testInfo) => {
  await page.goto('/');
  await signIn(page, newEmail('farah'));
  await expect(page.getByRole('heading', { name: 'Hi, Farah' })).toBeVisible();

  // CSS shows one of the two navigations; the hidden one is out of the accessibility tree.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toHaveCount(1);
  if (testInfo.project.name === 'mobile') {
    await expect(page.locator('aside')).toBeHidden();
    await expect(nav).toHaveCSS('position', 'fixed'); // the bottom tab bar
  } else {
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('aside').getByRole('navigation', { name: 'Main' })).toBeVisible();
  }
  await nav.getByRole('link', { name: 'Activity' }).click();
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
});
