import { test } from '@playwright/test';

const SCREENSHOT_DIR = '../docs/screenshots';

test('scaffold — captures all screenshots', async ({ page }) => {
  // Will be filled in Task 2
  await page.goto('/');
});
