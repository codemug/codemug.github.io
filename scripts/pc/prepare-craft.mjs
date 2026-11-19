import {mkdir,readFile,writeFile,rename,rm,readdir,copyFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {releases,releaseUrl} from './craft/releases.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),cache=join(root,'node_modules/.cache/webpc/craft');
const bootstrap=await readFile(new URL('./craft/bootstrap.js',import.meta.url),'utf8');
const fingerprint=createHash('sha256').update(bootstrap).update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
await mkdir(cache,{recursive:true});await mkdir(join(root,'public/pc/vendor'),{recursive:true});
for(const [id,release] of Object.entries(releases)){
 const output=join(root,'public/pc/vendor',id),marker=join(output,'.release.json');
 try{const installed=JSON.parse(await readFile(marker,'utf8'));await access(join(output,'index.html'));if(installed.sha256===release.sha256&&installed.fingerprint===fingerprint){console.log(`${release.title} ${release.version} already prepared.`);continue;}}catch{}
 const zip=join(cache,`${id}-${release.version}.zip`),url=releaseUrl(id);let bytes;
 try{bytes=await readFile(zip);}catch{console.log(`Downloading ${release.title} ${release.version}…`);const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error(`${id}: HTTP ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());}
 if(createHash('sha256').update(bytes).digest('hex')!==release.sha256)throw new Error(`${id}: checksum mismatch; no assets replaced.`);
 await writeFile(zip,bytes);
 const names=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n');
 if(names.some(name=>name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')))throw new Error(`${id}: unsafe archive path`);
 const stage=`${output}.staging-${process.pid}`;await mkdir(stage,{recursive:true});
 try{
   execFileSync('unzip',['-q',zip,'-d',stage]);const payload=join(stage,`${id}-web-${release.version}`);
   async function prune(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await prune(path);else if(/\.(br|gz)$/.test(entry.name)||['_headers','.htaccess'].includes(entry.name))await rm(path);}}
   await prune(payload);
   let html=await readFile(join(payload,'index.html'),'utf8');html=html.replace('<html lang="en">',`<html lang="en" data-webpc-app="${id}">`).replace('<head>','<head>\n<script src="./webpc-bootstrap.js"></script>');
   await writeFile(join(payload,'index.html'),html);await writeFile(join(payload,'webpc-bootstrap.js'),bootstrap);
   const notice=join(root,'public/third-party',id);await mkdir(notice,{recursive:true});
   async function notices(dir,relative=''){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name),rel=join(relative,entry.name);if(entry.isDirectory())await notices(path,rel);else if(/^(LICENSE|NOTICE|OFL|ATTRIBUTION)|\.LICEN[CS]E(?:\.txt)?$/i.test(entry.name)){const target=join(notice,rel);await mkdir(dirname(target),{recursive:true});await copyFile(path,target);}}}
   await notices(payload);
   await writeFile(join(notice,'WEBPC.txt'),`${release.title} ${release.version}\nUpstream: https://github.com/storytold/${id}/tree/v${release.version}\nRelease: ${url}\nSHA-256: ${release.sha256}\nOfficial WASM, JavaScript and embedded assets are preserved. WebPC adds a small entry script for storage safety, focus and SoundCraft audio/session handling. Precompressed siblings and hosting-specific header templates are omitted. See docs/webpc/craft-apps.md.\n`);
   await writeFile(join(payload,'.release.json'),JSON.stringify({...release,url,fingerprint}));
   await rm(output,{recursive:true,force:true});await rename(payload,output);
 }finally{await rm(stage,{recursive:true,force:true});}
 console.log(`Prepared ${release.title} ${release.version}.`);
}
