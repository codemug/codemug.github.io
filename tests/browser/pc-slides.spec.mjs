import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
const KEY='pc:casual-slides:v1';
async function editor(page){await expect(page.locator('#backup')).toBeEnabled();const frame=page.frames().find(f=>f.url().includes('/vendor/slides/'));await expect(frame.locator('canvas').last()).toBeVisible();return frame;}
async function open(page){await page.goto('/pc/apps/slides/');return editor(page);}
const snapshot=frame=>frame.evaluate(()=>window.webpcSlides.snapshot());
async function text(page,frame,value){
 // Use the native canvas's slide coordinates; user input remains real mouse/keyboard.
 await frame.getByRole('button',{name:'Slide 1',exact:true}).click();
 await expect.poll(()=>frame.locator('canvas').count()).toBeGreaterThan(1);
 await page.waitForTimeout(300);

 const point=()=>frame.evaluate(()=>{const w=window,i=w.univer.__getInjector(),m=i.get(w.__casualSlides__IUniverInstanceService).getCurrentUnitOfType(3),s=m.getSnapshot(),r=i.get(w.__casualSlides__IRenderManagerService).getRenderById(m.getUnitId()),c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0].getBoundingClientRect(),el=Object.values(s.body.pages[s.body.pageOrder[0]].pageElements).find(e=>e.richText);const viewer=r.scene.getAllObjects().find(o=>o.classType==='SceneViewer'),v=r.scene._viewports[0],drawn=viewer.getActiveSubScene().getObject(el.id)||el;return{x:c.x+(viewer.left+drawn.left+drawn.width/2-v.viewportScrollX)*r.scene.scaleX,y:c.y+(viewer.top+drawn.top+drawn.height/2-v.viewportScrollY)*r.scene.scaleY};});
 const box=await frame.frameElement().then(e=>e.boundingBox());let pos=await point();await page.mouse.click(pos.x+box.x,pos.y+box.y);await page.waitForTimeout(500);pos=await point();await page.mouse.dblclick(pos.x+box.x,pos.y+box.y);
 await expect.poll(()=>frame.evaluate(()=>document.activeElement?.isContentEditable)).toBe(true);
 await page.keyboard.press('ControlOrMeta+a');await page.keyboard.type(value);
 await expect.poll(async()=>JSON.stringify(await snapshot(frame))).toContain(value);
}
async function download(page,click){const p=page.waitForEvent('download');await click();return readFile(await(await p).path());}
async function fixture(){const deck=new PptxGenJS();deck.title='Roundtrip';deck.layout='LAYOUT_WIDE';const slide=deck.addSlide();slide.addText('Native roundtrip',{x:1,y:1,w:8,h:1});slide.addImage({data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',x:2,y:3,w:1,h:1});return deck.write({outputType:'nodebuffer'});}

test('Casual Slides native typing, formatting, undo, slides and immediate draft reload stay local',async({page})=>{
 const external=[],errors=[];page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).hostname!=='127.0.0.1')external.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 let frame=await open(page);await text(page,frame,'Draft survives reload');await page.reload();frame=await editor(page);expect(JSON.stringify(await snapshot(frame))).toContain('Draft survives reload');
 await frame.getByRole('button',{name:'Slide 1',exact:true}).click();await text(page,frame,'Actual upstream editor');await page.keyboard.press('Escape');
 await frame.getByRole('button',{name:'Italic',exact:true}).click();await expect.poll(async()=>JSON.stringify(await snapshot(frame))).toContain('"it":1');
 await frame.getByRole('button',{name:'New slide',exact:true}).click();await expect.poll(async()=>(await snapshot(frame)).body.pageOrder.length).toBe(2);
 await frame.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await snapshot(frame)).body.pageOrder.length).toBe(1);expect(JSON.stringify(await snapshot(frame))).toContain('Actual upstream editor');
 await text(page,frame,'Editing after undo');
 // Let native rich-text resize callbacks run before checking lifecycle errors.
 await page.waitForTimeout(100);
 expect(external).toEqual([]);expect(errors).toEqual([]);
});

