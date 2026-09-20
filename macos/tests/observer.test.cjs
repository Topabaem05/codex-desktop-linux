'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
let api;try{api=require('../runtime/observer.cjs');}catch{}
test('persistent observer exists',()=>assert.ok(api));
if(api){
 test('sample validates root identity, scope and unknown bytes',()=>{
  const sample={root:{pid:100,uid:1,startId:'1:2'},processes:[{pid:100,uid:1,startId:'1:2',footprintBytes:42,role:'other'}]};
  assert.equal(api.validateSample(sample,100,1).bytes,42);
  assert.equal(api.validateSample({...sample,processes:[{...sample.processes[0],footprintBytes:null}]},100,1).bytes,null);
  assert.throws(()=>api.validateSample({...sample,processes:[]},100,1));
  assert.throws(()=>api.validateSample({...sample,processes:[...sample.processes,...sample.processes]},100,1));
  assert.throws(()=>api.validateSample(sample,200,1));
 });
 test('native watch contract is implemented without removing CLI one-shot mode',()=>{
  const s=fs.readFileSync(require.resolve('../../linux-features/low-memory-budget/native/macos-memory.c'),'utf8');
  assert.match(s,/--watch/);assert.match(s,/proc_pidpath/);assert.match(s,/watch_identity/);
 });
}
