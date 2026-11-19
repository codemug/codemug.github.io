import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY, LEGACY_KEY, encodeBackup, decodeBackup } from '../scripts/pc/slides/storage.mjs';
const deck=()=>({id:'deck',title:'Useful deck',pageSize:{width:960,height:540},resources:[{name:'OOXML',data:'{"mediaBin":{"sound":"AA=="}}'}],body:{pageOrder:['one'],pages:{one:{id:'one',description:'Notes',pageElements:{image:{id:'image',type:1,image:{contentUrl:'data:image/png;base64,AA=='}}}}}}});
test('Casual Slides backups preserve native resources, media, notes and extension fields',()=>{
 const value=deck();value.body.pages.one.pageElements.image.extension={future:true};
 assert.deepEqual(decodeBackup(encodeBackup(value)),value);assert.notEqual(KEY,LEGACY_KEY);
});
test('Casual Slides rejects malformed, foreign, prototype-bearing and inconsistent snapshots',()=>{
 for(const value of ['{bad','{}','{"format":"webpc-casual-slides","version":1,"snapshot":{"__proto__":{}}}'])assert.throws(()=>decodeBackup(value));
 for(const alter of [d=>d.body.pageOrder.push('one'),d=>d.body.pageOrder.push('missing'),d=>d.body.pages.one.pageElements.image=null,d=>d.pageSize.width=0,d=>d.body.pages.one.id='different']){const value=deck();alter(value);assert.throws(()=>encodeBackup(value));}
});
