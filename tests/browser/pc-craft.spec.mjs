import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import JSZip from 'jszip';
test.use({viewport:{width:1400,height:1000},launchOptions:{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}});
test.setTimeout(90000);
async function open(page,id){await page.goto(`/pc/apps/${id}/`,{waitUntil:'domcontentloaded'});await expect(page.locator('#open')).toBeEnabled({timeout:60000});return page.frames().find(f=>f.url().includes(`/vendor/${id}/`));}
async function saved(page,action){const waiting=page.waitForEvent('download');await action();const d=await waiting;return{name:d.suggestedFilename(),bytes:await readFile(await d.path())};}
const light=(frame,id,params={})=>frame.evaluate(async({id,params})=>JSON.parse(await lightcraft.command(id,JSON.stringify(params))),{id,params});
function wav(){const n=144000,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let j=0;j<n;j++)b.writeInt16LE(Math.sin(j*440*2*Math.PI/48000)*8000,44+j*2);return b;}

test('LightCraft imports, edits, exports and reloads its isolated library; reset preserves other apps',async({page})=>{
 page.on('dialog',d=>d.accept());const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).hostname!=='127.0.0.1')external.push(r.url());});
 let frame=await open(page,'lightcraft');await light(frame,'web.stats');await page.waitForTimeout(300);await page.mouse.click(780,595); // Native first-run welcome: Skip.
 await page.evaluate(async()=>{localStorage.setItem('pc:craft-isolation-sentinel','keep');const root=await navigator.storage.getDirectory(),file=await root.getFileHandle('webpc-other-app-sentinel',{create:true}),w=await file.createWritable();await w.write('other app work');await w.close();await new Promise((resolve,reject)=>{const r=indexedDB.open('webpc-other-app-sentinel',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>{const db=r.result,tx=db.transaction('data','readwrite');tx.objectStore('data').put('keep','sentinel');tx.oncomplete=()=>{db.close();resolve();};};r.onerror=()=>reject(r.error);});});
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.fillStyle='orange';x.fillRect(0,0,64,64);return c.toDataURL().split(',')[1];});
 await page.locator('#file').setInputFiles({name:'webpc-photo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await expect.poll(async()=>JSON.stringify(await light(frame,'catalog.query'))).toContain('webpc-photo.png');const photo=(await light(frame,'catalog.query')).photos.find(p=>p.fileName==='webpc-photo.png');
 await light(frame,'library.select',{ids:[photo.id],active:photo.id});await light(frame,'develop.set',{control:'light.exposure',value:0.7});
 await expect.poll(async()=>{const s=await light(frame,'web.stats');return s.storage==='idb'&&!s.dirty&&!s.flushing&&!s.saveError;}).toBe(true);
 const exported=await saved(page,()=>light(frame,'app.export',{path:'edited.png',format:'png',background:false}));expect(exported.bytes.subarray(1,4).toString()).toBe('PNG');
 const backup=await saved(page,()=>light(frame,'file.backupLibrary'));const zip=await JSZip.loadAsync(backup.bytes);expect(Object.keys(zip.files).some(x=>x.includes('originals/'))).toBe(true);expect(Object.keys(zip.files).some(x=>x.includes('catalog'))).toBe(true);
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.locator('#open')).toBeEnabled();frame=page.frames().find(f=>f.url().includes('/vendor/lightcraft/'));expect((await light(frame,'develop.get',{id:photo.id})).light.exposure).toBeCloseTo(0.7);
 await page.screenshot({path:'/tmp/webpc-lightcraft-final.png'});
 // Even direct vendor navigation omitting store=idb must never reach origin-wide OPFS reset.
 await frame.goto('/pc/vendor/lightcraft/index.html?host=parent&webgl&reset');await expect.poll(async()=>{try{return(await light(frame,'web.stats')).storage;}catch{return null;}}).toBe('idb');
 expect(await page.evaluate(()=>localStorage.getItem('pc:craft-isolation-sentinel'))).toBe('keep');expect(await page.evaluate(async()=>await(await(await navigator.storage.getDirectory()).getFileHandle('webpc-other-app-sentinel')).getFile().then(f=>f.text()))).toBe('other app work');
 expect(await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('webpc-other-app-sentinel');r.onsuccess=()=>{const db=r.result,g=db.transaction('data').objectStore('data').get('sentinel');g.onsuccess=()=>{db.close();resolve(g.result);};};}))).toBe('keep');expect(errors).toEqual([]);expect(external).toEqual([]);
});