test('Casual Slides native PPTX text and image survive import, edit, reload and export',async({page})=>{
 page.on('dialog',d=>d.accept());let frame=await open(page);await frame.locator('input[type=file]').setInputFiles({name:'fixture.pptx',mimeType:'application/octet-stream',buffer:await fixture()});
 await expect.poll(async()=>JSON.stringify(await snapshot(frame))).toContain('Native roundtrip');await text(page,frame,'Edited imported text');await page.keyboard.press('Escape');
 await page.reload();frame=await editor(page);const value=await snapshot(frame);expect(JSON.stringify(value)).toContain('Edited imported text');expect(value.resources?.length).toBeGreaterThan(0);
 const bytes=await download(page,()=>frame.getByRole('button',{name:'Save',exact:true}).click()),zip=await JSZip.loadAsync(bytes);expect(await zip.file('ppt/slides/slide1.xml').async('string')).toContain('Edited imported text');expect(Object.keys(zip.files).filter(x=>/^ppt\/media\/.+png$/.test(x)).length).toBeGreaterThan(0);
});

test('Casual Slides JSON recovery, legacy export, malformed input and quota errors preserve work',async({page})=>{
 page.on('dialog',d=>d.accept());let frame=await open(page);await text(page,frame,'Keep this deck');await page.keyboard.press('Escape');
 const backup=await download(page,()=>page.locator('#backup').click());await frame.evaluate(()=>window.webpcSlides.new());await expect.poll(async()=>JSON.stringify(await snapshot(frame))).not.toContain('Keep this deck');
 await page.locator('#recover').click();await expect.poll(async()=>JSON.stringify(await snapshot(frame))).toContain('Keep this deck');
 const saved=await page.evaluate(k=>localStorage.getItem(k),KEY);await page.locator('#file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});await expect(page.locator('#error')).toBeVisible();expect(await page.evaluate(k=>localStorage.getItem(k),KEY)).toBe(saved);
 await page.locator('#file').setInputFiles({name:'deck.json',mimeType:'application/json',buffer:backup});await expect.poll(async()=>JSON.stringify(await snapshot(frame))).toContain('Keep this deck');
 await frame.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new DOMException('Quota full','QuotaExceededError');};});await text(page,frame,'Unsaved important draft');await expect(page.locator('#error')).toContainText('Local save failed');expect(await page.evaluate(()=>window.pcBeforeClose())).toBe(false);
 expect((await download(page,()=>page.locator('#backup').click())).toString()).toContain('Unsaved important draft');await frame.evaluate(()=>{Storage.prototype.setItem=window.originalSet;});await page.locator('#retry').click();await expect(page.locator('#status')).toHaveText('Saved in this browser');
 await page.evaluate(()=>localStorage.setItem('pc:slides:v1','{"legacy":"untouched"}'));await page.reload();frame=await editor(page);expect((await download(page,()=>page.locator('#legacy-download').click())).toString()).toBe('{"legacy":"untouched"}');
});

test('Casual Slides failed vendor load can close without touching existing data',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('pc:casual-slides:v1','existing data'));await page.route('**/pc/vendor/slides/assets/index-*.js',route=>route.abort());await page.goto('/pc/apps/slides/');await expect(page.locator('#error')).toContainText('did not load',{timeout:25000});expect(await page.evaluate(()=>window.pcBeforeClose())).toBe(true);expect(await page.evaluate(k=>localStorage.getItem(k),KEY)).toBe('existing data');
});

