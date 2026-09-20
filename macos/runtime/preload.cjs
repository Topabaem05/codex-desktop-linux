'use strict';
// A read-only boolean is the only page-visible addition. No callable capabilities.
const {ipcRenderer,webFrame,contextBridge}=require('electron');
if(process.isMainFrame!==false){
 const local=location.protocol==='app:'&&location.hostname==='-';
 if(local)contextBridge.exposeInMainWorld('__codexCommunityLowMemory',true);
 let last=0,cooldown=60000;
 function unused(){
  let total=0;
  for(const item of Object.values(webFrame.getResourceUsage())){
   if(!Number.isFinite(item.size)||!Number.isFinite(item.liveSize))continue;
   total+=Math.max(0,item.size-item.liveSize);
  }
  return total;
 }
 ipcRenderer.on('codex-community:release-unused',()=>{
  const now=Date.now();if(document.visibilityState!=='hidden'||now-last<cooldown)return;
  last=now;
  try{
   const before=unused();let delta=0,released=false;
   if(before>=65536){webFrame.clearCache();delta=Math.max(0,before-unused());released=true;}
   cooldown=delta>0?60000:Math.min(600000,cooldown*2);
   ipcRenderer.send('codex-community:cache-result',{released,unusedSize:before,sizeDelta:delta});
  }catch{ipcRenderer.send('codex-community:cache-result',{released:false,unusedSize:null,sizeDelta:null});}
 });
 window.addEventListener('DOMContentLoaded',()=>ipcRenderer.send('codex-community:preload-ready'),{once:true});
}
