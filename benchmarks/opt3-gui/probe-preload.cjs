'use strict';
// Diagnostic builds only, fresh CI profiles. No page-visible capability.
const {ipcRenderer,webFrame}=require('electron');
if(process.isMainFrame!==false){
 ipcRenderer.on('gui-audit:sample',async(_event,token,clear)=>{
  try{
   const resources=webFrame.getResourceUsage();
   const unused=Object.values(resources).reduce((n,x)=>n+(Number(x?.unusedSize)||0),0);
   const out={token,pid:process.pid,visibility:document.visibilityState,
    heapKiB:process.getHeapStatistics(),blinkKiB:process.getBlinkMemoryInfo(),
    processKiB:await process.getProcessMemoryInfo(),resourcesBytes:resources,
    domNodes:document.getElementsByTagName('*').length,iframeCount:document.querySelectorAll('iframe').length,
    cacheClearAttempted:false};
   if(clear&&document.visibilityState==='hidden'&&unused>1024*1024){
    out.cacheClearAttempted=true;webFrame.clearCache();out.afterCacheBytes=webFrame.getResourceUsage();
   }
   ipcRenderer.send('gui-audit:result',out);
  }catch{ipcRenderer.send('gui-audit:result',{token,pid:process.pid,error:'renderer-probe-unavailable'});}
 });
}
