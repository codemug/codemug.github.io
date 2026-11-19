import test from 'node:test';
import assert from 'node:assert/strict';
import {validateName, joinPath} from '../src/scripts/pc/files/store.mjs';

test('valid folder and file names pass', () => {
 for(const name of['docs','a.txt','My Folder (1)','a-b_c.d', 'x'.repeat(255)])assert.equal(validateName(name),'',name);
});

test('invalid names are rejected with a reason', () => {
 for(const name of['','x'.repeat(256),'a/b','a\\b','.','..','bad\u0000name','tab\there','del\u007fhere'])assert.ok(validateName(name).length>0,JSON.stringify(name));
});

test('joinPath joins validated segments and rejects escaping or unsafe names', () => {
 assert.equal(joinPath(),'');
 assert.equal(joinPath('docs'),'docs');
 assert.equal(joinPath('docs','specs','a.txt'),'docs/specs/a.txt');
 assert.throws(()=>joinPath('docs','../other'),/reserved|control|not be empty|too long|contain/);
 assert.throws(()=>joinPath('a/b'),/contain/);
 assert.throws(()=>joinPath('..'),/reserved/);
});

test('a 255-character name is the length boundary', () => {
 assert.equal(validateName('a'.repeat(255)),'');
 assert.match(validateName('a'.repeat(256)),/too long/);
});
