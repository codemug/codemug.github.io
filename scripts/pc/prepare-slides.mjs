import { cp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeBundleNotices } from './docs/bundle-notices.mjs';
import { patchUpstream } from './slides/patch-upstream.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const revision='48397c257d8a67917990471f54a6e31bd15a51b4';
const source=join(root,'node_modules/.cache/webpc/casual-slides',revision);
const out=join(root,'public/pc/vendor/slides'), own=join(root,'scripts/pc/slides');
const notice=join(root,'public/third-party/casual-slides');
const exists=async p=>access(p).then(()=>true,()=>false);
const run=(cmd,args,cwd=source,env={})=>execFileSync(cmd,args,{cwd,stdio:'inherit',env:{...process.env,...env}});
const hash=createHash('sha256').update(revision);
for(const file of [fileURLToPath(import.meta.url),...['patch-upstream.mjs','docs-ui-lifecycle-fix.mjs','responsive.css','storage.mjs','upstream-host.ts','default-slide.ts','upstream-support/BusyOverlay.tsx','upstream-support/UniverBootSplash.tsx','upstream-support/AutosaveRestoreBanner.tsx'].map(x=>join(own,x))])hash.update(await readFile(file));
const fingerprint=hash.digest('hex');
if(await exists(join(out,'.prepared'))&&(await readFile(join(out,'.prepared'),'utf8'))===fingerprint){console.log('Casual Slides source build is current.');process.exit(0);}
await mkdir(source,{recursive:true});
if(!await exists(join(source,'.git'))){
  run('git',['init']);run('git',['remote','add','origin','https://github.com/CasualOffice/slides.git']);
  run('git',['fetch','--depth','1','origin',revision]);run('git',['checkout','--detach','FETCH_HEAD']);
}
const actual=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
if(actual!==revision)throw new Error('Unexpected Slides source revision');
const pnpm=join(root,'node_modules/pnpm/bin/pnpm.cjs');
if(!await exists(join(source,'node_modules/.modules.yaml')))run(process.execPath,[pnpm,'install','--frozen-lockfile','--ignore-scripts']);
await patchUpstream(source,own);
run(process.execPath,[pnpm,'--filter','@point/web','exec','vite','build'],source,{PAGES_BASE:'/pc/vendor/slides/',VITE_COLLAB_ENABLED:'false'});
await rm(out,{recursive:true,force:true});await cp(join(source,'apps/web/dist'),out,{recursive:true});
await mkdir(notice,{recursive:true});
const modules=[...JSON.parse(await readFile(join(out,'webpc-modules.json'),'utf8')),...JSON.parse(await readFile(join(source,'apps/web/webpc-worker-modules.json'),'utf8'))];
await writeBundleNotices({inputs:Object.fromEntries(modules.filter(id=>!id.includes('\0')).map(id=>[id,{}]))},root,join(notice,'BUNDLED-NOTICES.txt'));
await rm(join(out,'webpc-modules.json'));
for(const [path,name] of [['LICENSE','LICENSE']])await cp(join(source,path),join(notice,name));
await cp(join(root,'node_modules/@casualoffice/docs/dist/fonts'),join(out,'fonts'),{recursive:true});
await cp(join(root,'node_modules/@casualoffice/docs/dist/fonts/LICENSE'),join(notice,'fonts-LICENSE'));
let css='';
for(const [pkg,file,family] of [['inter','inter-latin-wght-normal.woff2','Inter'],['material-symbols-outlined','material-symbols-outlined-latin-wght-normal.woff2','Material Symbols Outlined']]){
 await cp(join(root,'node_modules/@fontsource-variable',pkg,'files',file),join(out,file));
 await cp(join(root,'node_modules/@fontsource-variable',pkg,'LICENSE'),join(notice,`${pkg}-LICENSE`));
 css+=`@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;font-display:swap;src:url('./${file}')}\n`;
}
for(const [family,file] of [['Arial','LiberationSans'],['Calibri','Carlito'],['Cambria','Caladea'],['Times New Roman','LiberationSerif'],['Courier New','LiberationMono']])for(const [style,weight,suffix] of [['normal',400,'Regular'],['normal',700,'Bold'],['italic',400,'Italic'],['italic',700,'BoldItalic']])css+=`@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url('./fonts/${file}-${suffix}.woff2')}\n`;
await writeFile(join(out,'fonts.css'),css);
await writeFile(join(out,'.prepared'),fingerprint);
console.log(`Prepared actual CasualOffice Slides ${revision}.`);
