// Shared file picker over the Files app storage (webpc-files/). Read-only:
// it lists folders, filters files by an <input accept>-style list and returns
// {name, bytes} or null when cancelled. The dialog, its rows and its styles
// are all built at runtime by this module, so the styles are global but
// contained by the .wp-picker class (Astro scoped styles never reach
// script-built DOM, and the picker is reused on non-Astro pages too).
import * as store from './store.mjs';

// Pure accept-list logic, unit-tested in tests/pc-files-picker.test.mjs.
// Like <input type=file accept>: comma-separated extension groups ('.pdf')
// and MIME types ('audio/*', 'video/mp4'). A file with a known type matches
// only its MIME groups; a typeless file (all OPFS files) matches extension
// groups, plus wildcard groups via EXT_MIME (OPFS names carry no MIME, so
// without this 'audio/*' would never match a .wav). '*/*' matches everything.
const EXT_MIME={wav:'audio',mp3:'audio',ogg:'audio',oga:'audio',m4a:'audio',aac:'audio',flac:'audio',opus:'audio',weba:'audio',amr:'audio',aiff:'audio',aif:'audio',mid:'audio',midi:'audio',mp4:'video',m4v:'video',webm:'video',mov:'video',mkv:'video',ogv:'video',avi:'video','3gp':'video',png:'image',jpg:'image',jpeg:'image',gif:'image',webp:'image',bmp:'image',svg:'image',pdf:'application',json:'application',xml:'application',txt:'text',csv:'text',md:'text',html:'text'};
export function parseAccept(spec){
  const exts=new Set(),mimes=[];
  for(const raw of String(spec??'').split(',')){
    const token=raw.trim().toLowerCase();
    if(token.startsWith('.'))exts.add(token.slice(1));
    else if(token.includes('/'))mimes.push(token);
  }
  return{exts,mimes};
}

export function matchesAccept(spec,name,type=''){
  if(!spec)return true;
  const{exts,mimes}=parseAccept(spec);
  if(!exts.size&&!mimes.length)return true;
  if(mimes.includes('*/*'))return true;
  const mime=String(type??'').toLowerCase();
  if(mime){
    for(const token of mimes)if(token===mime||(token.endsWith('/*')&&mime.startsWith(token.slice(0,-1))))return true;
    return false;
  }
  const dot=String(name??'').lastIndexOf('.');
  if(dot<=0)return false;
  const ext=String(name).slice(dot+1).toLowerCase();
  for(const wanted of exts)if(wanted===ext)return true;
  const prefix=EXT_MIME[ext];
  if(prefix)for(const token of mimes)if(token.endsWith('/*')&&token.slice(0,-1)===`${prefix}/`)return true;
  return false;
}

const STYLE_ID='wp-picker-style';
// Opaque panel that follows the host page's theme: Craft wrapper pages define
// --panel/--line (:root light, html[data-theme=dark] dark), utility pages the
// site tokens --color-surface/--color-border; Canvas/CanvasText are the
// last-resort fallbacks that follow color-scheme. Same pattern as the
// wrapper's own #help-dialog (var(--panel) panel, #0009 backdrop).
const CSS=`
.wp-picker{color-scheme:light dark;width:min(92vw,520px);min-width:min(420px,90vw);margin:auto;font:inherit;line-height:1.5;
 background:var(--panel,var(--color-surface,Canvas));color:var(--color-text,inherit);
 border:1px solid var(--line,var(--color-border,color-mix(in srgb,currentColor 25%,transparent)));
 border-radius:10px;padding:12px;box-shadow:0 12px 40px rgb(0 0 0/.35)}
.wp-picker::backdrop{background:#0009}
.wp-picker .head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px}
.wp-picker h2{font-size:13px;margin:0}
.wp-picker .cancel{font:inherit;font-size:12px;color:inherit;background:transparent;border:1px solid var(--line,var(--color-border,transparent));border-radius:4px;padding:3px 8px;cursor:pointer}
.wp-picker .cancel:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
.wp-picker .cancel:focus-visible{outline:2px solid currentColor}
.wp-picker nav{display:flex;flex-wrap:wrap;gap:2px;align-items:center;font-size:12px;margin-bottom:6px}
.wp-picker nav button{font:inherit;font-size:12px;border:0;background:none;color:inherit;cursor:pointer;padding:2px 5px;border-radius:4px}
.wp-picker nav button:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
.wp-picker nav button:focus-visible{outline:2px solid currentColor}
.wp-picker nav .here{color:color-mix(in srgb,currentColor 60%,transparent);padding:2px 5px}
.wp-picker ul{list-style:none;margin:0;padding:0;max-height:50vh;overflow:auto;
 border:1px solid var(--line,var(--color-border,color-mix(in srgb,currentColor 20%,transparent)));border-radius:6px}
.wp-picker li{padding:6px 10px;font-size:12px;cursor:pointer;border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent)}
.wp-picker li:last-child{border-bottom:0}
.wp-picker li.folder{font-weight:550}
.wp-picker li[data-name]:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
.wp-picker li.hint{color:color-mix(in srgb,currentColor 55%,transparent);cursor:default}
.wp-picker li:focus-visible{outline:2px solid currentColor;outline-offset:-2px}
.wp-picker footer{margin-top:8px;font-size:11px;color:color-mix(in srgb,currentColor 65%,transparent)}`;
function ensureStyle(){
  if(document.getElementById(STYLE_ID))return;
  const style=document.createElement('style');
  style.id=STYLE_ID;
  style.textContent=CSS;
  document.head.appendChild(style);
}
const esc=text=>text.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

