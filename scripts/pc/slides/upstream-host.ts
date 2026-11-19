// WebPC integration for the pinned, otherwise intact CasualOffice Slides app.
import { useEffect, useRef } from 'react';
import { ICommandService, IUniverInstanceService, UniverInstanceType, CommandType } from '@univerjs/core';
import { IEditorService } from '@univerjs/docs-ui';
import { ISlideEditorBridgeService } from '@univerjs/slides-ui';
import { DEFAULT_SLIDE_DATA } from './default-slide';
import { KEY, PREVIOUS, encodeBackup, decodeBackup, validateSnapshot } from './webpc-storage.mjs';

export { validateSnapshot } from './webpc-storage.mjs';

let startupError = '', lastSaved = '', active: any;
function notify(status: string, error = '') { parent.postMessage({type:'pc:slides-status',status,error},location.origin); }
export function readInitial(fallback: any) {
  try { const text = localStorage.getItem(KEY); if (text) { const snapshot=decodeBackup(text);lastSaved=text;return snapshot; } }
  catch (e) { startupError = `Stored data is unreadable or unavailable. It has been left untouched. ${String(e)}`; }
  return structuredClone(fallback);
}
function liveSnapshot(fallback: any) {
  const univer=(window as any).univer;
  if (!univer) return structuredClone(fallback);
  const injector=univer.__getInjector(), instances=injector.get(IUniverInstanceService);
  const model=instances.getCurrentUnitOfType(UniverInstanceType.UNIVER_SLIDE);
  const snapshot=structuredClone(model?.getSnapshot() ?? fallback);
  snapshot.title=fallback.title;
  // Text editing uses a temporary document unit until blur. Include its draft
  // in the saved copy without ending editing or moving the user's caret.
  const bridge=injector.get(ISlideEditorBridgeService);
  if (bridge.isVisible()) {
    const info=bridge.getEditorRect(), editor=instances.getUnit(bridge.getCurrentEditorId());
    const doc=editor?.getSnapshot?.() ?? info?.richTextObj?.documentData;
    const target=snapshot.body?.pages?.[info?.pageId]?.pageElements?.[info?.richTextObj?.oKey];
    if (target && doc?.body) target.richText={...target.richText,rich:structuredClone(doc),text:doc.body.dataStream.replace(/\r\n$/, '')};
  }
  return snapshot;
}
function save() {
  if (!active) return false;
  if (startupError) { notify('Not saved',startupError);return false; }
  try {
    const data=liveSnapshot(active.current.snapshot), text=encodeBackup(data);
    if (text!==lastSaved) localStorage.setItem(KEY,text);
    lastSaved=text;notify('Saved in this browser');return true;
  } catch (e) { notify('Not saved','Local save failed. Keep Slides open and export PPTX or a JSON backup. Browser storage may be full or blocked.');return false; }
}
export function beforeReplace(allowOpening = false) {
  if (!active || (active.current.opening && !allowOpening) || active.current.saving) return false;
  if (!confirm('Replace this presentation? The prior browser save will be kept under Recover previous.')) return false;
  try {
    if (!startupError && !save()) return false;
    const prior=localStorage.getItem(KEY);
    if(prior) localStorage.setItem(PREVIOUS,prior);
    startupError='';return true;
  } catch { notify('Not saved','Could not preserve the prior presentation. Export a backup before replacing it.');return false; }
}
export function useWebpcHost(snapshot:any,setSnapshot:(value:any)=>void,opening:boolean,saving:boolean) {
  const current=useRef({snapshot,setSnapshot,opening,saving}); current.current={snapshot,setSnapshot,opening,saving};active=current;
  useEffect(()=>{
    let disposed=false, timer:any, stop:any, queued=false; const deadline=Date.now()+20000;
    const schedule=()=>{if(!queued){queued=true;queueMicrotask(()=>{queued=false;if(!disposed)save();});}};
    function wire(){
      if(disposed)return;
      if(Date.now()>deadline){notify('Editor unavailable','The Slides editor did not initialize. Reload to retry; saved data is unchanged.');return;}
      const u=(window as any).univer;
      try {
        const model=u?.__getInjector().get(IUniverInstanceService).getCurrentUnitOfType(UniverInstanceType.UNIVER_SLIDE);
        if(!model || model.getUnitId()!==snapshot.id){timer=setTimeout(wire,40);return;}
        const commands=u.__getInjector().get(ICommandService);
        stop=commands.onCommandExecuted((info:any)=>{
          if(info.type===CommandType.MUTATION || (info.id.startsWith('slide.') && !['slide.operation.activate-slide','slide.operation.set-slide-page-thumb'].includes(info.id) && !info.id.includes('text-edit')))schedule();
        });
        (window as any).webpcSlides={
          snapshot:()=>liveSnapshot(current.current.snapshot), flush:save,
          replace:(next:any)=>{validateSnapshot(next);if(!beforeReplace())return false;setSnapshot({...next,id:`${next.id}-webpc-${crypto.randomUUID()}`});return true;},
          new:()=>{if(!beforeReplace())return;setSnapshot({...structuredClone(DEFAULT_SLIDE_DATA),id:`new-${crypto.randomUUID()}`});},
          recover:()=>{const text=localStorage.getItem(PREVIOUS);if(!text)throw new Error('No previous presentation is saved.');return (window as any).webpcSlides.replace(decodeBackup(text));},
        };
        save();parent.postMessage({type:'pc:ready',appId:'slides'},location.origin);
      }catch(e){notify('Opening editor…');timer=setTimeout(wire,100);}
    }
    wire();return()=>{disposed=true;clearTimeout(timer);stop?.dispose?.();};
  },[snapshot.id]);
  useEffect(()=>{if((window as any).webpcSlides)queueMicrotask(save);},[snapshot.title]);
  useEffect(()=>{
    const flush=()=>{if(current.current.opening||current.current.saving){notify('Busy','Wait for the current file operation to finish.');return false;}return save();};
    (window as any).pcBeforeClose=(window as any).pcFlush=flush;
    const unload=(event:BeforeUnloadEvent)=>{if(flush())event.stopImmediatePropagation();else{event.preventDefault();event.returnValue='';}};
    const pagehide=()=>{save();};
    const focus=()=>parent.postMessage({type:'pc:focus',appId:'slides'},location.origin);
    addEventListener('beforeunload',unload,true);addEventListener('pagehide',pagehide);document.addEventListener('pointerdown',focus,true);
    const input=()=>queueMicrotask(save);document.addEventListener('input',input);
    // The pinned EditorService caches its focused unit ID even after the DOM
    // focus moves to the slide canvas. Its focus(id) then returns early on
    // re-entry. Restore DOM focus through that actual editor only after the
    // native bridge has opened, preserving its text selection and undo state.
    let focusFrame=0;
    const restoreTextFocus=()=>{cancelAnimationFrame(focusFrame);focusFrame=requestAnimationFrame(()=>{
      try {const injector=(window as any).univer?.__getInjector();const bridge=injector?.get(ISlideEditorBridgeService);
        if(bridge?.isVisible() && document.activeElement?.tagName==='CANVAS')injector.get(IEditorService).getEditor(bridge.getCurrentEditorId())?.focus();
      }catch{/* Native editor may have closed before this animation frame. */}
    });};
    document.addEventListener('dblclick',restoreTextFocus);

    return()=>{removeEventListener('beforeunload',unload,true);removeEventListener('pagehide',pagehide);document.removeEventListener('pointerdown',focus,true);document.removeEventListener('input',input);document.removeEventListener('dblclick',restoreTextFocus);cancelAnimationFrame(focusFrame);};
  },[]);
}

export function useWebpcViewport(snapshot:any,zoom:number,setZoom:(value:number)=>void){
  const current=useRef(zoom);current.current=zoom;
  const previous=useRef<number|null>(null);
  useEffect(()=>{
    const resize=()=>{
      if(innerWidth<=600){
        if(previous.current===null)previous.current=current.current;
        setZoom(Math.max(10,Math.min(85,Math.floor((innerWidth-96)/snapshot.pageSize.width*100))));
      }else if(previous.current!==null){const value=previous.current;previous.current=null;setZoom(value);}
    };
    resize();const timer=setTimeout(resize,500);addEventListener('resize',resize);
    return()=>{clearTimeout(timer);removeEventListener('resize',resize);};
  },[snapshot.id,snapshot.pageSize.width]);
}
