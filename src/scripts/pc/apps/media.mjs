import{setupApp}from'./common.mjs';
import*as store from'../files/store.mjs';
import{createPlaylist,addItems,nextIndex,prevIndex,advance,removeAt,mediaKind}from'../media/playlist.mjs';
const stage=document.getElementById('media-stage'),video=document.getElementById('media-video'),titleEl=document.getElementById('media-title'),statusEl=document.getElementById('media-status');
const playBtn=document.getElementById('media-play'),prevBtn=document.getElementById('media-prev'),nextBtn=document.getElementById('media-next'),repeatBtn=document.getElementById('media-repeat'),seek=document.getElementById('media-seek'),timeEl=document.getElementById('media-time'),durEl=document.getElementById('media-duration'),muteBtn=document.getElementById('media-mute'),vol=document.getElementById('media-volume'),fsBtn=document.getElementById('media-fullscreen');
const input=document.getElementById('media-input'),listEl=document.getElementById('media-list'),filesPanel=document.getElementById('media-files'),filesList=document.getElementById('media-files-list');
const playlist=createPlaylist();
let filesFound=[];
const esc=text=>text.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const fmt=seconds=>{const s=Math.max(0,Math.floor(seconds||0));return`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
function status(text,error=false){statusEl.textContent=text;statusEl.dataset.error=error;}

function renderList(){
 listEl.innerHTML=playlist.items.map((item,i)=>`<li data-i="${i}" tabindex="0"${i===playlist.index?' class="sel"':''}><span class="mp-name">${esc(item.name)}</span><span class="mp-kind">${item.kind}</span><button type="button" class="mp-remove" data-i="${i}" aria-label="Remove ${esc(item.name)}">×</button></li>`).join('');
 prevBtn.disabled=nextBtn.disabled=!playlist.items.length;
}

function load(index,play=true){
 const item=playlist.items[index];
 if(!item)return;
 playlist.index=index;
 video.src=item.url;
 titleEl.textContent=item.name;
 stage.classList.toggle('audio',item.kind==='audio');
 renderList();
 if('mediaSession'in navigator)try{navigator.mediaSession.metadata=new MediaMetadata({title:item.name,artist:'WebPC'});}catch{}
 if(play)video.play().catch(()=>{});
}

function addEntries(entries){
 for(const entry of entries)entry.url=URL.createObjectURL(entry.blob);
 const wasEmpty=!playlist.items.length;
 addItems(playlist,entries);
 renderList();
 if(wasEmpty)load(0,false); // No autoplay: file-input change is not a user gesture, so play() would be blocked by the real-browser autoplay policy.
 else status(`Added ${entries.length} ${entries.length===1?'item':'items'} to the playlist.`);
}

async function addFromFiles(fileList){
 const entries=[],rejected=[];
 for(const file of[...fileList]){
  const kind=mediaKind(file.name,file.type);
  if(!kind){rejected.push(file.name);continue;}
  entries.push({name:file.name,kind,blob:file});
 }
 if(rejected.length)status(`Skipped (not audio or video): ${rejected.join(', ')}`,true);
 if(entries.length)addEntries(entries);
}

function doNext(){
 const i=nextIndex(playlist);
 if(i>=0&&i!==playlist.index)load(i);
}
function doPrev(){
 const i=prevIndex(playlist);
 if(i>=0)load(i);
}
function toggle(){
 if(!playlist.items.length){status('The playlist is empty. Open audio or video first.',true);return;}
 if(!video.currentSrc){load(playlist.index);return;}
 if(video.paused)video.play().catch(()=>{});
 else video.pause();
}

video.addEventListener('timeupdate',()=>{seek.max=video.duration||1;seek.value=video.currentTime;timeEl.textContent=fmt(video.currentTime);});
video.addEventListener('loadedmetadata',()=>{seek.max=video.duration||1;durEl.textContent=fmt(video.duration);});
video.addEventListener('play',()=>playBtn.textContent='⏸ Pause');
video.addEventListener('pause',()=>playBtn.textContent='▶ Play');
video.addEventListener('ended',()=>{
 const i=advance(playlist);
 if(i!==playlist.index)load(i);
 else if(playlist.repeat==='one')load(i);
});
video.addEventListener('error',()=>{
 if(!video.error||!playlist.items.length)return;
 const message=`Could not play "${titleEl.textContent}" (MediaError code ${video.error.code}); skipped.`;
 status(message,true);
 const i=nextIndex(playlist);
 if(i!==playlist.index)load(i);
 else status(`${message} Nothing else to try.`,true);
});

function setVolume(value,save=true){
 value=Math.min(1,Math.max(0,value));
 video.volume=value;vol.value=value;
 if(save)try{localStorage.setItem('pc:media:volume',String(value));}catch{}
}
vol.addEventListener('input',()=>setVolume(parseFloat(vol.value)));
muteBtn.addEventListener('click',()=>{video.muted=!video.muted;muteBtn.textContent=video.muted?'Unmute':'Mute';});
function toggleFullscreen(){
 if(document.fullscreenElement)document.exitFullscreen();
 else stage.requestFullscreen?.();
}
fsBtn.addEventListener('click',toggleFullscreen);
playBtn.addEventListener('click',toggle);
prevBtn.addEventListener('click',doPrev);
nextBtn.addEventListener('click',doNext);
repeatBtn.addEventListener('click',()=>{
 playlist.repeat=playlist.repeat==='off'?'all':playlist.repeat==='all'?'one':'off';
 repeatBtn.textContent=`↻ ${playlist.repeat}`;
 repeatBtn.setAttribute('aria-label',`Repeat ${playlist.repeat}`);
});
seek.addEventListener('input',()=>{video.currentTime=parseFloat(seek.value);});
listEl.addEventListener('click',event=>{
 const remove=event.target.closest('.mp-remove');
 if(remove){
  const i=Number(remove.dataset.i);
  const removed=playlist.items[i];
  if(removed?.url)URL.revokeObjectURL(removed.url);
  const wasCurrent=i===playlist.index;
  removeAt(playlist,i);
  renderList();
  if(wasCurrent){
   if(playlist.index<0){video.removeAttribute('src');video.load();titleEl.textContent='Nothing playing';}
   else load(playlist.index);
  }
  return;
 }
 const row=event.target.closest('li[data-i]');
 if(row)load(Number(row.dataset.i));
});
input.addEventListener('change',()=>{addFromFiles(input.files);input.value='';});
document.getElementById('media-open').addEventListener('click',()=>input.click());
document.getElementById('media-main').addEventListener('dragover',event=>event.preventDefault());
document.getElementById('media-main').addEventListener('drop',event=>{event.preventDefault();addFromFiles(event.dataTransfer.files);});

// Open from Files: read-only walk of the Files app's storage.
async function openFromFiles(){
 filesPanel.hidden=false;
 filesList.innerHTML='<li class="mp-busy">Scanning Files storage…</li>';
 try{
  const found=[];
  const walk=async path=>{
   for(const item of await store.list(path)){
    const at=path?`${path}/${item.name}`:item.name;
    if(item.kind==='folder')await walk(at);
    else{const kind=mediaKind(item.name);if(kind)found.push({name:at,kind});}
   }
  };
  await walk('');
  filesFound=found;
  filesList.innerHTML=found.length?found.map((file,i)=>`<li data-f="${i}" tabindex="0"><span class="mp-name">${esc(file.name)}</span><span class="mp-kind">${file.kind}</span></li>`).join(''):'<li class="mp-busy">No audio or video files in Files storage yet. Upload some in the Files app.</li>';
  status(`Found ${found.length} media ${found.length===1?'file':'files'} in Files storage (read-only).`);
 }catch(error){
  filesList.innerHTML='';
  status(error.message,true);
 }
}
document.getElementById('media-open-files').addEventListener('click',openFromFiles);
filesList.addEventListener('click',async event=>{
 const row=event.target.closest('li[data-f]');
 if(!row)return;
 const file=filesFound[Number(row.dataset.f)];
 const slash=file.name.lastIndexOf('/');
 const dir=slash<0?'':file.name.slice(0,slash),name=slash<0?file.name:file.name.slice(slash+1);
 try{
  const{data}=await store.read(dir,name);
  const position=playlist.items.length;
  addEntries([{name,kind:file.kind,blob:data}]);
  load(position);
  filesPanel.hidden=true;
 }catch(error){status(error.message,true);}
});

document.addEventListener('keydown',event=>{
 if(event.target.matches('input,button,textarea,select,[contenteditable]'))return;
 if(event.key===' '){event.preventDefault();toggle();}
 else if(event.key==='ArrowLeft'){event.preventDefault();video.currentTime=Math.max(0,video.currentTime-5);}
 else if(event.key==='ArrowRight'){event.preventDefault();video.currentTime=Math.min(video.duration||0,video.currentTime+5);}
 else if(event.key==='ArrowUp'){event.preventDefault();setVolume(video.volume+0.05);}
 else if(event.key==='ArrowDown'){event.preventDefault();setVolume(video.volume-0.05);}
 else if(event.key==='n'||event.key==='N')doNext();
 else if(event.key==='p'||event.key==='P')doPrev();
 else if(event.key==='m'||event.key==='M'){video.muted=!video.muted;muteBtn.textContent=video.muted?'Unmute':'Mute';}
 else if(event.key==='f'||event.key==='F')toggleFullscreen();
});

// The desktop only hides closed windows, so closing must pause playback.
window.pcBeforeClose=()=>{video.pause();return true;};
window.addEventListener('pagehide',()=>video.pause());
if('mediaSession'in navigator)for(const[action,handler]of[['play',()=>video.play().catch(()=>{})],['pause',()=>video.pause()],['previoustrack',doPrev],['nexttrack',doNext]])try{navigator.mediaSession.setActionHandler(action,handler);}catch{}

const savedVolume=parseFloat(localStorage.getItem('pc:media:volume'));
setVolume(Number.isFinite(savedVolume)?savedVolume:0.8,false);
setupApp('media');
status('Ready. Open audio or video, or drop files here.');
renderList();
