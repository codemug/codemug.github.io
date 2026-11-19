// Small WebPC host seam, loaded before the unchanged official WASM/JS release.
(()=>{
 const id=document.documentElement.dataset.webpcApp;
 if(id==='lightcraft'){
   // The upstream OPFS reset clears the origin root. Its IDB mode scopes both
   // main thread and render workers to database lightcraft / object store files.
   const url=new URL(location.href);url.searchParams.set('store','idb');history.replaceState(null,'',url);
 }
 const post=data=>parent.postMessage(data,location.origin);
 document.addEventListener('pointerdown',()=>post({type:'pc:focus',appId:id}),true);
 if(id!=='soundcraft')return;
 let enabled=false;
 const contexts=[],Original=window.AudioContext||window.webkitAudioContext;
 if(Original){
   function AudioContext(options){const context=new Original(options),resume=context.resume.bind(context);contexts.push(context);if(!enabled)context.suspend().catch(()=>{});context.resume=()=>enabled?resume():Promise.resolve();return context;}
   AudioContext.prototype=Original.prototype;Object.setPrototypeOf(AudioContext,Original);
   window.AudioContext=AudioContext;if(window.webkitAudioContext)window.webkitAudioContext=AudioContext;
 }
 window.webpcAudio={
   async resume(){enabled=true;const live=contexts.filter(c=>c.state!=='closed');await Promise.all(live.map(c=>c.resume()));return live.length>0&&live.every(c=>c.state==='running');},
   suspend(){enabled=false;for(const c of contexts)c.suspend().catch(()=>{});},
   states:()=>contexts.map(c=>c.state),
 };
 // Keep native downloads intact, and deliver a copy of saved portable sessions.
 const click=HTMLAnchorElement.prototype.click;
 HTMLAnchorElement.prototype.click=function(){
   if(/\.scraftz$/i.test(this.download)&&this.href.startsWith('blob:')){
     const name=this.download;fetch(this.href).then(r=>r.arrayBuffer()).then(bytes=>post({type:'soundcraft:save',name,bytes})).catch(error=>post({type:'soundcraft:failed',error:String(error)}));
   }
   return click.call(this);
 };
 addEventListener('message',event=>{
   if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='soundcraft:open')return;
   const {name,bytes}=event.data;if(typeof name!=='string'||!(bytes instanceof ArrayBuffer))return;
   const transfer=new DataTransfer();transfer.items.add(new File([bytes],name));
   document.querySelector('canvas')?.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
 });
 const ready=setInterval(()=>{
   if(document.querySelector('canvas')&&!document.getElementById('soundcraft_loading')){clearInterval(ready);post({type:'soundcraft:ready',appVersion:'0.20.1'});}
 },100);
 addEventListener('pagehide',()=>window.webpcAudio.suspend());
})();
