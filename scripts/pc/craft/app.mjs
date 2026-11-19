import {releases,nativeFile,nativeSource,validSave} from './releases.mjs';
import {storedFile} from './storage.mjs';
import * as store from '../../../src/scripts/pc/files/store.mjs';
import {pickFile} from '../../../src/scripts/pc/files/picker.mjs';
const $=id=>document.getElementById(id),id=document.body.dataset.app,config=releases[id],frame=$('editor'),standalone=config.mode==='standalone',noDirty=standalone&&!config.dirty;
let ready=false,dirty=false,pending=0,saveError=false,lastFile=null;
const status=text=>$('status').textContent=text;
const error=text=>{$('error').textContent=text;$('error').hidden=!text;};
function download(name,bytes){const url=URL.createObjectURL(new Blob([bytes])),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function post(type,fields={}){frame.contentWindow.postMessage({type:`${id}:${type}`,...fields},location.origin);}
function pause(){frame.contentWindow?.webpcAudio?.suspend();if(id==='soundcraft')$('audio').textContent='Enable audio';}
async function keep(file){
 lastFile=file;pending++;$('download').disabled=false;$('retry').disabled=false;$('savecopy').disabled=false;
 try{await storedFile(id,'write',file);saveError=false;error('');$('restore').disabled=false;status(`Downloaded · browser copy saved: ${file.name}`);}
 catch(e){saveError=true;error(`The file downloaded, but its browser copy could not be saved: ${e.message}. Keep the download. You can retry the browser copy.`);status('Browser copy failed');}
 finally{pending--;}
}
storedFile(id,'read').then(file=>{if(validSave(file)){lastFile=file;$('download').disabled=false;$('retry').disabled=false;$('savecopy').disabled=false;if(ready)$('restore').disabled=false;}}).catch(e=>error(`Browser copies unavailable: ${e.message}. Native file downloads still work.`));
const timeout=setTimeout(()=>{if(!ready){error(`${config.title} did not start. This app needs WebAssembly and WebGL2. Reload to retry.`);status('Unable to start');}},60000);
addEventListener('message',event=>{
 if(event.origin!==location.origin)return;
 if(event.source===parent&&event.data?.type==='pc:theme'){document.documentElement.dataset.theme=event.data.theme;return;}
 if(event.source!==frame.contentWindow)return;
 const message=event.data;
 if(message?.type==='pc:focus'){parent.postMessage({type:'pc:focus',appId:id},location.origin);return;}
 if(message?.type===`${id}:ready`){ready=true;clearTimeout(timeout);$('open').disabled=false;$('openfiles').disabled=false;$('restore').disabled=!lastFile;$('audio').disabled=false;status(id==='lightcraft'?'Library saves in this browser':id==='soundcraft'?'Export .scraftz to keep your session':'Save in the editor to download and keep a browser copy');parent.postMessage({type:'pc:ready',appId:id},location.origin);}
 if(message?.type===`${id}:dirty`&&typeof message.dirty==='boolean'){dirty=message.dirty;if(dirty)status(id==='lightcraft'?'Saving library…':'Unsaved changes — use the editor’s Save');else if(id==='lightcraft')status('Library saved in this browser');}
 if(message?.type===`${id}:failed`){error(String(message.error||'The editor reported an error.'));}
 if(message?.type===`${id}:save`){
   if(!validSave(message)){error('The editor returned an invalid save. Keep the window open.');saveError=true;return;}
   try{if(id!=='soundcraft')download(message.name,message.bytes);status(`Downloaded: ${message.name}`);if(nativeFile(id,message.name,message.bytes))void keep({name:message.name,bytes:message.bytes});}
   catch(e){saveError=true;error(`Download failed: ${e.message}. Keep this window open.`);}
 }
});
function openFile(file){if(dirty&&!confirm('Open this file while the current document has unsaved changes? Save it first to keep those edits.'))return;post('open',file);status(`Opened: ${file.name}`);}
async function openBytes(name,bytes){if(bytes.byteLength>256*1024*1024)throw new Error('Open files up to 256 MB.');openFile({name,bytes});}
$('open').onclick=()=>$('file').click();
$('file').onchange=async()=>{const file=$('file').files[0];$('file').value='';if(!file)return;try{await openBytes(file.name,await file.arrayBuffer());}catch(e){error(e.message);}};
$('openfiles').onclick=async()=>{try{const picked=await pickFile({accept:config.accept||'',title:`Open ${config.title} file from Files`});if(picked)await openBytes(picked.name,picked.bytes);}catch(e){error(e.message);}};
$('restore').onclick=()=>{if(lastFile)openFile(lastFile);};
$('download').onclick=()=>{if(lastFile)download(lastFile.name,lastFile.bytes);};
$('retry').onclick=()=>{if(lastFile)void keep(lastFile);};
async function saveCopy(){
 if(!lastFile)return;
 const folder=config.title,name=lastFile.name;
 const problem=store.validateName(folder)||store.validateName(name);
 if(problem){error(`Cannot save to Files: ${problem}`);return;}
 try{
  const folderThere=await store.exists('',folder);
  if(folderThere==='file'){error(`Files storage has a file named "${folder}". Remove it in the Files app first.`);return;}
  const fileThere=folderThere==='folder'?await store.exists(folder,name):null;
  if(fileThere==='folder'){error(`Files storage has a folder named "${name}" in ${folder}/. Rename or remove it there first.`);return;}
  if(fileThere==='file'&&!confirm(`"${folder}/${name}" already exists in Files storage. Overwrite it?`))return;
  if(folderThere!=='folder')await store.createFolder('',folder);
  await store.write(folder,name,lastFile.bytes);
  try{const channel=new BroadcastChannel('webpc-files');channel.postMessage({type:'changed',path:`${folder}/${name}`});channel.close();}catch{}
  status(`Saved copy to Files: ${folder}/${name}`);
 }catch(e){error(`Save to Files failed: ${e.message}`);}
}
$('savecopy').onclick=saveCopy;
$('audio').onclick=async()=>{try{if($('audio').textContent==='Pause audio'){pause();return;}const running=await frame.contentWindow.webpcAudio.resume();if(!running)throw new Error('Audio could not start. Click Enable audio again.');$('audio').textContent='Pause audio';error('');}catch(e){error(e.message);}};
$('help').onclick=()=>$('help-dialog').showModal();
window.pcBeforeClose=()=>{pause();if(!ready)return true;if(id==='soundcraft'||noDirty)return true;return !dirty&&!pending&&!saveError;};
window.pcFlush=()=>!dirty&&!pending&&!saveError;
addEventListener('beforeunload',event=>{if(ready&&(dirty||pending||saveError||id==='soundcraft'||noDirty)){event.preventDefault();event.returnValue='';}});
addEventListener('pagehide',pause);
document.addEventListener('pointerdown',()=>parent.postMessage({type:'pc:focus',appId:id},location.origin),true);
// Assign only after listeners exist; no readiness or save event can race setup.
frame.src=`/pc/vendor/${id}/index.html?webgl${id==='soundcraft'?'&empty':standalone?`&standalone${config.nosw?'&nosw':''}`:'&host=parent&control'}${id==='lightcraft'?'&store=idb':''}`;
// Standalone apps have no host protocol: hand the iframe its copy rules (the native
// document pattern from releases.mjs), its documented open method and loading element.
frame.addEventListener('load',()=>{if(standalone)frame.contentWindow?.postMessage({type:'pc:standalone',native:nativeSource(id),open:config.open||null,dirty:config.dirty||null,loading:config.loading??`${id}_loading`},location.origin);});
