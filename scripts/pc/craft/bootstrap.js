// Small WebPC host seam, loaded after the shared audio guard (webpc-audio-guard.js)
// and before the unchanged official WASM/JS release.
(()=>{
 const id=document.documentElement.dataset.webpcApp;
 const standalone=new URLSearchParams(location.search).has('standalone');
 if(id==='lightcraft'){
  // The upstream OPFS reset clears the origin root. Its IDB mode scopes both
  // main thread and render workers to database lightcraft / object store files.
  const url=new URL(location.href);url.searchParams.set('store','idb');history.replaceState(null,'',url);
 }
 const post=data=>parent.postMessage(data,location.origin);
 document.addEventListener('pointerdown',()=>post({type:'pc:focus',appId:id}),true);
 // The guard (injected first) already tracks every AudioContext this page creates.
 const guard=window.webpcAudio;
 if(id==='soundcraft'){
  // SoundCraft stays suspended until the wrapper's explicit Enable audio: wrap the
  // guard's constructors so every context is suspended at birth and cannot resume
  // itself (the app's own gesture resume stays blocked too).
  let enabled=false;
  for(const name of ['AudioContext','webkitAudioContext']){
   const Tracked=window[name];
   if(!Tracked)continue;
   class Gated extends Tracked{
    constructor(...args){
     super(...args);
     const resume=this.resume.bind(this);
     this.resume=()=>enabled?resume():Promise.resolve();
     if(!enabled)this.suspend().catch(()=>{});
    }
   }
   window[name]=Gated;
  }
  window.webpcAudio={
   ...guard,
   async resume(){enabled=true;return guard.resume();},
   suspend(){enabled=false;return guard.suspend();},
  };
 }else if(guard){
  // Other apps start audio from a gesture inside the editor, like the browser
  // requires: resume only what WebPC itself suspended, never app pausing.
  const gesture=()=>guard.resumeGuarded();
  addEventListener('pointerdown',gesture,true);addEventListener('keydown',gesture,true);
 }
 if(standalone){
  // No host protocol here: the wrapper hands over its copy rules (the native
  // document pattern), the documented open method, the loading element id and
  // the app version. The ready and dirty polls start only when that config
  // arrives, so an app whose loading element is not `${id}_loading` cannot
  // report ready early.
  let nativeRe=null,openMethod=null,appVersion=null;
  const fail=error=>post({type:`${id}:failed`,error});
  addEventListener('message',event=>{
   if(event.source!==parent||event.origin!==location.origin)return;
   const data=event.data;
   if(data?.type==='pc:standalone'){
    if(typeof data.native==='string')nativeRe=new RegExp(data.native,'i');
    openMethod=typeof data.open==='string'?data.open:null;
    if(typeof data.appVersion==='string')appVersion=data.appVersion;
    const loadingId=typeof data.loading==='string'?data.loading:`${id}_loading`;
    if(typeof data.dirty==='string'){
     // The wrapper's unload prompt is conservative (always ask) unless the app's
     // documented inspector reports a dirty flag, polled about once a second.
     let dirtyValue=null;
     const poll=()=>Promise.resolve().then(()=>window[id][data.dirty]()).then(result=>{
      const d=result?.dirty;
      if(typeof d==='boolean'&&d!==dirtyValue){dirtyValue=d;post({type:`${id}:dirty`,dirty:d});}
     },()=>{});
     setInterval(poll,1000);
    }
    const ready=setInterval(()=>{
     if(document.querySelector('canvas')&&!document.getElementById(loadingId)){clearInterval(ready);post({type:`${id}:ready`,appVersion});}
    },100);
    return;
   }
   if(data?.type!==`${id}:open`)return;
   const {name,bytes}=data;
   if(typeof name!=='string'||!(bytes instanceof ArrayBuffer)||!openMethod)return;
   // `drop` opens where the app's own drop path opens: a small y lands on the tab
   // bar, which PhotoCraft reads as "open" rather than "place on the canvas".
   if(openMethod==='drop'){
    const transfer=new DataTransfer();transfer.items.add(new File([bytes],name));
    document.querySelector('canvas')?.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientX:40,clientY:10,dataTransfer:transfer}));
    return;
   }
   // `addFile` takes a File plus a name; the other open methods take (name, bytes).
   const api=window[id]?.[openMethod];
   if(typeof api!=='function')return fail(`${id} has no ${openMethod} control yet; use its File menu instead.`);
   Promise.resolve(openMethod==='addFile'?api(new File([new Uint8Array(bytes)],name),name):api(name,new Uint8Array(bytes))).then(result=>{if(result===false)fail(`${id} did not accept ${name}; use its File menu instead.`);},error=>fail(String(error)));
  });
  // Native downloads stay intact; a download of the document's own format is
  // copied to WebPC's browser copy.
  const click=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
   if(nativeRe&&this.download&&nativeRe.test(this.download)&&this.href.startsWith('blob:')){
    const name=this.download;fetch(this.href).then(r=>r.arrayBuffer()).then(bytes=>post({type:`${id}:save`,name,bytes})).catch(error=>post({type:`${id}:failed`,error:String(error)}));
   }
   return click.call(this);
  };
 }
 addEventListener('pagehide',()=>guard?.suspend());
})();
