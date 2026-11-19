import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
export const BASE='/pc/vendor/vert';
export async function patchVert(root) {
 const change=async(path,fn)=>{const full=join(root,path);const original=await readFile(full,'utf8');const changed=fn(original);if(changed===original)throw new Error(`VERT patch no longer applies: ${path}`);await writeFile(full,changed)};
 const replace=(text,from,to)=>{if(!text.includes(from))throw new Error(`Missing pinned VERT patch anchor: ${from.slice(0,80)}`);return text.replace(from,to)};
 // Namespace every authored local/session storage access, including dynamically constructed keys.
 async function namespace(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.name==='paraglide')continue;const path=join(dir,entry.name);if(entry.isDirectory())await namespace(path);else if(/\.(ts|js|svelte|html)$/.test(entry.name)){let text=await readFile(path,'utf8');const next=text.replace(/\b(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\(/g,"$1.$2(\"pc:vert:\" + ");if(next!==text)await writeFile(path,next)}}}
 await namespace(join(root,'src'));
 await change('vite.config.ts',s=>replace(replace(s,'paths: {','paths: {\n                base: "/pc/vendor/vert",'),'strategy: ["localStorage", "preferredLanguage", "baseLocale"],','strategy: ["localStorage", "preferredLanguage", "baseLocale"],\n            localStorageKey: "pc:vert:PARAGLIDE_LOCALE",\n            cookieName: "pc:vert:PARAGLIDE_LOCALE",'));
 await change('src/lib/sections/settings/vertdSettings.svelte.ts',s=>{
  s='import { DISABLE_ALL_EXTERNAL_REQUESTS } from "#lib/util/consts";\n'+s;
  s=replace(s,'public async url() {','public async url() {\n        if (DISABLE_ALL_EXTERNAL_REQUESTS) throw new Error("Remote conversion is disabled in WebPC");');
  return replace(s,'export function useVertdSizeLimit() {\n\t$effect(() => {','export function useVertdSizeLimit() {\n\t$effect(() => {\n        if (DISABLE_ALL_EXTERNAL_REQUESTS) return;');
 });
 await change('src/routes/+layout.svelte',s=>{
  s=replace(s,'import { onMount } from "svelte";','import { onMount } from "svelte";\n    import { mountWebPC } from "#lib/util/webpc";\n    import { setTheme } from "#lib/store/index.svelte";');
  s=replace(s,'Settings.instance.load();','Settings.instance.load();\n        const disposeWebPC = mountWebPC({ files, converters, setTheme });');
  s=replace(s,'window.removeEventListener("paste", handlePaste);','disposeWebPC();\n            window.removeEventListener("paste", handlePaste);');
  s=replace(s,'useVertdSizeLimit();','if (!DISABLE_ALL_EXTERNAL_REQUESTS) useVertdSizeLimit();');
  return replace(s,'href="/manifest.json"',`href="${BASE}/manifest.json"`);
 });
 await change('src/lib/sections/settings/Privacy.svelte',s=>{
  s=replace(s,'<script lang="ts">','<script lang="ts">\n    import { clearVertStorage } from "#lib/util/webpc-storage";');
  return replace(replace(replace(s,'localStorage.clear()','clearVertStorage(localStorage)'),'sessionStorage.clear()','clearVertStorage(sessionStorage)'), 'window.location.href = "/";',`window.location.href = "${BASE}/";`);
 });
 await change('src/lib/util/sw.ts',s=>{
  s=replace(s,'"/sw.js"',`"${BASE}/sw.js"`);s=replace(s,'scope: "/"',`scope: "${BASE}/"`);
  s=replace(s,'this.ensureCrossOriginIsolation();','// WebPC uses native non-isolated fallbacks; never reload the desktop to force COI.');
  return s;
 });
 await change('static/sw.js',s=>{
  s=s.replaceAll('vert-wasm-cache','pc-vert-wasm-cache');
  const start=s.indexOf('function withCrossOriginIsolation(response) {');const end=s.indexOf('// fetch a cacheable url',start);if(start<0||end<0)throw new Error('Missing SW isolation block');
  s=s.slice(0,start)+'// Cache-only service worker: no COOP/COEP header rewriting in WebPC.\nfunction withCrossOriginIsolation(response) { return response; }\n\n'+s.slice(end);
  s=replace(s,'const r = e.request;',`const r = e.request;\n    if (!r.url.startsWith(self.registration.scope)) return;`);
  s=replace(s,'caches.match(request).then((cachedResponse) => {','caches.open(CACHE_NAME).then(cache => cache.match(request)).then((cachedResponse) => {');
  return s;
 });
 await change('static/manifest.json',s=>{const manifest=JSON.parse(s);manifest.start_url=BASE+'/';manifest.scope=BASE+'/';return JSON.stringify(manifest,null,2)+'\n'});
 await change('src/lib/components/layout/Navbar/Base.svelte',s=>replace(s,'href={item.url}','href={resolve(item.url as "/")}').replaceAll('page.url.pathname',`page.url.pathname.replace("${BASE}", "")`).replaceAll('e.from?.url.pathname || ""',`e.from?.url.pathname.replace("${BASE}", "") || ""`).replaceAll('e.to?.url.pathname || ""',`e.to?.url.pathname.replace("${BASE}", "") || ""`));
 await change('src/lib/components/layout/Gradients.svelte',s=>s.replaceAll('page.url.pathname',`page.url.pathname.replace("${BASE}", "")`));
 await change('src/lib/store/index.svelte.ts',s=>replace(s,'const linksArr = Array.isArray(links) ? links : [links];','const linksArr = (Array.isArray(links) ? links : [links]).map(url => url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/pc/vendor/vert/") ? "/pc/vendor/vert" + url : url);'));
 await change('src/lib/components/layout/Footer.svelte',s=>replace(s,'href={GITHUB_URL_VERT}','href="/third-party/vert/modified-source.tar.gz"'));
 await change('src/routes/privacy/+page.svelte',s=>s.replaceAll('"/settings"', '"/pc/vendor/vert/settings/"').replaceAll('"/about"','"/pc/vendor/vert/about/"'));
 await change('src/lib/sections/about/Credits.svelte',s=>replace(s,'src={avatar}', 'src={DISABLE_ALL_EXTERNAL_REQUESTS && /^https?:/.test(avatar) ? undefined : avatar}'));
 await change('project.inlang/settings.json',s=>{const data=JSON.parse(s);data.modules=['./project.inlang/modules/plugin-message-format.js','./project.inlang/modules/plugin-m-function-matcher.js'];return JSON.stringify(data,null,2)+'\n'});
 await change('src/app.html',s=>replace(s,'<meta charset="utf-8" />',`<meta charset="utf-8" />\n        <meta name="webpc-vert" content="35ebeb1" />\n        <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:; worker-src 'self' blob:; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' data:; frame-src 'self' blob:; object-src 'none'" />`));
 // Make Privacy copy accurately describe a namespaced app reset (all supported locales retain upstream UI).
 await change('messages/en.json',s=>{const m=JSON.parse(s);const copy=m.settings.privacy.site_data;for(const [k,v]of Object.entries(copy))if(typeof v==='string')copy[k]=v.replace(/all site data/gi,'VERT data').replace(/all data/gi,'VERT data').replace('Site data management','VERT data management');copy.clear_all_data_confirm='This resets VERT preferences and its converter cache, then reloads VERT. Other WebPC apps are unchanged. Download conversion results first.';return JSON.stringify(m,null,2)+'\n'});
}