// Pick a file from webpc-files/: {accept,title,root} like <input accept>.
// Resolves {name, bytes} on choice, null on Escape/cancel or if storage is
// unavailable. Arrow keys move between rows, Enter opens, Escape cancels.
export function pickFile({accept='',title='Open from Files',root=''}={}){
  ensureStyle();
  if(!store.available())return Promise.resolve(null);
  const dialog=document.createElement('dialog');
  dialog.className='wp-picker';
  dialog.innerHTML='<header class="head"><h2></h2><button class="cancel" type="button">Cancel</button></header><nav aria-label="Folder"></nav><ul></ul><footer></footer>';
  document.body.appendChild(dialog);
  const h2=dialog.querySelector('h2'),navEl=dialog.querySelector('nav'),listEl=dialog.querySelector('ul'),footEl=dialog.querySelector('footer');
  h2.textContent=title;
  dialog.querySelector('.cancel').addEventListener('click',()=>dialog.close());
  let dir=root,settled=false,resolveResult;
  const result=new Promise(resolve=>{resolveResult=resolve;});
  const pick=name=>store.read(dir,name).then(item=>item.data.arrayBuffer()).then(bytes=>{settled=true;resolveResult({name,bytes});dialog.close();})
    .catch(error=>{footEl.textContent=error.message;});
  const activate=row=>{
    if(row.dataset.kind==='folder'){dir=dir?`${dir}/${row.dataset.name}`:row.dataset.name;void refresh();}
    else void pick(row.dataset.name);
  };
  async function refresh(){
    try{
      const items=await store.list(dir);
      const visible=items.filter(item=>item.kind==='folder'||matchesAccept(accept,item.name));
      listEl.innerHTML=visible.map(item=>`<li data-name="${esc(item.name)}" data-kind="${item.kind}" tabindex="0">${item.kind==='folder'?'▸ ':''}${esc(item.name)}</li>`).join('')||'<li class="hint">Empty — no matching files here.</li>';
      const crumbs=['Files',...dir.split('/')];
      navEl.innerHTML=crumbs.map((segment,index)=>index<crumbs.length-1?`<button data-crumb="${index}">${esc(segment)}</button>`:`<span class="here">${esc(segment)}</span>`).join('<span aria-hidden="true">/</span>');
      footEl.textContent='Arrow keys move, Enter opens, Esc cancels.';
      listEl.querySelector('li[data-name]')?.focus();
    }catch(error){footEl.textContent=error.message;}
  }
  dialog.addEventListener('close',()=>{if(!settled){settled=true;resolveResult(null);}dialog.remove();});
  listEl.addEventListener('click',event=>{const row=event.target.closest('li[data-name]');if(row)activate(row);});
  dialog.addEventListener('keydown',event=>{
    const rows=[...listEl.querySelectorAll('li[data-name]')];
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      if(!rows.length)return;
      event.preventDefault();
      const index=rows.indexOf(document.activeElement);
      const next=index<0?(event.key==='ArrowDown'?0:rows.length-1):(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length;
      rows[next].focus();
    }else if(event.key==='Enter'){
      const row=document.activeElement;
      if(listEl.contains(row)&&row.dataset.name!==undefined){event.preventDefault();activate(row);}
    }
  });
  navEl.addEventListener('click',event=>{
    const button=event.target.closest('button[data-crumb]');
    if(!button)return;
    dir=dir.split('/').slice(0,Number(button.dataset.crumb)).join('/');
    void refresh();
  });
  dialog.showModal();
  void refresh();
  return result;
}
