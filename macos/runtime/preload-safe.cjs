'use strict';
const {contextBridge,ipcRenderer}=require('electron');
if(process.isMainFrame!==false&&location.protocol==='app:'&&location.hostname==='-'){
 contextBridge.exposeInMainWorld('__codexCommunityLowMemory',false);
 window.addEventListener('DOMContentLoaded',()=>ipcRenderer.send('codex-community:safe-ready'),{once:true});
}
