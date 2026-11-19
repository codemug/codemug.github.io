import{setupApp}from'./common.mjs';
import*as store from'../files/store.mjs';
const crumbs=document.getElementById('files-crumbs'),rows=document.getElementById('files-rows'),statusEl=document.getElementById('files-status'),usageEl=document.getElementById('files-usage'),listEl=document.getElementById('files-list'),emptyEl=document.getElementById('files-empty');
const newBtn=document.getElementById('files-new'),uploadBtn=document.getElementById('files-upload'),input=document.getElementById('files-input'),downloadBtn=document.getElementById('files-download'),renameBtn=document.getElementById('files-rename'),deleteBtn=document.getElementById('files-delete'),keepBtn=document.getElementById('files-keep');
let path=[],selected=null,busy=false;
const esc=text=>text.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const fmtSize=bytes=>bytes>=1073741824?`${(bytes/1073741824).toFixed(1)} GB`:bytes>=1048576?`${(bytes/1048576).toFixed(1)} MB`:bytes>=1024?`${Math.round(bytes/1024)} KB`:`${bytes} B`;
const fmtDate=ms=>new Date(ms).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
function status(text,error=false){statusEl.textContent=text;statusEl.dataset.error=error;}
function setBusy(value){busy=value;for(const button of[newBtn,uploadBtn,downloadBtn,renameBtn,deleteBtn,keepBtn])button.disabled=value||button===downloadBtn&&!selected||(button===renameBtn||button===deleteBtn)&&!selected;}
window.pcBeforeClose=()=>!busy;// false only while an upload or delete is in flight

async function render(){
 try{
  const items=await store.list(path.join('/'));
  crumbs.innerHTML=`<button data-crumb="-1">Files</button>${path.map((segment,index)=>`<span aria-hidden="true">/</span>${index<path.length-1?`<button data-crumb="${index}">${esc(segment)}</button>`:`<span class="current">${esc(segment)}</span>`}`).join('')}`;
  rows.innerHTML=items.map(item=>{const isSelected=item.name===selected;return `<tr data-name="${esc(item.name)}" data-kind="${item.kind}" tabindex="0" aria-selected="${isSelected}"${isSelected?' class="sel"':''}><td class="name">${esc(item.name)}</td><td>${item.kind==='folder'?'Folder':'File'}</td><td>${item.kind==='file'?fmtSize(item.size):'—'}</td><td>${item.kind==='file'?fmtDate(item.modified):'—'}</td></tr>`;}).join('');
  emptyEl.hidden=items.length>0;
  if(selected&&!items.some(item=>item.name===selected))selected=null;
  downloadBtn.disabled=busy||!selected;renameBtn.disabled=busy||!selected;deleteBtn.disabled=busy||!selected;
  setBusy(busy);
 }catch(error){status(error.message,true);}
}

async function usageLine(){
 try{const{usage,quota,persisted}=await store.usage();
 usageEl.textContent=`${fmtSize(usage)} of ${fmtSize(quota)} used${persisted?' · persistent':', not yet persistent'}.`;
 }catch{usageEl.textContent='Storage usage unknown.';}
}

async function openFolder(name){
 try{path.push(name);selected=null;status(`Opened "${name}".`);await render();}catch(error){status(error.message,true);}
}

async function newFolder(){
 const name=prompt('New folder name:');
 if(name===null)return;
 try{await store.createFolder(path.join('/'),name);selected=name;status(`Created folder "${name}".`);await render();}catch(error){status(error.message,true);}
}

async function upload(fileList){
 const files=[...fileList];
 if(!files.length)return;
 setBusy(true);
 let done=0,failed=0;
 for(const file of files){
  const problem=store.validateName(file.name);
  if(problem){status(`Skipped "${file.name}": ${problem}`,true);failed++;continue;}
  status(`Uploading ${done+failed+1} of ${files.length}: ${file.name}…`);
  try{await store.write(path.join('/'),file.name,await file.arrayBuffer());done++;}
  catch(error){status(`Upload failed for "${file.name}": ${error.message}`,true);failed++;}
 }
 setBusy(false);
 status(failed?`Uploaded ${done}, ${failed} ${failed===1?'failed':'failed'}.`:`Uploaded ${done}.`);
 await render();
}

