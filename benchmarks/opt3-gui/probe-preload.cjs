'use strict';
// Diagnostic builds only, fresh CI profiles. No page-visible capability.
const {ipcRenderer,webFrame}=require('electron');
if(process.isMainFrame!==false){
 ipcRenderer.on('gui-audit:sample',async(_event,token,clear)=>{
  const out={token,pid:process.pid,visibility:document.visibilityState,apiErrors:{},cacheClearAttempted:false};
  async function read(key,owner,method){
   if(typeof owner[method]!=='function'){out[key]=null;out.apiErrors[key]='unavailable';return;}
   try{out[key]=await owner[method]();}catch(e){out[key]=null;out.apiErrors[key]=e instanceof TypeError?'type-error':'read-failed';}
  }
  out.domNodes=document.getElementsByTagName('*').length;
  out.iframeCount=document.querySelectorAll('iframe').length;
  await read('resourcesBytes',webFrame,'getResourceUsage');
  await read('heapKiB',process,'getHeapStatistics');
  await read('blinkKiB',process,'getBlinkMemoryInfo');
  await read('processKiB',process,'getProcessMemoryInfo');
  const resources=out.resourcesBytes;
  out.unusedCacheBytes=resources?Object.values(resources).reduce((n,x)=>n+Math.max(0,(Number(x?.size)||0)-(Number(x?.liveSize)||0)),0):null;
  if(clear&&out.visibility==='hidden'&&out.unusedCacheBytes>1024*1024){
   try{webFrame.clearCache();out.cacheClearAttempted=true;await read('afterCacheBytes',webFrame,'getResourceUsage');}
   catch{out.apiErrors.cacheClear='failed';}
  }
  ipcRenderer.send('gui-audit:result',out);
 });
}
