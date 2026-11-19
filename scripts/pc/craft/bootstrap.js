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
 const soundcraft=id==='soundcraft';
 let enabled=false;
 const contexts=[],Original=window.AudioContext||window.webkitAudioContext;
 if(Original){
  // Track every context so closing a WebPC window can suspend it; the closed
  // iframe stays cached and must not keep playing.
  function AudioContext(options){
   const context=new Original(options);contexts.push(context);
   if(soundcraft){
    // SoundCraft stays suspended until WebPC's explicit Enable audio.
    const resume=context.resume.bind(context);
    if(!enabled)context.suspend().catch(()=>{});
    context.resume=()=>enabled?resume():Promise.resolve();
   }
   return context;
  }
  AudioContext.prototype=Original.prototype;Object.setPrototypeOf(AudioContext,Original);
  window.AudioContext=AudioContext;if(window.webkitAudioContext)window.webkitAudioContext=AudioContext;
 }
 window.webpcAudio={
  async resume(){if(soundcraft)enabled=true;const live=contexts.filter(c=>c.state!=='closed');await Promise.all(live.map(c=>c.resume()));return live.length>0&&live.every(c=>c.state==='running');},
  suspend(){if(soundcraft)enabled=false;for(const c of contexts)c.suspend().catch(()=>{});},
  states:()=>contexts.map(c=>c.state),
 };
 if(!soundcraft){
  // Other apps start audio from a gesture inside the editor, like the browser requires.
  const gesture=()=>{for(const c of contexts)if(c.state!=='closed'&&c.state!=='running')c.resume().catch(()=>{});};
  addEventListener('pointerdown',gesture,true);addEventListener('keydown',gesture,true);
 }
 if(soundcraft){
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
 }
 addEventListener('pagehide',()=>window.webpcAudio.suspend());
})();