test('FigCraft native design saves real files and browser copies; spoofed events and storage errors are safe',async({page})=>{
 page.on('dialog',d=>d.accept());let frame=await open(page,'figcraft');await frame.evaluate(async()=>{await figcraft.execute('file.new',{name:'WebPC design'});await figcraft.execute('shape.rectangle',{x:100,y:100,width:240,height:160,name:'Real rectangle'});});
 expect(await page.evaluate(()=>pcBeforeClose())).toBe(false);
 const file=await saved(page,async()=>{await frame.locator('canvas').click({position:{x:600,y:400}});await page.keyboard.press('ControlOrMeta+s');});expect(file.name).toMatch(/\.figcraft$/);await expect(page.locator('#status')).toContainText('browser copy saved');
 await page.evaluate(()=>window.postMessage({type:'figcraft:save',name:'spoof.figcraft',bytes:new ArrayBuffer(2)},location.origin));await expect(page.locator('#status')).not.toContainText('spoof');
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.locator('#restore')).toBeEnabled();frame=page.frames().find(f=>f.url().includes('/vendor/'));await page.locator('#restore').click();await expect.poll(async()=>JSON.stringify(await frame.evaluate(()=>figcraft.docInspect()))).toContain('Real rectangle');
 await page.screenshot({path:'/tmp/webpc-figcraft-final.png'});
 await page.evaluate(()=>{window.originalTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(this.name==='webpc-craft-saves-v1'&&args[1]==='readwrite')throw new DOMException('Full','QuotaExceededError');return window.originalTransaction.apply(this,args);};});
 await frame.evaluate(()=>figcraft.execute('shape.ellipse',{x:400,y:100,width:100,height:100,name:'Keep this edit'}));await saved(page,async()=>{await frame.locator('canvas').click({position:{x:700,y:400}});await page.keyboard.press('ControlOrMeta+s');});await expect(page.locator('#error')).toContainText('browser copy could not be saved');expect(await page.evaluate(()=>pcBeforeClose())).toBe(false);
 await page.evaluate(()=>IDBDatabase.prototype.transaction=window.originalTransaction);await page.locator('#retry').click();await expect(page.locator('#status')).toContainText('browser copy saved');expect(await page.evaluate(()=>pcBeforeClose())).toBe(true);
});

test('PDFCraft writes real PDF text, downloads and reopens its saved PDF',async({page})=>{
 let frame=await open(page,'pdfcraft');await frame.evaluate(()=>pdfcraft.execute('create.blank',{}));await frame.evaluate(()=>pdfcraft.execute('edit.text',{}));await frame.locator('canvas').click({position:{x:550,y:300}});await page.waitForTimeout(300);await page.keyboard.type('WebPC PDF text',{delay:35});await frame.locator('canvas').click({position:{x:850,y:400}});await page.waitForTimeout(200);
 const file=await saved(page,()=>frame.evaluate(()=>pdfcraft.execute('file.save',{})));expect(file.bytes.subarray(0,5).toString()).toBe('%PDF-');expect(file.bytes.toString('latin1')).toContain('WebPC PDF text');await expect(page.locator('#status')).toContainText('browser copy saved');
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.locator('#restore')).toBeEnabled();frame=page.frames().find(f=>f.url().includes('/vendor/'));await page.locator('#restore').click();await expect.poll(async()=>(await frame.evaluate(()=>pdfcraft.docInspect())).documents.length).toBe(1);await page.screenshot({path:'/tmp/webpc-pdfcraft-final.png'});
 expect((await saved(page,()=>page.locator('#download').click())).bytes.equals(file.bytes)).toBe(true);
});

