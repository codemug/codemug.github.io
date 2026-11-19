// Pinned Univer 0.24.0 use-resize hook: its 30ms debounce and 500ms timer
// outlive a render unit disposed before React's passive effect cleanup.
// Bind cancellation to both lifetimes. Do not swallow disposed-injector errors.
export function docsUiLifecycleFix() {
 return {name:'webpc-docs-ui-lifecycle',enforce:'pre',transform(code,id){
  if(!id.endsWith('/@univerjs/docs-ui/lib/es/index.js'))return;
  const start=code.indexOf('//#region src/views/rich-text-editor/hooks/use-resize.ts');
  const end=code.indexOf('//#endregion',start);
  if(start<0||end<0)throw new Error('Pinned rich-text resize hook is missing');
  let hook=code.slice(start,end);
  const pairs=[
   ['\t\t\t}, 500);\n\t\t\treturn () => {\n\t\t\t\tclearTimeout(time);', '\t\t\t}, 500);\n\t\t\tconst releaseTimer = editor.render.disposeWithMe(() => clearTimeout(time));\n\t\t\treturn () => {\n\t\t\t\tclearTimeout(time);\n\t\t\t\treleaseTimer.dispose();'],
   ['\t\t\tconst d = editor.input$.subscribe(() => {', '\t\t\tconst releaseDebounce = editor.render.disposeWithMe(() => checkScrollBar.cancel());\n\t\t\tconst d = editor.input$.subscribe(() => {'],
   ['\t\t\t\td.unsubscribe();', '\t\t\t\td.unsubscribe();\n\t\t\t\tcheckScrollBar.cancel();\n\t\t\t\treleaseDebounce.dispose();'],
  ];
  for(const [from,to] of pairs){if(!hook.includes(from))throw new Error('Pinned rich-text resize cleanup no longer matches');hook=hook.replace(from,to);}
  return {code:code.slice(0,start)+hook+code.slice(end),map:null};
 }};
}