async function download(){
 try{const{data,name}=await store.read(path.join('/'),selected);
 const url=URL.createObjectURL(data);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
 status(`Downloaded "${name}".`);
 }catch(error){status(error.message,true);}
}

async function rename(){
 const to=prompt(`Rename "${selected}" to:`,selected);
 if(to===null||to===selected)return;
 try{await store.rename(path.join('/'),selected,to);selected=to;status(`Renamed to "${to}".`);await render();}catch(error){status(error.message,true);}
}

async function del(){
 try{
  const item=(await store.list(path.join('/'))).find(entry=>entry.name===selected);
  const total=await store.countEntries(path.join('/'),selected);
  const message=item?.kind==='folder'?`Delete folder "${selected}" and its ${total-1} ${total-1===1?'item':'items'}? This cannot be undone.`:`Delete file "${selected}"? This cannot be undone.`;
  if(!confirm(message))return;
  const name=selected;
  setBusy(true);
  await store.remove(path.join('/'),selected);
  setBusy(false);selected=null;status(`Deleted "${name}".`);
  await render();
 }catch(error){setBusy(false);status(error.message,true);}
}

async function keep(){
 try{const granted=await store.persist();
 status(granted?'Persistent storage granted: the browser keeps your files even when disk space is tight.':'The browser could not grant persistent storage right now. Your files still follow the browser storage rules.',!granted);
 await usageLine();
 }catch(error){status(error.message,true);}
}

crumbs.addEventListener('click',event=>{
 const index=Number(event.target.dataset.crumb??-1);
 if(event.target.tagName!=='BUTTON'||Number.isNaN(index))return;
 if(index<0)path=[];else path=path.slice(0,index+1);
 selected=null;render();
});
rows.addEventListener('click',event=>{const row=event.target.closest('tr[data-name]');if(row)selected=row.dataset.name;rows.querySelectorAll('tr').forEach(r=>{r.classList.toggle('sel',r===row);r.setAttribute('aria-selected',r===row?'true':'false');});setBusy(busy);});
rows.addEventListener('dblclick',event=>{
 const row=event.target.closest('tr[data-name]');
 if(!row)return;
 store.list(path.join('/')).then(items=>{if(items.find(item=>item.name===row.dataset.name)?.kind==='folder')openFolder(row.dataset.name);}).catch(()=>{});
});

document.addEventListener('keydown',event=>{
 if(busy||event.target.matches('input,textarea'))return;
 if(event.key==='Enter'&&selected){
  store.list(path.join('/')).then(items=>{if(items.find(item=>item.name===selected)?.kind==='folder')openFolder(selected);}).catch(()=>{});
 }
 else if(event.key==='Backspace'&&path.length){event.preventDefault();path.pop();selected=null;render();}
 else if(event.key==='Delete'&&selected)del();
 else if(event.key==='F2'&&selected)rename();
});
listEl.addEventListener('dragover',event=>event.preventDefault());
listEl.addEventListener('drop',event=>{event.preventDefault();upload(event.dataTransfer.files);});
newBtn.addEventListener('click',newFolder);
uploadBtn.addEventListener('click',()=>input.click());
input.addEventListener('change',()=>{upload(input.files);input.value='';});
downloadBtn.addEventListener('click',download);
renameBtn.addEventListener('click',rename);
deleteBtn.addEventListener('click',del);
keepBtn.addEventListener('click',keep);

if(!store.available()){
 status('File storage (OPFS) is unavailable in this browser. Nothing was stored and your other apps are not affected.',true);
 for(const button of[newBtn,uploadBtn,downloadBtn,renameBtn,deleteBtn,keepBtn])button.disabled=true;
 usageEl.textContent='File storage unavailable.';
}else{
 setupApp('files');
 status('Ready. Files stay in this browser only.');
 render();usageLine();
 // Other apps (Craft wrappers, Media Player) broadcast when they write into
 // webpc-files/; refresh the current folder so new files appear without reload.
 if(typeof BroadcastChannel!=='undefined')new BroadcastChannel('webpc-files').onmessage=event=>{if(event.data?.type==='changed'&&!busy)render();};
}