test('SoundCraft plays actual imported audio, exports media bundle, restores it and suspends on close',async({page})=>{
 await page.addInitScript(()=>{const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(destination,...rest){if(destination===this.context.destination&&!(this instanceof AnalyserNode)){const analyser=this.context.createAnalyser();(window.webpcTestAnalysers??=[]).push(analyser);connect.call(analyser,destination);return connect.call(this,analyser,...rest);}return connect.call(this,destination,...rest);};});
 let frame=await open(page,'soundcraft');await page.locator('#file').setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wav()});await page.waitForTimeout(700);
 await frame.locator('canvas').click({position:{x:500,y:300}});expect(await frame.evaluate(()=>webpcAudio.states())).toEqual(['suspended']);
 // A constructor following a trusted gesture is gated too, not merely resume().
 await frame.evaluate(()=>window.webpcExtraAudio=new AudioContext());await expect.poll(()=>frame.evaluate(()=>webpcExtraAudio.state)).toBe('suspended');await frame.evaluate(()=>webpcExtraAudio.close());
 await page.locator('#audio').click();await expect(page.locator('#audio')).toHaveText('Pause audio');await frame.locator('canvas').click({position:{x:1205,y:47}});
 await expect.poll(()=>frame.evaluate(()=>{return Math.max(0,...(window.webpcTestAnalysers||[]).map(a=>{const samples=new Float32Array(a.fftSize);a.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs));}));})).toBeGreaterThan(0.01);
 await page.keyboard.press('Space');const file=await saved(page,async()=>{await page.keyboard.press('ControlOrMeta+s');await page.waitForTimeout(150);await page.keyboard.press('Enter');});const zip=await JSZip.loadAsync(file.bytes);expect(file.name).toMatch(/\.scraftz$/);expect(Object.keys(zip.files).some(x=>/Audio Files\/tone\.wav$/.test(x))).toBe(true);await expect(page.locator('#status')).toContainText('browser copy saved');
 // Native session replacement must ask before discarding a new import. Cancel keeps it.
 await page.locator('#file').setInputFiles({name:'second.wav',mimeType:'audio/wav',buffer:wav()});await page.waitForTimeout(400);await page.locator('#restore').click();await page.waitForTimeout(300);await frame.locator('canvas').press('Escape');await page.waitForTimeout(200);
 const kept=await saved(page,async()=>{await frame.locator('canvas').click({position:{x:500,y:400}});await page.keyboard.press('ControlOrMeta+s');});expect(Object.keys((await JSZip.loadAsync(kept.bytes)).files).some(x=>/Audio Files\/second\.wav$/.test(x))).toBe(true);
 expect(await page.evaluate(()=>pcBeforeClose())).toBe(true);await expect.poll(()=>frame.evaluate(()=>webpcAudio.states().filter(x=>x!=='closed'))).toEqual(['suspended']);await expect(page.locator('#audio')).toHaveText('Enable audio');
 page.on('dialog',d=>d.accept());await page.reload({waitUntil:'domcontentloaded'});await expect(page.locator('#restore')).toBeEnabled();frame=page.frames().find(f=>f.url().includes('/vendor/'));await page.locator('#restore').click();await page.waitForTimeout(500);
 const again=await saved(page,async()=>{await frame.locator('canvas').click({position:{x:500,y:300}});await page.keyboard.press('ControlOrMeta+s');});expect(Object.keys((await JSZip.loadAsync(again.bytes)).files).some(x=>/Audio Files\/tone\.wav$/.test(x))).toBe(true);await page.screenshot({path:'/tmp/webpc-soundcraft-final.png'});
});

test('Craft assets are lazy and the desktop caches SoundCraft while closing suspends audio',async({page})=>{
 const requests=[];page.on('request',r=>requests.push(r.url()));await page.goto('/pc/',{waitUntil:'domcontentloaded'});expect(requests.filter(x=>/\/vendor\/(lightcraft|figcraft|pdfcraft|soundcraft)\//.test(x))).toEqual([]);
 await page.locator('[data-shortcut="soundcraft"]').dblclick();const win=page.locator('[data-window="soundcraft"]');await expect(win).toHaveAttribute('data-load','ready',{timeout:60000});const outer=await win.locator('iframe').elementHandle().then(e=>e.contentFrame()),frame=page.frames().find(f=>f.url().includes('/vendor/soundcraft/'));
 await frame.evaluate(()=>window.webpcIdentity='same cached session');await outer.locator('#audio').click();await expect.poll(()=>frame.evaluate(()=>webpcAudio.states())).toEqual(['running']);
 await page.getByRole('button',{name:'Close SoundCraft',exact:true}).click();await expect(win).toBeHidden();await expect.poll(()=>frame.evaluate(()=>webpcAudio.states())).toEqual(['suspended']);
 await page.locator('[data-shortcut="soundcraft"]').dblclick();expect(await frame.evaluate(()=>window.webpcIdentity)).toBe('same cached session');await expect(outer.locator('#audio')).toHaveText('Enable audio');expect(requests.filter(x=>/\/vendor\/(lightcraft|figcraft|pdfcraft)\//.test(x))).toEqual([]);
 await page.setViewportSize({width:390,height:844});expect(await outer.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.screenshot({path:'/tmp/webpc-craft-mobile.png'});
});
