import { test, expect } from '@playwright/test';

const appHtml = `<!doctype html><title>Sheets test app</title><label>Cell A1 <input id="cell"></label><script>
parent.postMessage({type:'pc:ready',appId:'sheets'},location.origin);
</script>`;
async function fakeSheets(page) {
  let loads = 0;
  await page.route('**/pc/apps/sheets/', route => { loads++; return route.fulfill({ contentType: 'text/html', body: appHtml }); });
  return () => loads;
}
const win = (page, id) => page.locator(`[data-window="${id}"]`);

test('PC launches lazily and reuses app state after minimize and close', async ({ page }) => {
  const loads = await fakeSheets(page);
  await page.goto('/pc/');
  await expect(page.locator('iframe')).toHaveCount(0);
  const shortcut = page.locator('[data-shortcut="sheets"]');
  await shortcut.click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await shortcut.dblclick();
  await expect(win(page, 'sheets')).toHaveAttribute('data-load', 'ready');
  const cell = page.frameLocator('iframe').getByLabel('Cell A1');
  await cell.fill('Keep my work');
  await page.getByRole('button', { name: 'Minimize Sheets', exact: true }).click();
  await expect(win(page, 'sheets')).toBeHidden();
  await page.getByRole('button', { name: 'Switch to Sheets', exact: true }).click();
  await expect(cell).toHaveValue('Keep my work');
  await page.getByRole('button', { name: 'Close Sheets', exact: true }).click();
  await expect(win(page, 'sheets')).toBeHidden();
  await expect(page.locator('[data-task="sheets"]')).toHaveCount(0);
  await shortcut.focus();
  await page.keyboard.press('Enter');
  await expect(cell).toHaveValue('Keep my work');
  expect(loads()).toBe(1);
});

test('PC manages keyboard geometry, stacking, maximize, and launcher focus', async ({ page }) => {
  await fakeSheets(page);
  await page.goto('/pc/');
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  await expect(page.locator('#pc-launcher')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-launcher-toggle]')).toBeFocused();
  await page.locator('[data-shortcut="sheets"]').focus();
  await page.keyboard.press('Enter');
  await expect(win(page, 'sheets')).toHaveAttribute('data-load', 'ready');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(win(page, 'about')).toHaveAttribute('data-active', 'true');
  const title = win(page, 'about').locator('[data-move]');
  const before = await win(page, 'about').boundingBox();
  await title.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  const moved = await win(page, 'about').boundingBox();
  expect(moved.x).toBe(before.x - 20);
  expect(moved.width).toBe(before.width - 20);
  await page.getByRole('button', { name: 'Maximize About WebPC', exact: true }).click();
  await expect(win(page, 'about')).toHaveAttribute('data-maximized', 'true');
  await page.getByRole('button', { name: 'Restore About WebPC', exact: true }).click();
  expect((await win(page, 'about').boundingBox()).width).toBe(moved.width);
  await page.frameLocator('iframe').getByLabel('Cell A1').click();
  await expect(win(page, 'sheets')).toHaveAttribute('data-active', 'true');
  await page.getByRole('button', { name: 'Show desktop', exact: true }).click();
  await expect(win(page, 'sheets')).toBeHidden();
  await expect(win(page, 'about')).toBeHidden();
});

test('PC pointer dragging and resizing work without escaping the workspace', async ({ page }) => {
  await page.goto('/pc/');
  await page.locator('[data-shortcut="about"]').dblclick();
  const title = await win(page, 'about').locator('[data-move]').boundingBox();
  const before = await win(page, 'about').boundingBox();
  await page.mouse.move(title.x + 100, title.y + 22);
  await page.mouse.down();
  await page.mouse.move(title.x + 170, title.y + 52, { steps: 5 });
  await page.mouse.up();
  const moved = await win(page, 'about').boundingBox();
  expect(moved.x).toBe(before.x + 70);
  expect(moved.y).toBe(before.y + 30);
  const grip = await win(page, 'about').locator('.pc-resize').boundingBox();
  await page.mouse.move(grip.x + 12, grip.y + 12);
  await page.mouse.down();
  await page.mouse.move(grip.x + 72, grip.y + 42, { steps: 5 });
  await page.mouse.up();
  expect((await win(page, 'about').boundingBox()).width).toBe(moved.width + 60);
});

test('PC iframe failure offers a working retry', async ({ page }) => {
  let failed = true;
  await page.route('**/pc/apps/sheets/', route => route.fulfill({ status: failed ? 404 : 200, contentType: 'text/html', body: failed ? '<title>404 Not Found</title>' : appHtml }));
  await page.goto('/pc/');
  await page.locator('[data-shortcut="sheets"]').dblclick();
  await expect(win(page, 'sheets')).toHaveAttribute('data-load', 'error');
  await expect(page.getByRole('heading', { name: 'Sheets couldn’t open' })).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(win(page, 'sheets')).toHaveAttribute('data-load', 'ready');
});

test('PC keeps a window open if its synchronous save hook fails', async ({ page }) => {
  await fakeSheets(page);
  await page.goto('/pc/');
  await page.locator('[data-shortcut="sheets"]').dblclick();
  await expect(win(page, 'sheets')).toHaveAttribute('data-load', 'ready');
  await page.locator('iframe').evaluate(frame => { frame.contentWindow.pcBeforeClose = () => false; });
  await page.getByRole('button', { name: 'Close Sheets', exact: true }).click();
  await expect(win(page, 'sheets')).toBeVisible();
  await expect(page.locator('[data-announcement]')).toContainText('could not save');
  await page.locator('iframe').evaluate(frame => { frame.contentWindow.pcBeforeClose = () => true; });
  await page.getByRole('button', { name: 'Close Sheets', exact: true }).click();
  await expect(win(page, 'sheets')).toBeHidden();
});

test.describe('PC touch and responsive layout' , () => {
  test.use({ hasTouch: true });
  test('touch launch and visible window controls at 320/375/414/768', async ({ page }) => {
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 760 });
      await page.goto('/pc/');
      await page.locator('[data-shortcut="about"]').tap();
      await expect(win(page, 'about')).toBeVisible();
      const box = await win(page, 'about').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect(page.getByRole('button', { name: 'Close About WebPC', exact: true })).toBeInViewport();
      await page.getByRole('button', { name: 'Close About WebPC', exact: true }).tap();
      await expect(win(page, 'about')).toBeHidden();
    }
  });
});

test('WebPC launcher filters apps and launches a keyboard search result', async ({ page }) => {
  const loads = await fakeSheets(page);
  await page.goto('/pc/');
  await expect(page).toHaveTitle('WebPC · Usman Shahid');
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search apps' });
  await expect(search).toBeFocused();
  await search.fill('no app matches this');
  await expect(page.locator('[data-app-empty]')).toBeVisible();
  await search.fill('excel');
  await expect(page.locator('[data-app-result=sheets]')).toBeVisible();
  await expect(page.locator('[data-app-result=about]')).toBeHidden();
  await page.getByLabel('App category').selectOption('System');
  await expect(page.locator('[data-app-empty]')).toBeVisible();
  await page.getByLabel('App category').selectOption('all');
  await search.press('Enter');
  await expect(win(page, 'sheets')).toHaveAttribute('data-load', 'ready');
  expect(loads()).toBe(1);
});
