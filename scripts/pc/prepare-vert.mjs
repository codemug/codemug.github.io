import {mkdir,readFile,writeFile,cp,copyFile,rm,rename,readdir,stat,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {patchVert} from './vert/patch.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const commit='35ebeb1679eb0b1af3f099c03060cb89f72e70f8',sha256='9bbe95a29176396fd17c02c817fad2d0b856c9477c6f5a7fd0aad982bcbe38ad';
const url=`https://codeload.github.com/VERT-sh/VERT/tar.gz/${commit}`;
const cache=join(root,'node_modules/.cache/webpc/vert'),source=join(cache,'source'),output=join(root,'public/pc/vendor/vert'),notice=join(root,'public/third-party/vert');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inputs=['prepare-vert.mjs','vert/patch.mjs','vert/webpc.ts','vert/webpc-storage.ts','vert/inlang.json'];
const fingerprint=hash(Buffer.concat(await Promise.all(inputs.map(name=>readFile(join(root,'scripts/pc',name))))));
try{const installed=JSON.parse(await readFile(join(output,'release.json'),'utf8'));await access(join(output,'index.html'));await access(join(notice,'modified-source.tar.gz'));if(installed.fingerprint===fingerprint){console.log('VERT pinned local build already prepared.');process.exit(0)}}catch{}
const bun=process.env.WEBPC_BUN_BIN||'bun';
let version;try{version=execFileSync(bun,['--version'],{encoding:'utf8'}).trim()}catch{throw new Error('VERT requires Bun 1.3.14. Install that version or set WEBPC_BUN_BIN; CI installs the pinned version.')}
if(version!=='1.3.14')throw new Error(`VERT reproducibility requires Bun 1.3.14, found ${version}`);
await mkdir(cache,{recursive:true});await mkdir(notice,{recursive:true});
async function pinned(file,url,digest){let bytes;try{bytes=await readFile(file)}catch{}if(!bytes||hash(bytes)!==digest){const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error(`VERT download HTTP ${response.status}: ${url}`);bytes=Buffer.from(await response.arrayBuffer())}if(hash(bytes)!==digest)throw new Error(`VERT checksum mismatch: ${url}`);await writeFile(file,bytes);return bytes}
const archive=join(cache,'upstream.tar.gz');await pinned(archive,url,sha256);
const names=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n');if(names.some(name=>name.startsWith('/')||name.split('/').includes('..')||name.includes('\\')))throw new Error('Unsafe VERT archive');
// A fresh source extraction prevents removed patch files from persisting. Keep only the frozen dependency install.
const deps=join(cache,'dependencies');try{await access(join(source,'node_modules'));await rm(deps,{recursive:true,force:true});await rename(join(source,'node_modules'),deps)}catch{}
await rm(source,{recursive:true,force:true});await mkdir(source,{recursive:true});execFileSync('tar',['-xzf',archive,'--strip-components=1','-C',source]);try{await rename(deps,join(source,'node_modules'))}catch{}
await patchVert(source);
for(const name of ['webpc.ts','webpc-storage.ts'])await copyFile(join(root,'scripts/pc/vert',name),join(source,'src/lib/util',name));
await mkdir(join(source,'project.inlang/modules'),{recursive:true});
const plugins=JSON.parse(await readFile(join(root,'scripts/pc/vert/inlang.json'),'utf8'));
for(const plugin of plugins){const bytes=await pinned(join(cache,plugin.file),plugin.url,plugin.sha256);await writeFile(join(source,'project.inlang/modules',plugin.file),bytes)}
const env={...process.env,PUB_DISABLE_ALL_EXTERNAL_REQUESTS:'true',PUB_DISABLE_FAILURE_BLOCKS:'false',PUB_HOSTNAME:'usmanshahid.is-a.dev',PUB_ENV:'production',PUB_PLAUSIBLE_URL:'',PUB_VERTD_URL:'',PUB_DONATION_URL:'',PUB_STRIPE_KEY:'',SOURCE_COMMIT:commit};
execFileSync(bun,['install','--frozen-lockfile','--ignore-scripts'],{cwd:source,env,stdio:'inherit'});
execFileSync(bun,['run','build'],{cwd:source,env,stdio:'inherit'});
// Offer the entire modified corresponding source, frozen dependency lock, plugins, and instructions under AGPL.
await writeFile(join(source,'WEBPC-BUILD.md'),`# WebPC VERT source\n\nUpstream ${commit}; WebPC modifications are marked in source. AGPL-3.0.\nRequires Bun1.3.14. Run bun install --frozen-lockfile --ignore-scripts.\nBuild with PUB_DISABLE_ALL_EXTERNAL_REQUESTS=true PUB_DISABLE_FAILURE_BLOCKS=false PUB_HOSTNAME=usmanshahid.is-a.dev PUB_ENV=production PUB_PLAUSIBLE_URL='' PUB_VERTD_URL='' PUB_DONATION_URL='' PUB_STRIPE_KEY='' SOURCE_COMMIT=${commit} bun run build.\nServe build/ under /pc/vendor/vert/ on a secure origin; threaded converters are unavailable without cross-origin isolation. VERT's service worker intentionally does not impose isolation.\nThe source includes all upstream files, frozen Bun lock and pinned local translation plugins. node_modules/build/tool caches are excluded. Download dependencies using that lock.\n`);
execFileSync('tar',['--exclude=./node_modules','--exclude=./build','--exclude=./.svelte-kit','--exclude=./.git','--exclude=./.inlang','-czf',join(notice,'modified-source.tar.gz'),'-C',source,'.']);
await copyFile(join(source,'LICENSE'),join(notice,'LICENSE'));
await writeFile(join(notice,'NOTICE.txt'),`VERT ${commit}\nUpstream: https://github.com/VERT-sh/VERT/tree/${commit}\nSource archive SHA256: ${sha256}\nAGPL-3.0; modified source: /third-party/vert/modified-source.tar.gz\nWebPC patches: nested base path, pc:vert: storage namespace, scoped reset/cache service worker, no forced isolation, remote-service probes blocked, remote avatars omitted, local CSP, hydration/lifecycle bridge. Native converters and their licenses retained. Frozen Bun1.3.14 build; pinned translation plugins.\n`);
// License notices from installed packages include native-converter wrappers and build tooling.
let bundledNotices='VERT build dependency notices (includes build-only packages)\n';
for (const top of await readdir(join(source,'node_modules'),{withFileTypes:true})) {
 if(top.name.startsWith('.'))continue;
 const packages=top.name.startsWith('@')?(await readdir(join(source,'node_modules',top.name))).map(name=>join(top.name,name)):[top.name];
 for(const name of packages){const directory=join(source,'node_modules',name);let pkg;try{pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'))}catch{continue}
  bundledNotices+=`\n=== ${pkg.name}@${pkg.version} (${JSON.stringify(pkg.license??'see upstream')}) ===\n`;
  for(const file of await readdir(directory)){if(!/^(LICENSE|LICENCE|COPYING|NOTICE|OFL)([.\-_]|$)/i.test(file))continue;try{if((await stat(join(directory,file))).isFile())bundledNotices+=`\n${file}\n${await readFile(join(directory,file),'utf8')}\n`}catch{}}
 }
}
await writeFile(join(notice,'DEPENDENCY-NOTICES.txt'),bundledNotices);
const stage=`${output}.staging-${process.pid}`;
try{await cp(join(source,'build'),stage,{recursive:true});await writeFile(join(stage,'release.json'),JSON.stringify({commit,sha256,url,fingerprint,bun:'1.3.14',plugins},null,2));await rm(output,{recursive:true,force:true});await rename(stage,output)}finally{await rm(stage,{recursive:true,force:true})}
console.log('Prepared actual VERT with local-only WebPC patches and AGPL source download.');
