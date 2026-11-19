import { test, expect } from '@playwright/test';
const route = process.env.AI_AGENT_TEST_PATH ?? '/pc/apps/ai-agent/';
// Only the model is deterministic in these integration tests. Tools, worker lifecycle,
// IndexedDB and DOM are real. The separate manual smoke runs actual model weights.
async function modelFixture(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) } });
    window.voiceCalls = [];
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition', 'SpeechSynthesisUtterance']) window[name] = function () { window.voiceCalls.push(name); throw new Error('Voice is forbidden'); };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.voiceCalls.push('microphone'); throw new Error('Voice is forbidden'); };
    const NativeWorker = Worker; window.workers = [];
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); window.workers.push(this); } terminate() { this.wasTerminated = true; super.terminate(); } };
  });
  await page.route('**/worker.js', intercepted => intercepted.fulfill({ contentType: 'text/javascript', body: `
    onmessage = ({data}) => {
      if(data.type==='load') return setTimeout(()=>postMessage({type:'ready',key:data.key}),100);
      if(data.type==='count') return postMessage({type:'counted',id:data.id,tokens:100});
      if(data.type==='generate') {
        const user=data.messages.findLast(m=>m.role==='user').content;
        if(user.includes('HOLD')) return setTimeout(()=>postMessage({type:'done',id:data.id,text:'STALE ANSWER'}),2000);
        const last=data.messages.at(-1);
        const reply=last.role==='tool'?'**42**\\n\`\`\`js\\n6 * 7\\n\`\`\`':user.includes('calculate')?'<tool_call><function=calculate><parameter=expression>6*7</parameter></function></tool_call>':'A local answer.';
        postMessage({type:'token',id:data.id,text:'<think>private</think>'+reply});
        postMessage({type:'done',id:data.id,text:'<think>private</think>'+reply});
      }
    };` }));
}
async function load(page) { await page.locator('#load-model').click(); await expect(page.locator('#send')).toBeEnabled(); }
async function send(page, text) { await page.locator('#message').fill(text); await page.locator('#send').click(); }

test('AI Agent is lazy, migrates legacy records without deleting them, and handles missing WebGPU', async ({ page }) => {
  const requests=[]; page.on('request',r=>requests.push(r.url()));
  await page.addInitScript(() => Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined}));
  await page.goto(route);
  await page.evaluate(async () => {
    const {set}=await import(new URL('vendor/idb-keyval.js',document.baseURI));
    await set('voice-agent:conversation',{history:[{role:'user',content:'legacy text'},{role:'assistant',content:'**kept**'}],summary:''});
    localStorage.setItem('voice-agent:model','qwen3.5-0.8b');
  });
  await page.reload(); await expect(page.locator('#messages')).toContainText('legacy text'); await expect(page.locator('#messages')).toContainText('**kept**');
  await expect(page.locator('#model')).toHaveValue('qwen3.5-0.8b');
  expect(requests.some(url=>/huggingface|\.wasm|worker\.js|transformers\.min/.test(url))).toBe(false);
  await page.locator('#load-model').click(); await expect(page.locator('#error')).toContainText('WebGPU is unavailable');
  const legacy=await page.evaluate(async()=> (await import(new URL('storage.js',document.baseURI))).ConversationStore.prototype.raw.call(new (await import(new URL('storage.js',document.baseURI))).ConversationStore()));
  expect(legacy.legacy.history[0].content).toBe('legacy text');expect(legacy.current.history[0].content).toBe('legacy text');
  const downloaded=page.waitForEvent('download');await page.locator('#export').click();expect((await downloaded).suggestedFilename()).toBe('ai-agent-conversation.json');
});

test('AI Agent executes a real calculation, preserves Markdown, persists and isolates New chat', async ({ page }) => {
  await modelFixture(page);page.on('dialog',d=>d.accept());await page.goto(route);
  expect(await page.evaluate(()=>window.workers.length)).toBe(0);await load(page);await send(page,'calculate 6*7');
  await expect(page.locator('#messages')).toContainText('calculate · complete');await expect(page.locator('.assistant .message-body').last()).toContainText('**42**');await expect(page.locator('.assistant .message-body').last()).toContainText('```js');
  await expect(page.locator('#messages')).not.toContainText('private');await expect(page.locator('#send')).toBeEnabled();
  await page.reload();await expect(page.locator('#messages')).toContainText('**42**');await load(page);await send(page,'HOLD prefill');await expect(page.locator('#model-state')).toContainText('Working');
  await page.locator('#new-chat').click();await expect(page.locator('#messages')).toBeEmpty();await page.waitForTimeout(2200);await expect(page.locator('#messages')).toBeEmpty();
  expect(await page.evaluate(()=>window.workers.every(w=>w.wasTerminated))).toBe(true);expect(await page.evaluate(()=>window.voiceCalls)).toEqual([]);
  await page.reload();await expect(page.locator('#messages')).toBeEmpty();
});

