import { test, expect } from '@playwright/test';

test('header border follows the site color token in both themes', async ({ page }) => {
  await page.goto('/');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
    const colors = await page.locator('header').first().evaluate(el => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-hairline-2)';
      document.body.append(probe);
      const result = { actual: getComputedStyle(el).borderBottomColor, expected: getComputedStyle(probe).color };
      probe.remove();
      return result;
    });
    expect(colors.actual).toBe(colors.expected);
  }
});

test('hero canvas stops offscreen and with reduced motion, then resumes', async ({ page }) => {
  await page.addInitScript(() => {
    window.heroDraws = 0;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.id === 'netcanvas') window.heroDraws++;
      return clear.apply(this, args);
    };
  });
  await page.goto('/');
  const count = () => page.evaluate(() => window.heroDraws);
  await expect.poll(count).toBeGreaterThan(2);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  const offscreen = await count();
  await page.waitForTimeout(300);
  expect(await count()).toBe(offscreen);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(count).toBeGreaterThan(offscreen);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  const reduced = await count();
  await page.waitForTimeout(300);
  expect(await count()).toBe(reduced);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(count).toBeGreaterThan(reduced);
});
