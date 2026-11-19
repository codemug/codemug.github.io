import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
export async function patchUpstream(source, own) {
  async function patch(path, pairs, repo=source) {
    let text=execFileSync('git',['show',`HEAD:${path}`],{cwd:repo,encoding:'utf8'});
    for(const [from,to] of pairs){if(!text.includes(from))throw new Error(`Pinned Slides patch no longer matches ${path}: ${from.slice(0,70)}`);text=text.replace(from,to);}
    await writeFile(join(repo,path),text);
  }
  await patch('apps/web/vite.config.ts',[
    ["import { defineConfig }", "import { docsUiLifecycleFix } from './webpc-docs-ui-lifecycle.mjs';\nimport { writeFileSync } from 'node:fs';\nimport { defineConfig }"],
    ["  worker: {", "  worker: {\n    plugins: () => [{name:'webpc-worker-notices',generateBundle(){writeFileSync('webpc-worker-modules.json',JSON.stringify([...this.getModuleIds()].filter(id=>id.includes('/node_modules/.pnpm/'))));}}],"],
    ["plugins: [react()],", "plugins: [docsUiLifecycleFix(), react(), {name:'webpc-notices',generateBundle(){this.emitFile({type:'asset',fileName:'webpc-modules.json',source:JSON.stringify([...this.getModuleIds()].filter(id=>id.includes('/node_modules/.pnpm/')))})}}],"],
  ]);
  await patch('apps/web/src/App.tsx',[
    ["import { UniverSlide }", "import { readInitial, useWebpcHost, useWebpcViewport, beforeReplace, validateSnapshot } from './webpc-host';\nimport { UniverSlide }"],
    ['useState<ISlideData>(DEFAULT_SLIDE_DATA)','useState<ISlideData>(() => readInitial(DEFAULT_SLIDE_DATA))'],
    ['  const [opening, setOpening] = useState(false);','  const [opening, setOpening] = useState(false);\n  useWebpcHost(snapshot, setSnapshot, opening, saving);'],
    ['  const [zoom, setZoom] = useState(100);','  const [zoom, setZoom] = useState(100);\n  useWebpcViewport(snapshot,zoom,setZoom);'],
    ['const restore = zoomStateRef.current.priorZoom ?? zoom;', 'const restore = Math.min(zoomStateRef.current.priorZoom ?? zoom, innerWidth <= 600 ? Math.max(10, Math.floor((innerWidth - 96) / snapshot.pageSize.width * 100)) : 400);'],
    ['      setSnapshot(imported);','      validateSnapshot(imported);\n      if (!beforeReplace(true)) return;\n      setSnapshot(imported);'],
    ['        onRestore={(record) => {','        onRestore={(record) => {\n          if (!beforeReplace()) return;'],
    ['  function handleMakeCopy() {','  function handleMakeCopy() {\n    if (!beforeReplace()) return;'],
  ]);
  await patch('apps/web/src/shell/TitleBar.tsx',[
    ["if (typeof window !== 'undefined') window.location.reload();", "(window as any).webpcSlides?.new();"],
  ]);
  await patch('apps/web/src/pptx/client.ts',[
    ['        this.pending.clear();','        this.pending.clear();\n        this.worker?.terminate(); this.worker = null;'],
  ]);
  await patch('apps/web/src/pptx/fonts-loader.ts',[
    ['  injectFontLinks(buildGoogleFontsUrls(fonts));','  // WebPC supplies local fonts; unknown faces use browser fallbacks.'],
  ]);
  for(const name of ['BusyOverlay','UniverBootSplash','AutosaveRestoreBanner'])await copyFile(join(own,'upstream-support',`${name}.tsx`),join(source,'apps/web/src/shell',`${name}.tsx`));
  await writeFile(join(source,'apps/web/src/styles.css'),execFileSync('git',['show','HEAD:apps/web/src/styles.css'],{cwd:source,encoding:'utf8'})+'\n'+await readFile(join(own,'responsive.css'),'utf8'));
  await copyFile(join(own,'default-slide.ts'),join(source,'apps/web/src/default-slide.ts'));
  await copyFile(join(own,'docs-ui-lifecycle-fix.mjs'),join(source,'apps/web/webpc-docs-ui-lifecycle.mjs'));
  await copyFile(join(own,'upstream-host.ts'),join(source,'apps/web/src/webpc-host.ts'));
  await copyFile(join(own,'storage.mjs'),join(source,'apps/web/src/webpc-storage.mjs'));
  await writeFile(join(source,'apps/web/index.html'),`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'"><title>Casual Slides · WebPC</title><link rel="stylesheet" href="/pc/vendor/slides/fonts.css"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`);
}