test('Casual Slides inserts a native shape and preserves the same editor across desktop resize and reopen',async({page})=>{
 await page.goto('/pc/');await page.locator('[data-shortcut="slides"]').dblclick();const win=page.locator('[data-window="slides"]');await expect(win).toHaveAttribute('data-load','ready');
 const outer=await win.locator('iframe').elementHandle().then(e=>e.contentFrame());let frame=page.frames().find(f=>f.url().includes('/vendor/slides/'));
 const id=(await snapshot(frame)).id;await frame.getByRole('button',{name:'Slide 1',exact:true}).click();await expect.poll(()=>frame.locator('canvas').count()).toBeGreaterThan(1);await page.waitForTimeout(300);await frame.getByRole('toolbar').getByRole('button',{name:'Insert',exact:true}).click();await frame.getByRole('menuitem',{name:'Rectangle',exact:true}).click();const box=await frame.frameElement().then(e=>e.boundingBox());const rect=await frame.evaluate(()=>{const w=window,i=w.univer.__getInjector(),m=i.get(w.__casualSlides__IUniverInstanceService).getCurrentUnitOfType(3),r=i.get(w.__casualSlides__IRenderManagerService).getRenderById(m.getUnitId()),c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0].getBoundingClientRect(),viewer=r.scene.getAllObjects().find(o=>o.classType==='SceneViewer'),v=r.scene._viewports[0];return{x:c.x+(viewer.left+150-v.viewportScrollX)*r.scene.scaleX,y:c.y+(viewer.top+150-v.viewportScrollY)*r.scene.scaleY,width:150*r.scene.scaleX,height:100*r.scene.scaleY};});await page.mouse.move(box.x+rect.x,box.y+rect.y);await page.mouse.down();await page.mouse.move(box.x+rect.x+rect.width,box.y+rect.y+rect.height,{steps:8});await page.mouse.up();
 await expect.poll(async()=>Object.values((await snapshot(frame)).body.pages['page-1'].pageElements).length).toBe(3);
 await page.getByRole('button',{name:'Maximize Slides',exact:true}).click();await page.waitForTimeout(200);expect((await snapshot(frame)).id).toBe(id);await page.getByRole('button',{name:'Restore Slides',exact:true}).click();
 await page.getByRole('button',{name:'Close Slides',exact:true}).click();await expect(win).toBeHidden();await page.locator('[data-shortcut="slides"]').dblclick();expect((await snapshot(frame)).id).toBe(id);
 await page.setViewportSize({width:390,height:844});await expect(win).toHaveAttribute('data-maximized','true');expect(await outer.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await expect.poll(async()=>Number(await frame.getByRole('slider',{name:'Zoom',exact:true}).inputValue())).toBeLessThanOrEqual(35);await frame.locator('.cs-format-pane__close').click();await expect.poll(async()=>Number(await frame.getByRole('slider',{name:'Zoom',exact:true}).inputValue())).toBeLessThanOrEqual(35);await page.waitForTimeout(750);await page.screenshot({path:'/tmp/webpc-casual-slides-mobile.png'});await page.setViewportSize({width:1400,height:1000});await page.getByRole('button',{name:'Maximize Slides',exact:true}).click();await page.waitForTimeout(750);await page.screenshot({path:'/tmp/webpc-casual-slides-desktop.png'});
});

test('Casual Slides rejects bad PPTX, reports worker network failure and protects corrupt stored bytes',async({page})=>{
 let frame=await open(page);const saved=await page.evaluate(k=>localStorage.getItem(k),KEY);await frame.locator('input[type=file]').setInputFiles({name:'broken.pptx',mimeType:'application/octet-stream',buffer:Buffer.from('not a ZIP')});await expect(frame.locator('.cs-titlebar__pill--error')).toBeVisible();expect(await page.evaluate(k=>localStorage.getItem(k),KEY)).toBe(saved);
 await page.reload();frame=await editor(page);await page.route('**/pc/vendor/slides/assets/worker-*.js',route=>route.abort());await frame.getByRole('button',{name:'Save',exact:true}).click();await expect(frame.locator('.cs-titlebar__pill--error')).toBeVisible();expect(await page.evaluate(()=>window.pcBeforeClose())).toBe(true);await page.unroute('**/pc/vendor/slides/assets/worker-*.js');const retried=await download(page,()=>frame.getByRole('button',{name:'Save',exact:true}).click());expect((await JSZip.loadAsync(retried)).file('ppt/presentation.xml')).toBeTruthy();
 await page.evaluate(k=>localStorage.setItem(k,'{corrupt'),KEY);await page.reload();frame=await editor(page);await expect(page.locator('#error')).toContainText('left untouched');expect(await page.evaluate(k=>localStorage.getItem(k),KEY)).toBe('{corrupt');expect((await download(page,()=>page.locator('#raw').click())).toString()).toBe('{corrupt');expect(await page.evaluate(()=>window.pcBeforeClose())).toBe(false);
});
