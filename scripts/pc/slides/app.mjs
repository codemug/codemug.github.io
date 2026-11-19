import { KEY, LEGACY_KEY, encodeBackup, decodeBackup } from './storage.mjs';
const $=id=>document.getElementById(id),frame=$('slides-editor');
let ready=false;
const api=()=>frame.contentWindow?.webpcSlides;
function error(message){$('error').textContent=message;$('error').hidden=!message;}
function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function action(fn){try{error('');fn();}catch(e){error(e.message||String(e));}}
const timeout=setTimeout(()=>{if(!ready)error('The Slides editor did not load. Reload to retry; saved data is unchanged.');},20000);
addEventListener('message',event=>{
 if(event.origin!==location.origin)return;
 if(event.source===parent&&event.data?.type==='pc:theme')document.documentElement.dataset.theme=event.data.theme;
 if(event.source!==frame.contentWindow)return;
 if(event.data?.type==='pc:slides-status'){$('status').textContent=event.data.status;error(event.data.error||'');$('raw').hidden=!event.data.error?.includes('left untouched');}
 if(event.data?.type==='pc:ready'){ready=true;clearTimeout(timeout);for(const id of ['backup','open','recover','retry'])$(id).disabled=false;parent.postMessage({type:'pc:ready',appId:'slides'},location.origin);}
 if(event.data?.type==='pc:focus')parent.postMessage(event.data,location.origin);
});
window.pcBeforeClose=window.pcFlush=()=>ready?frame.contentWindow.pcBeforeClose?.()===true:true;
document.addEventListener('pointerdown',()=>parent.postMessage({type:'pc:focus',appId:'slides'},location.origin),true);
$('backup').onclick=()=>action(()=>download(encodeBackup(api().snapshot()),'presentation.casual-slides.json'));
$('open').onclick=()=>$('file').click();
$('file').onchange=async()=>{const file=$('file').files[0];$('file').value='';if(!file)return;try{if(file.size>30*1024*1024)throw new Error('JSON backups are limited to 30 MB.');const next=decodeBackup(await file.text());error('');api().replace(next);}catch(e){error(e.message||String(e));}};
$('recover').onclick=()=>action(()=>api().recover());$('retry').onclick=()=>action(()=>api().flush());
$('help').onclick=()=>$('help-dialog').showModal();
try{$('legacy').hidden=!localStorage.getItem(LEGACY_KEY);}catch{}
$('legacy-download').onclick=()=>action(()=>{const data=localStorage.getItem(LEGACY_KEY);if(!data)throw new Error('No earlier deck is stored.');download(data,'earlier-composer-deck.json');});

$('raw').onclick=()=>action(()=>download(localStorage.getItem(KEY)||'','unreadable-slides-data.json'));
