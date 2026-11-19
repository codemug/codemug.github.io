// Pure playlist and media-type logic for the Media Player (unit-testable in Node;
// no DOM). The UI (apps/media.mjs) owns object URLs and the <video> element.
// repeat: 'off' (stay on the last item when it ends), 'all' (wrap), 'one'
// (replay the current item when it ends). Explicit next/previous buttons always
// move; previous wraps to the end.

export function createPlaylist(){
  return{items:[],index:-1,repeat:'off'};
}

export function addItems(playlist,entries){
  playlist.items.push(...entries);
  if(playlist.index===-1&&playlist.items.length)playlist.index=0;
  return playlist;
}

// Index the "next" button or the end-of-track advance should load.
export function nextIndex(playlist){
  const n=playlist.items.length;
  if(!n)return-1;
  const i=playlist.index+1;
  return i<n?i:(playlist.repeat==='all'?0:playlist.index);
}

export function prevIndex(playlist){
  const n=playlist.items.length;
  if(!n)return-1;
  const i=playlist.index-1;
  return i>=0?i:n-1;
}

// Index to load when the current track ends naturally.
export function advance(playlist){
  if(playlist.repeat==='one')return playlist.index;
  return nextIndex(playlist);
}

// Remove the item at position i and fix the current index: removing an earlier
// item shifts the index, removing the current item keeps the index (the next
// item slides into place), removing a later item changes nothing.
export function removeAt(playlist,i){
  playlist.items.splice(i,1);
  if(!playlist.items.length)playlist.index=-1;
  else if(i<playlist.index)playlist.index--;
  else playlist.index=Math.min(playlist.index,playlist.items.length-1);
  return playlist;
}

const AUDIO_EXT=/(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba|amr|aiff?)$/i;
const VIDEO_EXT=/(mp4|m4v|webm|mov|mkv|ogv|avi|3gp)$/i;

// 'audio' | 'video' | null — MIME first, then the file name.
export function mediaKind(name,type){
  if(typeof type==='string'&&type){
    if(type.startsWith('audio/'))return'audio';
    if(type.startsWith('video/'))return'video';
  }
  if(typeof name==='string'){
    if(AUDIO_EXT.test(name))return'audio';
    if(VIDEO_EXT.test(name))return'video';
  }
  return null;
}

export function isMedia(name,type){
  return mediaKind(name,type)!==null;
}
