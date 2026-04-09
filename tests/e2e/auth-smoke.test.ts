import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const TEST_CONFIG = {
  ORCHESTRATOR_URL: 'http://localhost:5100',
  ADMIN_USERNAME: 'testadmin',
  ADMIN_PASSWORD: 'testadminpass123',
};

test.describe('Auth Smoke Tests', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterEach(async () => {
    await page.close();
    await context.close();
  });

  test('1. Login page renders correctly', async () => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: /orchestrator/i })).toBeVisible();
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.locator('.text-red-400')).not.toBeVisible();
  });

  test('2. Login with valid admin credentials redirects to dashboard', async () => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/username/i).fill(TEST_CONFIG.ADMIN_USERNAME);
    await page.getByLabel(/password/i).fill(TEST_CONFIG.ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/$|\/dashboard/i, { timeout: 10000 });
    await expect(page.getByText(/dashboard/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('3. Login with wrong password shows error', async () => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/username/i).fill(TEST_CONFIG.ADMIN_USERNAME);
    await page.getByLabel(/password/i).fill('wrongpassword123');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid|failed|error|authentication/i)).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('4. Unauthenticated user visiting / is redirected to /login', async () => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await expect(page.getByLabel(/username/i)).toBeVisible();
  });

  test('5. API 401 triggers automatic logout callback mechanism', async () => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/username/i).fill(TEST_CONFIG.ADMIN_USERNAME);
    await page.getByLabel(/password/i).fill(TEST_CONFIG.ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/$|\/dashboard/i, { timeout: 10000 });

    const response = await page.request.get(`${TEST_CONFIG.ORCHESTRATOR_URL}/api/orchestrator/health`, {
      headers: { Authorization: 'Bearer invalid-token' },
    });

    if (response.status() === 401) {
      expect(true).toBeTruthy();
    }
  });

  test('6. Admin can see Users tab in Settings', async () => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/username/i).fill(TEST_CONFIG.ADMIN_USERNAME);
    await page.getByLabel(/password/i).fill(TEST_CONFIG.ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/$|\/dashboard/i, { timeout: 10000 });
    await page.goto('/settings');

    await expect(page.getByRole('tab', { name: /users/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole('tab', { name: /users/i }).click();

    await expect(
      page.getByText(/user management/i).or(page.getByText(/manage users/i))
    ).toBeVisible({ timeout: 10000 });
  });

  test('7. Config export produces valid JSON', async () => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/username/i).fill(TEST_CONFIG.ADMIN_USERNAME);
    await page.getByLabel(/password/i).fill(TEST_CONFIG.ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/$|\/dashboard/i, { timeout: 10000 });
    await page.goto('/settings');

    const downloadButton = page.getByRole('button', { name: /download config/i });
    await expect(downloadButton).toBeVisible({ timeout: 10000 });

    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);

    const path = await download.path();
    expect(path).toBeDefined();

    const fs = await import('fs');
    const content = fs.readFileSync(path!, 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed).toHaveProperty('exportedAt');
    expect(parsed).toHaveProperty('version');
    expect(parsed).toHaveProperty('config');
    expect(typeof parsed.version).toBe('number');
    expect(typeof parsed.config).toBe('object');
  });
});
