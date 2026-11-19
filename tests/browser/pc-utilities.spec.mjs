import { test, expect } from '@playwright/test';

test('CyberChef runs the actual local Base64 operation without external loads', async ({page,baseURL}) => {
 const external=[];page.on('request',request=>{if(!request.url().startsWith(new URL(baseURL).origin)&&/^https?:/.test(request.url()))external.push(request.url());});
 await page.goto('/pc/apps/cyberchef/');await expect(page.locator('#cyberchef-loading')).toBeHidden({timeout:45000});
 const editor=page.frames().find(frame=>frame.url().includes('CyberChef_v11.5.0.html'));
 await editor.getByText('To Base64',{exact:true}).first().dblclick();
 await editor.locator('#input-text [contenteditable=true]').fill('Hello WebPC');
 await expect(editor.locator('#output-text .cm-content')).toHaveText('SGVsbG8gV2ViUEM=',{timeout:15000});
 expect(external).toEqual([]);
 await page.setViewportSize({width:375,height:812});
 await page.locator('#cyberchef-pane').selectOption('input');
 await editor.locator('#input-text [contenteditable=true]').fill('Mobile');
 await page.locator('#cyberchef-pane').selectOption('output');
 await expect(editor.locator('#output-text .cm-content')).toHaveText('TW9iaWxl');
 await expect(editor.locator('#output-text .cm-content')).toBeInViewport();
});

test('VS Code launch explicitly opens the real external app in a new tab', async ({page,context}) => {
 await context.route('https://vscode.dev/**',route=>route.fulfill({body:'External VS Code test target'}));
 await page.goto('/pc/');await page.getByRole('button',{name:'Apps',exact:true}).click();
 const pending=context.waitForEvent('page');await page.locator('[data-app-result=vscode]').click();const popup=await pending;await popup.waitForLoadState();expect(popup.url()).toBe('https://vscode.dev/');await expect(page.locator('[data-window=vscode]')).toHaveCount(0);await popup.close();
});

test('developer utilities and expanded launcher fit narrow screens', async ({page}) => {
 for(const width of [320,375,414,768]) {
  await page.setViewportSize({width,height:812});
  for(const app of ['terminal']){await page.goto(`/pc/apps/${app}/`);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await page.goto('/pc/');await page.getByRole('button',{name:'Apps',exact:true}).click();await expect(page.getByRole('searchbox',{name:'Search apps'})).toBeInViewport();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});
