'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'probe-preload.cjs'),'utf8');
async function exercise(visibility,resources,missing=false){
 let handler,clears=0,result;
 const electron={ipcRenderer:{on:(_n,fn)=>handler=fn,send:(_n,value)=>result=value},webFrame:{getResourceUsage:()=>resources,clearCache:()=>clears++}};
 const process={isMainFrame:true,pid:123,getHeapStatistics:()=>({usedHeapSize:1}),getBlinkMemoryInfo:()=>({allocated:1}),getProcessMemoryInfo:async()=>({private:1})};
 if(missing)delete process.getHeapStatistics;
 const document={visibilityState:visibility,getElementsByTagName:()=>[],querySelectorAll:()=>[]};
 vm.runInNewContext(source,{require:n=>{assert.equal(n,'electron');return electron;},process,document});
 await handler(null,'test',true);return {clears,result};
}
test('unused cache is documented size minus liveSize',async()=>{
 const {clears,result}=await exercise('hidden',{images:{count:2,size:4*1048576,liveSize:1048576}});
 assert.equal(clears,1);assert.equal(result.unusedCacheBytes,3*1048576);
});
test('visible contents are never cache-cleared',async()=>{
 assert.equal((await exercise('visible',{scripts:{size:4*1048576,liveSize:0}})).clears,0);
});
test('small unused cache does not justify a clear',async()=>{
 assert.equal((await exercise('hidden',{scripts:{size:500,liveSize:200}})).clears,0);
});
test('one unavailable sandbox API preserves other measurements',async()=>{
 const {result}=await exercise('hidden',{images:{size:200,liveSize:50}},true);
 assert.equal(result.domNodes,0);assert.equal(result.unusedCacheBytes,150);
 assert.equal(result.heapKiB,null);assert.equal(result.apiErrors.heapKiB,'unavailable');
});
