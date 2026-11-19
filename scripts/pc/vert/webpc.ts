import { tick } from 'svelte';
// WebPC lifecycle adapter. User files are not sent over postMessage or persisted here.
export function mountWebPC({ files, converters, setTheme }: any): () => void {
 let disposed=false;
 const active=()=>files.queueRunning || files.stopping || files.files.some((file:any)=>file.processing);
 const api={
  get ready(){return !disposed}, get active(){return active()}, get fileCount(){return files.files.length},
  setTheme(value:string){setTheme(value==='light'?'light':'dark')},
  async stop(){await files.stopConversions()},
  beforeClose(){return !active()},
 };
 (window as any).webpcVERT=api;
 const focus=()=>parent.postMessage({type:'vert:focus'},location.origin);
 const message=(event:MessageEvent)=>{if(event.source!==parent||event.origin!==location.origin)return;if(event.data?.type==='pc:theme')api.setTheme(event.data.theme)};
 const unload=(event:BeforeUnloadEvent)=>{if(files.files.length){event.preventDefault();event.returnValue=''}};
 document.addEventListener('pointerdown',focus,true);window.addEventListener('message',message);window.addEventListener('beforeunload',unload);
 void tick().then(()=>{if(disposed)return;document.documentElement.dataset.webpcReady='true';parent.postMessage({type:'vert:ready'},location.origin)});
 return ()=>{disposed=true;delete (window as any).webpcVERT;document.removeEventListener('pointerdown',focus,true);window.removeEventListener('message',message);window.removeEventListener('beforeunload',unload)};
}