test('AI Agent stops download and prefill, and model switching terminates the old worker', async ({ page }) => {
  await modelFixture(page);await page.goto(route);await page.locator('#load-model').click();await page.locator('#stop').click();await page.waitForTimeout(200);
  await expect(page.locator('#send')).toBeDisabled();await load(page);await send(page,'HOLD prompt');await page.locator('#stop').click();await expect(page.locator('#send')).toBeDisabled();
  await load(page);await send(page,'HOLD another prompt');await page.locator('#model').selectOption('qwen3.5-2b');await page.waitForTimeout(2200);
  await expect(page.locator('#messages')).not.toContainText('STALE ANSWER');expect(await page.evaluate(()=>window.workers.every(w=>w.wasTerminated))).toBe(true);
});

test('AI Agent sandbox executes JavaScript, blocks network and parent access, ignores forged messages and cancels loops', async ({ page }) => {
  await page.goto(route);let external=0;await page.route('https://sandbox-test.invalid/**',r=>{external++;return r.abort()});
  const results=await page.evaluate(async()=>{
    const {runJavaScript}=await import(new URL('sandbox.js',document.baseURI));
    const calculated=await runJavaScript('console.log("real sandbox"); return 6*7');
    const network=await runJavaScript('await fetch("https://sandbox-test.invalid/private"); return "leaked"');
    const dom=await runJavaScript('return parent.document.body.innerText');
    const controller=new AbortController();const pending=runJavaScript('while(true){}',{signal:controller.signal});
    window.postMessage({ok:true,result:'FORGED'},location.origin);setTimeout(()=>controller.abort(),100);const cancelled=await pending;
    return {calculated,network,dom,cancelled,frames:document.querySelectorAll('iframe').length};
  });
  expect(results.calculated).toEqual({result:'42',logs:['real sandbox']});expect(results.network.error).toBeTruthy();expect(results.dom.error).toBeTruthy();expect(results.cancelled.error).toBe('Cancelled');expect(results.frames).toBe(0);expect(external).toBe(0);
});

test('AI Agent direct page reading and Wikipedia work; Jina requires opt-in and cancellation never invokes it', async ({ page }) => {
  await page.goto(route);let proxy=0,unwanted=0;
  await page.route('https://example.org/**',r=>r.abort());
  await page.route('https://r.jina.ai/**',r=>{proxy++;return r.fulfill({contentType:'text/plain',body:'<article><h1>Proxy result</h1><p>Useful content.</p></article>'})});
  await page.route('https://en.wikipedia.org/w/rest.php/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({pages:[{title:'Computer',key:'Computer',excerpt:'An <b>electronic</b> machine'}]})}));
  await page.route('https://article.example/**',r=>r.fulfill({contentType:'text/html',body:'<article><h1>Real article</h1><p>'+('A useful technical explanation. '.repeat(30))+'</p><img src="https://tracker.invalid/pixel"><script>window.INJECTED=true</script></article>'}));
  await page.route('https://tracker.invalid/**',r=>{unwanted++;return r.abort()});
  const result=await page.evaluate(async()=>{const web=await import(new URL('web.js',document.baseURI));let denied;try{await web.httpGet('https://example.org/a')}catch(e){denied=e.message}return {denied,search:await web.webSearch('computer'),article:await web.httpGet('https://article.example/a')};});
  expect(result.denied).toContain('proxy is off');expect(proxy).toBe(0);expect(result.search.results[0].title).toBe('Computer');expect(result.article.content).toContain('technical explanation');expect(await page.evaluate(()=>window.INJECTED)).toBeUndefined();expect(unwanted).toBe(0);
  const allowed=await page.evaluate(async()=> (await import(new URL('web.js',document.baseURI))).httpGet('https://example.org/a',{allowReaderProxy:true}));expect(allowed.source).toBe('jina');expect(proxy).toBe(1);
  await page.evaluate(async()=>{const c=new AbortController();c.abort();try{await(await import(new URL('web.js',document.baseURI))).httpGet('https://example.org/b',{signal:c.signal,allowReaderProxy:true})}catch{}});expect(proxy).toBe(1);
  await page.locator('#settings').click();await expect(page.locator('#reader-proxy')).not.toBeChecked();
});

test('AI Agent quota errors keep saved data and let the current chat export; invalid imports are non-destructive', async ({ page }) => {
  await modelFixture(page);await page.goto(route);await load(page);await send(page,'first saved');await expect(page.locator('#send')).toBeEnabled();
  await page.evaluate(()=>{IDBObjectStore.prototype.put=function(){throw new DOMException('Test quota exhausted','QuotaExceededError')}});
  await send(page,'second in memory');await expect(page.locator('#storage-warning')).toContainText('Test quota exhausted');await expect(page.locator('#send')).toBeEnabled();
  const stored=await page.evaluate(async()=> (await import(new URL('vendor/idb-keyval.js',document.baseURI))).get('pc:ai-agent:conversation:v1'));expect(stored.history.some(m=>m.content==='second in memory')).toBe(false);
  const exporting=page.waitForEvent('download');await page.locator('#export').click();await exporting;
  await page.locator('#settings').click();await page.locator('#file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"history":"broken"}')});
  await expect(page.locator('#error')).toContainText('Backup was not opened');await expect(page.locator('#messages')).toContainText('second in memory');
});

