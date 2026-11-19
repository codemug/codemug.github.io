import { test, expect } from '@playwright/test';

const part = n => `/blog/sre-guide-deploying-llms-part-${n}/`;
const figure = (page, name) => page.locator(`figure.dk[data-fig="${name}"]`);

async function showSlide(page, id) {
  const fig = page.locator(`figure.dk:has(#${id})`);
  await expect.poll(() => fig.evaluate(el => Boolean(el.__dk))).toBe(true);
  await fig.scrollIntoViewIfNeeded();
  await fig.evaluate((el, slideId) => {
    const p = el.__dk;
    p.user();
    p.go(p.states.findIndex(([i, n]) => p.recs[i].id === slideId && n === 0));
  }, id);
  return fig;
}

test.beforeEach(async ({ page }) => {
  // These tests cover local illustrations, not third-party comments/analytics.
  await page.route(/^https:\/\/(?:giscus\.app|www\.googletagmanager\.com|www\.google-analytics\.com)\//, route => route.abort());
  page.on('pageerror', error => { throw error; });
});

test('dot-product rewind restores the original drawing on repeated visits', async ({ page }) => {
  await page.goto(part(1), { waitUntil: 'domcontentloaded' });
  const fig = await showSlide(page, 's07-dot-intro');
  const svg = page.locator('#s07-dot-intro svg.diagram');
  const original = await svg.innerHTML();
  for (let i = 0; i < 2; i++) {
    await fig.locator('.dk-next').click();
    await page.waitForTimeout(1100);
    expect(await svg.innerHTML()).not.toBe(original);
    await fig.locator('.dk-prev').click();
    await expect.poll(() => svg.innerHTML()).toBe(original);
  }
});

for (const delay of [200, 1100]) {
  test(`reversing layer-stack after ${delay}ms cancels the entire old animation`, async ({ page }) => {
    await page.goto(part(1), { waitUntil: 'domcontentloaded' });
    const fig = await showSlide(page, 's28-layers-repeat');
    await fig.locator('.dk-next').click();
    await page.waitForTimeout(delay);
    await fig.locator('.dk-prev').click();
    // Wait beyond BOTH the original fan-out and chained flow animation.
    await page.waitForTimeout(3400);
    await expect(page.locator('#s28-layers-repeat')).toHaveAttribute('data-cur', '0');
    await expect(page.locator('#s28-layers-repeat-full')).toHaveAttribute('opacity', '1');
    await expect(page.locator('#s28-layers-repeat-stack')).toHaveAttribute('opacity', '0');
  });
}

test('reduced motion presents the finished 3D vector, including preference changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(part(1), { waitUntil: 'domcontentloaded' });
  await showSlide(page, 's03-vec3d');
  await expect(page.locator('#s03-vec3d-c3')).toHaveText('3 numbers');
  await expect(page.locator('#s03-vec3d-n3')).toHaveCSS('opacity', '1');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#s03-vec3d-c3')).toHaveText('3 numbers');
  await expect(page.locator('#s03-vec3d-n3')).toHaveCSS('opacity', '1');
});

test('static SVG labels and bars follow repeated theme changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(part(2), { waitUntil: 'domcontentloaded' });
  const fig = await showSlide(page, 't703-fewer-bits');
  await fig.locator('.dk-next').click();
  await fig.locator('.dk-next').click();
  const error = page.locator('#t703-fewer-bits text.big').filter({ hasText: '0.10' });
  for (const theme of ['light', 'dark', 'light']) {
    await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
    const expected = await page.evaluate(() => getComputedStyle(document.body).color);
    await expect(error).toHaveCSS('fill', expected);
    const actual = await page.locator('#t703-fewer-bits .bar').first().evaluate(el => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-text-muted)';
      document.body.append(probe);
      const result = { fill: getComputedStyle(el).fill, expected: getComputedStyle(probe).color };
      probe.remove();
      return result;
    });
    expect(actual.fill).toBe(actual.expected);
  }
});

test('legacy frame buttons activate natively with Enter and Space', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/blog/gaming-pc-agent-platform/', { waitUntil: 'domcontentloaded' });
  const fig = page.locator('.fp.pr1');
  await fig.scrollIntoViewIfNeeded();
  await fig.getByRole('button', { name: 'Frame 2', exact: true }).press('Enter');
  await expect(fig).toHaveAttribute('data-frame', '2');
  await fig.getByRole('button', { name: 'Frame 3', exact: true }).press('Space');
  await expect(fig).toHaveAttribute('data-frame', '3');
  await fig.getByRole('button', { name: 'Previous frame' }).press('Space');
  await expect(fig).toHaveAttribute('data-frame', '2');
  await fig.getByRole('button', { name: 'Next frame' }).press('Enter');
  await expect(fig).toHaveAttribute('data-frame', '3');
  await expect(fig.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
});

test('legacy timers suspend offscreen and on motion changes, preserving user pause', async ({ page }) => {
  await page.goto('/blog/gaming-pc-agent-platform/', { waitUntil: 'domcontentloaded' });
  await page.clock.install();
  const fig = page.locator('.fp.pr1');
  await fig.scrollIntoViewIfNeeded();
  await expect(fig.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(fig.getByRole('button', { name: 'Play', exact: true })).toBeAttached();
  const stopped = await fig.getAttribute('data-frame');
  await page.clock.fastForward(5500);
  await expect(fig).toHaveAttribute('data-frame', stopped);
  await fig.scrollIntoViewIfNeeded();
  await expect(fig.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.clock.fastForward(2700);
  await expect(fig).not.toHaveAttribute('data-frame', stopped);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(fig.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  const reduced = await fig.getAttribute('data-frame');
  await page.clock.fastForward(5500);
  await expect(fig).toHaveAttribute('data-frame', reduced);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await fig.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await fig.scrollIntoViewIfNeeded();
  await page.clock.fastForward(5500);
  await expect(fig).toHaveAttribute('data-frame', reduced);
});

test('every included deck state renders without runtime errors; mobile expand closes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const n of [1, 2]) {
    await page.goto(part(n), { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.locator('figure.dk').evaluateAll(figs => figs.length > 0 && figs.every(fig => Boolean(fig.__dk)))).toBe(true);
    const result = await page.locator('figure.dk').evaluateAll(figs => {
      let states = 0;
      const problems = [];
      for (const fig of figs) {
        const p = fig.__dk;
        for (let k = 0; k < p.states.length; k++) {
          p.go(k);
          states++;
          if (+fig.dataset.state !== k || fig.querySelectorAll('.slide.visible').length !== 1) problems.push(fig.dataset.fig);
        }
      }
      return { figures: figs.length, states, problems };
    });
    expect(result).toEqual({ figures: n === 1 ? 29 : 41, states: n === 1 ? 175 : 188, problems: [] });
  }
  await page.setViewportSize({ width: 360, height: 800 });
  const fig = figure(page, 'p2-left-off');
  await fig.locator('.dk-expand').click();
  await expect(fig).toHaveClass(/is-expanded/);
  await page.keyboard.press('Escape');
  await expect(fig).not.toHaveClass(/is-expanded/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});
