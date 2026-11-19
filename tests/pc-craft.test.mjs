import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFile,validSave} from '../scripts/pc/craft/releases.mjs';
const json=value=>new TextEncoder().encode(JSON.stringify(value));
test('Craft recovery accepts native documents without replacing them with exports',()=>{
 assert.equal(nativeFile('figcraft','design.figcraft'),true);
 assert.equal(nativeFile('figcraft','design.json',json({format:'figcraft',version:1,pages:[1],nodes:{1:{type:'page'}}})),true);
 for(const [name,data] of [['variables.json',{collections:[]}],['styles.json',{format:'figcraft',styles:[]}],['broken.json','{bad']])assert.equal(nativeFile('figcraft',name,json(data)),false);
 assert.equal(nativeFile('figcraft','preview.png'),false);
 assert.equal(nativeFile('soundcraft','session.scraftz'),true);
 assert.equal(nativeFile('soundcraft','session.scraft'),false,'plain session may omit media');
 assert.equal(nativeFile('soundcraft','mix.wav'),false);
 assert.equal(nativeFile('pdfcraft','document.PDF'),true);
  assert.equal(nativeFile('lightcraft','photo.png'),false,'native LightCraft owns its library');
  assert.equal(nativeFile('filmcraft','edit.fcproj'),true);
  assert.equal(nativeFile('filmcraft','Edit.FCPROJ'),true);
  assert.equal(nativeFile('filmcraft','final.mp4'),false,'video exports are not projects');
  assert.equal(nativeFile('filmcraft','mix.wav'),false);
  assert.equal(nativeFile('cadcraft','drawing.dxf'),true);
  assert.equal(nativeFile('cadcraft','Drawing.DXF'),true);
  assert.equal(nativeFile('cadcraft','drawing.dwg'),true,'DWG is a selectable save format');
  assert.equal(nativeFile('cadcraft','drawing.svg'),false,'SVG is an export');
  assert.equal(nativeFile('cadcraft','symbols.shx'),false);
});
test('Craft save messages need a bounded filename and actual binary data',()=>{
 assert.equal(validSave({name:'a.pdf',bytes:new Uint8Array([1,2])}),true);
 assert.equal(validSave({name:'a.pdf',bytes:new ArrayBuffer(2)}),true);
 for(const value of [null,{}, {name:'a.pdf',bytes:[1,2]}, {name:'',bytes:new ArrayBuffer(1)}, {name:'x'.repeat(256),bytes:new ArrayBuffer(1)}])assert.equal(validSave(value),false);
});
