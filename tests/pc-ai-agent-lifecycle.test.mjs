import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AgentSession } from '../src/apps/ai-agent/session.js';
import { ModelClient } from '../src/apps/ai-agent/model-client.js';
import { ConversationStore, STORE_KEY, BACKUP_KEY, LEGACY_KEY } from '../src/apps/ai-agent/storage.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(client, overrides={}) {
 const events=[],saved=[]; const session=new AgentSession({client,store:{save:async value=>saved.push(structuredClone(value))},webSearch:async()=>({results:[]}),httpGet:async()=>({}),runJavaScript:async()=>({result:42}),emit:(...event)=>events.push(event),...overrides});return {session,events,saved};
}
test('late generation and tool replies cannot cross a new-chat boundary',async()=>{
 for(const phase of ['generate','tool']){
  const wait=deferred();let started=false;
  const client={ready:true,stop(){this.ready=false},count:async()=>100,generate:async()=>{started=true;return phase==='generate'?wait.promise:'<tool_call><function=run_javascript><parameter=code>6*7</parameter></function></tool_call>'}};
  const {session,events,saved}=setup(client,{runJavaScript:async()=>{started='tool';return wait.promise}});
  const sending=session.send('old chat');await tick();assert.equal(started,phase==='tool'?'tool':true);
  await session.newChat();wait.resolve(phase==='generate'?'old reply':{result:'old tool'});await sending;
  assert.deepEqual(session.history,[]);assert.deepEqual(saved.at(-1).history,[]);
  assert.equal(events.filter(([type])=>type==='tool-result').length,0);
 }
});
test('real calculate runs through agent tool loop, preserving Markdown and code',async()=>{
 const output=['<think>private</think><tool_call><function=calculate><parameter=expression>6*7</parameter></function></tool_call>','**42**\n```js\n6 * 7\n```'];
 const client={ready:true,stop(){},count:async()=>100,generate:async()=>output.shift()};const {session}=setup(client);await session.send('What is 6 times 7?');
 assert.equal(JSON.parse(session.history.find(m=>m.role==='tool').content).result,42);assert.match(session.history.at(-1).content,/\*\*42\*\*/);assert.match(session.history.at(-1).content,/```js/);
});
test('summary is transactional across cancellation and preserves recent tool pairs',async()=>{
 const wait=deferred();let calls=0;const client={ready:true,stop(){},count:async()=>5000,generate:async()=>++calls===1?'new reply':wait.promise};const {session}=setup(client);
 session.history=Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',content:`turn ${i}`}));
 const run=session.send('last turn');await tick();assert.equal(calls,2);await session.newChat();wait.resolve('old summary');await run;assert.deepEqual(session.history,[]);assert.equal(session.summary,'');
});
test('compaction works on cloud and Chrome clients: object replies and no onToken (review 1)',async()=>{
  const calls=[];
  const client={ready:true,stop(){},count:async()=>5000,generate:async(messages,schemas)=>{calls.push(schemas.length);return schemas.length?'Turn answer.':{text:'Compact notes.',toolCalls:[]}}};
  const {session,events}=setup(client);
  session.history=Array.from({length:6},(_,i)=>({role:i%2?'assistant':'user',content:i%2?`a${i}`:'q'.repeat(5000)}));
  await session.send('last turn');
  assert.equal(calls.at(-1),0,'the summarizer call offers no tools');
  assert.equal(session.summary,'Compact notes.','visibleText got the object reply, not a TypeError');
  assert.equal(session.history.length,4,'older turns condensed, the last two user turns kept');
  assert.ok(!events.some(([t])=>t==='error'),'no error event');
});
test('an attached image is dropped from stored history after the turn (review 8)',async()=>{
  const client={ready:true,stop(){},count:async()=>100,generate:async()=>'done'};
  const {session}=setup(client);
  const image={name:'p.png',width:2,height:2,data:new Uint8Array([1]),type:'image/png'};
  await session.send('look at this',image);
  const first=session.history.find((m)=>m.role==='user');
  assert.ok(first.content.includes('[image: p.png, 2×2]'),'the marker text stays in the history');
  assert.equal(first.image,undefined,'the image payload is dropped after the turn (stored/saved chats stay small)');
  assert.equal(session.history.filter((m)=>m.image).length,0,'no message keeps an image payload');
});
test('an unknown tool called with arguments reports the unknown tool, not a field error (review 15)',async()=>{
  const callText='\u003ctool_call\u003e\n\u003cfunction=frobnicate\u003e\n\u003cparameter=x\u003e\n1\n\u003c/parameter\u003e\n\u003c/function\u003e\n\u003c/tool_call\u003e';
  let round=0;
  const client={ready:true,stop(){},count:async()=>100,generate:async()=>++round===1?callText:'done'};
  const {session}=setup(client);
  await session.send('do it');
  const toolMsg=session.history.find((m)=>m.role==='tool');
  const error=JSON.parse(toolMsg.content).error;
  assert.match(error,/Unknown tool frobnicate/,'the tool is checked before validation');
  assert.ok(!error.includes('Unexpected field'),`no schema-field error for an unknown tool: ${error}`);
});
test('app.js: one Files channel, attach gated during a turn, pcFlush before the clears (reviews 14/16/19)',()=>{
  const src=readFileSync(new URL('../src/apps/ai-agent/app.js',import.meta.url),'utf8');
  assert.match(src,/const filesChangeChannel\s*=\s*typeof BroadcastChannel/,'one module-level Files channel');
  assert.ok(!/new BroadcastChannel\('webpc-files'\)\.postMessage/.test(src),'no per-save BroadcastChannel in the remove_background save');
  assert.ok(src.includes("filesChangeChannel?.postMessage({ type: 'changed' })"),'the save posts through the shared channel');
  assert.match(src,/\$\('attach'\)\.disabled\s*=\s*!box\.checked \|\| loading \|\| Boolean\(session\.active\)/,'the attach button is disabled while a turn is active');
  const body=src.slice(src.indexOf('window.pcBeforeClose'));
  assert.match(body,/if \(!window\.pcFlush\(\)\) return false;.*cloud\.clear\(\)/s,'pcFlush runs first and the clears happen only when it allows the close');
});
test('worker termination rejects prefill/download waiters and rejects stale events',async()=>{
 const workers=[];const client=new ModelClient({createWorker:()=>{const w={postMessage(data){this.sent=data},terminate(){this.terminated=true}};workers.push(w);return w}});
 const first=client.load('a');const rejected=assert.rejects(first,{name:'AbortError'});client.stop();await rejected;assert.ok(workers[0].terminated);
 const second=client.load('b');workers[0].onmessage({data:{type:'ready'}});assert.equal(client.ready,false);workers[1].onmessage({data:{type:'ready'}});await second;
 const pending=client.generate([],[]);const interrupted=assert.rejects(pending,{name:'AbortError'});client.stop();await interrupted;assert.equal(client.pending.size,0);
});
test('storage migration copies legacy, ordered saves stay ordered, quota keeps previous data',async()=>{
 const legacy={history:[{role:'user',content:'keep me'}],summary:''};const db=new Map([[LEGACY_KEY,legacy]]);let quota=false;
 const store=new ConversationStore({get:async key=>db.get(key),setMany:async entries=>{if(quota)throw new DOMException('Disk full','QuotaExceededError');for(const [k,v]of entries)db.set(k,structuredClone(v));}});
 assert.equal((await store.restore()).migrated,true);assert.deepEqual(db.get(LEGACY_KEY),legacy);
 const first=store.save({history:[{role:'user',content:'first'}],summary:''});const second=store.save({history:[],summary:''},{replace:true});await Promise.all([first,second]);assert.equal(db.get(BACKUP_KEY).history[0].content,'first');assert.equal(db.get(STORE_KEY).history.length,0);
 quota=true;await assert.rejects(store.save(legacy,{replace:true}),{name:'QuotaExceededError'});assert.equal(db.get(STORE_KEY).history.length,0);assert.equal(db.get(BACKUP_KEY).history[0].content,'first');assert.deepEqual(db.get(LEGACY_KEY),legacy);
});
test('malformed saved data is preserved until an explicit backed-up replacement',async()=>{
 const bad={history:'not an array'};const db=new Map([[STORE_KEY,bad]]);const store=new ConversationStore({get:async k=>db.get(k),setMany:async entries=>entries.forEach(([k,v])=>db.set(k,v))});
 await assert.rejects(store.restore());await assert.rejects(store.save({history:[],summary:''}));assert.equal(db.get(STORE_KEY),bad);
 await store.save({history:[],summary:''},{replace:true});assert.equal(db.get(BACKUP_KEY),bad);
});

test('an initial read failure blocks later writes even when storage recovers',async()=>{
 const original={history:[{role:'user',content:'important saved chat'}],summary:''};const db=new Map([[STORE_KEY,original]]);let readFails=true;
 const store=new ConversationStore({get:async key=>{if(readFails)throw new Error('Transient read failure');return db.get(key)},setMany:async entries=>entries.forEach(([k,v])=>db.set(k,v))});
 await assert.rejects(store.restore(),/Transient/);readFails=false;
 await assert.rejects(store.save({history:[{role:'user',content:'blank-start chat'}],summary:''}),/recovery/);assert.equal(db.get(STORE_KEY),original);
 await store.save({history:[],summary:''},{replace:true});assert.equal(db.get(BACKUP_KEY),original);
});
