import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unpackCheckpoint, packCheckpoint } from '../../src/scripts/pc/apps/linux-checkpoint.mjs';
const command = async (page, text) => { await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.type(text); await page.keyboard.press('Enter'); };
const screen = page => page.locator('.xterm-rows');
const shellReady = async page => expect.poll(async () => (await screen(page).textContent()).trim().endsWith('webpc:~#'), { timeout:10000 }).toBe(true);
const ready = async page => { await page.getByRole('button', { name: 'Start Linux', exact: true }).click(); await expect(page.getByRole('button', { name: 'Save session', exact: true })).toBeEnabled({ timeout: 120000 }); };

test('real Linux runs tools, interrupts processes, edits files and restores 9p changes after reload', async ({ page, baseURL }, testInfo) => {
 test.setTimeout(240000); page.on('dialog', dialog => dialog.accept());
 const external=[]; page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(baseURL).origin) external.push(request.url()); });
 await page.goto('/pc/apps/terminal/'); expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
 await page.evaluate(() => localStorage.setItem('pc:terminal:v1','legacy raw data to preserve')); await page.reload();
 await ready(page);
 await command(page,`uname -m; echo linux | tr a-z A-Z; python3 -c 'print("PY_"+str(6*7));print("UNICODE_"+"café λ")'; node -e 'console.log("NODE_"+(7*7))'`);
 await expect(screen(page)).toContainText('i686', { timeout: 20000 }); await expect(screen(page)).toContainText('LINUX'); await expect(screen(page)).toContainText('PY_42'); await expect(screen(page)).toContainText('UNICODE_café λ'); await expect(screen(page)).toContainText('NODE_49', { timeout: 20000 });
 // Repeated immediate interrupts exercise the allocator/emulator compatibility config.
 for(let cycle=0;cycle<8;cycle++) {
  await shellReady(page);
  await command(page,`sleep 30; echo NEVER_CYCLE${cycle}`);
  // Wait for tty echo (not for sleep to start), then interrupt immediately.
  await expect(screen(page)).toContainText(`sleep 30; echo NEVER_CYCLE${cycle}`);
  await page.getByRole('button', { name:'Send Control C', exact:true }).click(); await shellReady(page);
  await command(page,`printf 'INTERRUPT_%s\\n' CYCLE${cycle}`); await expect(screen(page)).toContainText(`INTERRUPT_CYCLE${cycle}`);
  await command(page,'nano /root/note.txt'); await expect(screen(page)).toContainText('GNU nano', { timeout: 15000 });
  if(cycle===0){await page.keyboard.type('nano persisted');await page.keyboard.press('Control+o');await page.keyboard.press('Enter');}
  await page.keyboard.press('Control+x'); await shellReady(page);
 }
 await command(page,`FAULTS=$(dmesg | grep -Ec 'BUG:|Oops:|general protection fault'); printf 'KERNEL_%s\\n' "$FAULTS"`); await expect(screen(page)).toContainText('KERNEL_0');
 await command(page,"printf BASE_CHANGED >> /etc/motd; printf NEW_FILE > /root/checkpoint.txt; sync; cat /root/note.txt"); await expect(screen(page)).toContainText('nano persisted');
 await page.setViewportSize({ width: 1000, height: 720 }); await page.getByRole('button', { name:'Fit guest', exact:true }).click(); await command(page,'stty size');
 await page.getByRole('button', { name:'Save session', exact:true }).click(); await expect(page.locator('#terminal-status')).toContainText('Saved in this browser', { timeout: 60000 });
 await page.reload(); await page.getByRole('button', { name:'Restore saved', exact:true }).click(); await expect(page.locator('#terminal-status')).toContainText('Checkpoint restored', { timeout: 60000 });
 await command(page,'cat /root/checkpoint.txt; tail -c 12 /etc/motd; cat /root/note.txt; echo RECOVERY_COMPLETE');
 await expect(screen(page)).toContainText('NEW_FILEBASE_CHANGEDnano persisted', { timeout: 10000 });
 expect(await page.evaluate(() => localStorage.getItem('pc:terminal:v1'))).toBe('legacy raw data to preserve');
 const pending=page.waitForEvent('download'); await page.getByRole('button',{name:'Export session',exact:true}).click(); const file=await pending; const path=testInfo.outputPath('linux.webpcvm'); await file.saveAs(path);
 const imageId=await page.evaluate(async()=> (await (await fetch('/pc/vendor/terminal/release.json')).json()).imageId);
 const parsed=await unpackCheckpoint(new Blob([await readFile(path)]),imageId); expect(parsed.header.rawBytes).toBeGreaterThan(1000000); expect(parsed.payload.size).toBeGreaterThan(1000000);
 await command(page,'rm /root/checkpoint.txt; sync'); await page.locator('#linux-backup').setInputFiles(path); await expect(page.locator('#terminal-status')).toContainText('Checkpoint restored', {timeout:60000});
 await command(page,'cat /root/checkpoint.txt; echo IMPORT_COMPLETE'); await expect(screen(page)).toContainText('NEW_FILEIMPORT_COMPLETE');
 // An import with a valid envelope but corrupt compressed payload cannot replace the guest.
 const damaged=packCheckpoint(parsed.header,new Blob(['corrupt gzip'])); await page.locator('#linux-backup').setInputFiles({name:'damaged.webpcvm',mimeType:'application/octet-stream',buffer:Buffer.from(await damaged.arrayBuffer())});
 await expect(page.locator('#terminal-status')).toContainText('checksum failed', {timeout:60000}); await command(page,'cat /root/checkpoint.txt; echo STILL_HERE'); await expect(screen(page)).toContainText('NEW_FILESTILL_HERE');
 await page.getByRole('button',{name:'Pause',exact:true}).click(); await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeEnabled(); await page.getByRole('button',{name:'Resume',exact:true}).click();
 expect(external).toEqual([]);
});

test('Linux start is lazy, failed storage remains exportable, legacy data and mobile keyboard survive', async ({page}) => {
 test.setTimeout(180000); page.on('dialog',dialog=>dialog.accept());
 const assets=[];page.on('request',request=>{if(request.url().includes('/rootfs/')||request.url().endsWith('v86.wasm'))assets.push(request.url());});
 await page.setViewportSize({width:375,height:812});await page.goto('/pc/apps/terminal/');await page.waitForTimeout(250);expect(assets).toEqual([]);
 await page.evaluate(()=>localStorage.setItem('pc:terminal:v1','broken legacy JSON'));await page.reload();await page.getByRole('button',{name:'Help',exact:true}).click();await expect(page.getByRole('button',{name:'Export legacy files',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Help',exact:true}).click();await ready(page);await command(page,'echo MOBILE_LINUX');await expect(screen(page)).toContainText('MOBILE_LINUX');
 await page.evaluate(()=>{IDBObjectStore.prototype.put=function(){throw new DOMException('full','QuotaExceededError');};});
 await page.getByRole('button',{name:'Save session',exact:true}).click();await expect(page.locator('#terminal-status')).toContainText('full',{timeout:60000});
 await expect(page.getByRole('button',{name:'Export session',exact:true})).toBeEnabled();await command(page,'echo AFTER_QUOTA');await expect(screen(page)).toContainText('AFTER_QUOTA');
 expect(await page.evaluate(()=>localStorage.getItem('pc:terminal:v1'))).toBe('broken legacy JSON');
 for(const theme of ['light','dark']){await page.evaluate(value=>window.postMessage({type:'pc:theme',theme:value},location.origin),theme);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});
