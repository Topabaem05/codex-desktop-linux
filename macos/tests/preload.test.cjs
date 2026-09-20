'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function boot(file,unused=0){
 const handlers={},sent=[],flags={};let cleared=0;
 const ctx={process:{isMainFrame:true},location:{protocol:'app:',hostname:'-'},document:{visibilityState:'hidden'},
 window:{addEventListener:(event,cb)=>{handlers[event]=cb;}},Date,console,
 require:()=>({contextBridge:{exposeInMainWorld:(k,v)=>flags[k]=v},ipcRenderer:{on:(event,cb)=>handlers[event]=cb,send:(...x)=>sent.push(x)},
 webFrame:{getResourceUsage:()=>({images:{size:unused,liveSize:0}}),clearCache:()=>{cleared++;unused=0;}}})};
 vm.runInNewContext(fs.readFileSync(require.resolve(file),'utf8'),ctx);
 return{handlers,sent,flags,cleared:()=>cleared};
}
test('preload publishes only a read-only tuning boolean before app scripts',()=>{
 const a=boot('../runtime/preload.cjs');assert.equal(a.flags.__codexCommunityLowMemory,true);
});
test('cache release skips tiny caches and reports actual observed delta',()=>{
 const a=boot('../runtime/preload.cjs',8);a.handlers['codex-community:release-unused']();assert.equal(a.cleared(),0);
 const b=boot('../runtime/preload.cjs',100000);b.handlers['codex-community:release-unused']();assert.equal(b.cleared(),1);
 const event=b.sent.find(x=>x[0]==='codex-community:cache-result');assert.equal(event[1].sizeDelta,100000);
 b.handlers['codex-community:release-unused']();assert.equal(b.cleared(),1);
});
test('safe preload disables only the optimization boolean',()=>{
 const a=boot('../runtime/preload-safe.cjs');assert.equal(a.flags.__codexCommunityLowMemory,false);assert.deepEqual(Object.keys(a.handlers),['DOMContentLoaded']);a.handlers.DOMContentLoaded();assert.equal(a.sent[0][0],'codex-community:safe-ready');
});
