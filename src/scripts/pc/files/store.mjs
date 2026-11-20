// Files app storage. Pure name/path helpers (also used by unit tests) plus an
// OPFS wrapper that only ever operates inside the `webpc-files/` root: other
// apps keep their own OPFS roots (FilmCraft recovery/media, EffectCraft), so
// listing, writing and deleting at the origin root is out of scope here.
const ROOT='webpc-files';
const CONTROL=/[\u0000-\u001f\u007f]/;

// OPFS directory handles expose either getDirectory/getFile or the older
// getDirectoryHandle/getFileHandle depending on the engine; both take an
// options dict, so only the method names differ.
function openDir(handle,name,create){return handle.getDirectory?handle.getDirectory(name,{create}):handle.getDirectoryHandle(name,{create});}
function openFile(handle,name,create){return handle.getFile?handle.getFile(name,{create}):handle.getFileHandle(name,{create});}

export function validateName(name){
  if(typeof name!=='string'||name.length===0)return 'The name must not be empty.';
  if(name.length>255)return 'The name is too long (255 characters at most).';
  if(name==='.'||name==='..')return 'That name is reserved.';
  if(name.includes('/')||name.includes('\\'))return 'The name cannot contain / or \\.';
  if(CONTROL.test(name))return 'The name cannot contain control characters.';
  return '';
}

export function joinPath(...segments){
  const bad=segments.find(segment=>validateName(segment));
  if(bad!==undefined)throw new Error(validateName(bad));
  return segments.join('/');
}

export function available(){
  return typeof navigator!=='undefined'&&typeof navigator.storage?.getDirectory==='function';
}

// `path` is a joinPath() string ('' for the root). Every segment is validated
// and the walk starts at `webpc-files/`, so nothing can reach other apps'
// OPFS roots. create:false, so a missing folder raises NotFoundError.
async function dirHandle(path){
  let current=await openDir(await navigator.storage.getDirectory(),ROOT,true);
  for(const segment of path.split('/').filter(Boolean)){
    if(validateName(segment))throw new Error(validateName(segment));
    current=await openDir(current,segment,false);
  }
  return current;
}

function folder(name){return{name,kind:'folder'}}
function file(name,blob){return{name,kind:'file',size:blob.size,modified:blob.lastModified}}

export async function list(path=''){
  const items=[];
  for await(const[name,handle]of(await dirHandle(path)).entries()){
    if(handle.kind==='directory')items.push(folder(name));
    else items.push(file(name,await handle.getFile()));
  }
  return items.sort((a,b)=>a.kind===b.kind?a.name.localeCompare(b.name):a.kind==='folder'?-1:1);
}

export async function createFolder(path,name){
  const problem=validateName(name);
  if(problem)throw new Error(problem);
  const parent=await dirHandle(path);
  const taken=await openDir(parent,name,false).then(()=>true,()=>false);
  if(taken)throw new Error(`"${name}" already exists here.`);
  await openDir(parent,name,true);
}

export async function write(path,name,data){
  const problem=validateName(name);
  if(problem)throw new Error(problem);
  const sink=await(await openFile(await dirHandle(path),name,true)).createWritable();
  await sink.write(data);
  await sink.close();
}

export async function read(path,name){
  const blob=await(await openFile(await dirHandle(path),name,false)).getFile();
  return{name:blob.name,data:blob,modified:blob.lastModified};
}

// What, if anything, exists at path/name: 'file', 'folder' or null.
export async function exists(path,name){
  if(validateName(name))throw new Error(validateName(name));
  const parent=await dirHandle(path);
  try{await openDir(parent,name,false);return'folder';}catch{}
  try{await openFile(parent,name,false);return'file';}catch{}
  return null;
}

// OPFS has no rename; copy then delete is the portable equivalent.
export async function rename(path,from,to){
  if(validateName(from))throw new Error(validateName(from));
  if(validateName(to))throw new Error(validateName(to));
  if(await exists(path,to))throw new Error(`"${to}" already exists here.`);
  const{data}=await read(path,from);
  await write(path,to,data);
  await remove(path,from);
}

async function countUnder(handle){
  let count=0;
  for await(const[,child]of handle.entries()){count++;if(child.kind==='directory')count+=await countUnder(child);}
  return count;
}

// Total entries a deletion will remove, including the entry itself.
export async function countEntries(path,name){
  // A file makes openDir throw TypeMismatchError, so check the kind first.
  if(await exists(path,name)!=='folder')return 1;
  return 1+await countUnder(await openDir(await dirHandle(path),name,false));
}

export async function remove(path,name){
  // recursive:true deletes folder trees; the flag is ignored for files.
  await(await dirHandle(path)).removeEntry(name,{recursive:true});
}

export async function usage(){
  const{usage=0,quota=0,persisted}=await navigator.storage.estimate();
  return{usage,quota,persisted};
}

export function persist(){
  return navigator.storage.persist();
}
