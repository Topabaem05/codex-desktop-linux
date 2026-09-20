'use strict';
// Test-only launch selection. Immutable boolean, no native/callable capability.
const {contextBridge}=require('electron');
if(process.isMainFrame!==false&&location.protocol==='app:'&&location.hostname==='-'){
 contextBridge.exposeInMainWorld('__codexCommunityHighlightBudget',false);
}
