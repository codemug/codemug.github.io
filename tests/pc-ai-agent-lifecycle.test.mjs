import { test } from 'node:test';
import assert from 'node:assert/strict';
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