test('AI Agent mobile controls fit, theme messages are source-checked, and keyboard settings close restores focus', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});await page.goto(route);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect.poll(()=>page.locator('#conversation').evaluate(el=>el.scrollTop)).toBe(0);
  await page.locator('#settings').click();await expect(page.locator('#settings-dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#settings-dialog')).not.toBeVisible();await expect(page.locator('#settings')).toBeFocused();
  await page.evaluate(()=>window.postMessage({type:'pc:theme',theme:'light'},location.origin));await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.evaluate(()=>window.postMessage({type:'pc:theme',theme:'dark'},location.origin));await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});

test('AI Agent close hooks stop cached inference and block unsaved close until retry or export', async ({ page }) => {
  await modelFixture(page);await page.goto(route);await load(page);await send(page,'HOLD before close');
  await expect.poll(()=>page.evaluate(()=>window.pcBeforeClose())).toBe(true);expect(await page.evaluate(()=>window.workers.every(w=>w.wasTerminated))).toBe(true);
  await page.waitForTimeout(2200);await expect(page.locator('#messages')).not.toContainText('STALE ANSWER');
  await load(page);await page.evaluate(()=>{IDBObjectStore.prototype.put=function(){throw new DOMException('Quota exhausted','QuotaExceededError')}});
  await send(page,'unsaved before close');await expect(page.locator('#send')).toBeEnabled();expect(await page.evaluate(()=>window.pcBeforeClose())).toBe(false);
  await expect(page.locator('#error')).toContainText('Export before closing');const downloading=page.waitForEvent('download');await page.locator('#export').click();await downloading;expect(await page.evaluate(()=>window.pcBeforeClose())).toBe(true);
});

test('WebPC launches AI Agent, preserves it when minimized, applies theme and stops it on cached close', async ({ page }) => {
  await modelFixture(page);await page.goto('/pc/');await page.locator('[data-shortcut="ai-agent"]').dblclick();
  const app=page.frameLocator('iframe[title="AI Agent"]');await expect(app.getByRole('heading',{name:'AI Agent',exact:true})).toBeVisible();
  await app.locator('#load-model').click();await expect(app.locator('#send')).toBeEnabled();await app.locator('#message').fill('HOLD during desktop controls');await app.locator('#send').click();await expect(app.locator('.assistant .message-body')).toBeVisible();
  const frame=page.frames().find(frame=>frame.url().includes('/pc/apps/ai-agent/'));
  await page.getByRole('button',{name:'Minimize AI Agent',exact:true}).click();expect(await frame.evaluate(()=>window.workers.every(w=>!w.wasTerminated))).toBe(true);
  await page.getByRole('button',{name:'Switch to AI Agent',exact:true}).click();
  const initialTheme=await app.locator('html').getAttribute('data-theme');await page.locator('[data-theme-toggle]').click();await expect(app.locator('html')).toHaveAttribute('data-theme',initialTheme==='light'?'dark':'light');
  await page.getByRole('button',{name:'Close AI Agent',exact:true}).click();await expect(page.locator('[data-window="ai-agent"]')).toBeHidden();expect(await frame.evaluate(()=>window.workers.every(w=>w.wasTerminated))).toBe(true);
  await page.locator('[data-shortcut="ai-agent"]').dblclick();await expect(app.locator('#send')).toBeDisabled();await page.waitForTimeout(2200);await expect(app.locator('#messages')).not.toContainText('STALE ANSWER');
});
