'use strict';
// Equal instrumentation in temporary original/opt3 copies; never shipped.
const {app,ipcMain,webContents}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),v8=require('node:v8');
const {randomUUID}=require('node:crypto');
const destination=process.env.CODEX_GUI_AUDIT_DIR;
if(!destination)throw Error('Diagnostic destination required');
const registered=new WeakSet(),responses=new Map();let sequence=Promise.resolve();
function register(session){
 if(registered.has(session))return;registered.add(session);
 session.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'probe-preload.cjs')});
}
app.on('session-created',register);
app.on('web-contents-created',(_e,wc)=>register(wc.session));
ipcMain.on('gui-audit:result',(event,value)=>{
 if(event.senderFrame!==event.sender.mainFrame||!value||typeof value.token!=='string')return;
 const pending=responses.get(value.token);
 if(!pending||pending.id!==event.sender.id)return;
 if(JSON.stringify(value).length>32768)return;
 responses.delete(value.token);clearTimeout(pending.timer);pending.resolve(value);
});
const bucket=value=>{try{const u=new URL(value);return u.protocol==='app:'?'packaged-app':u.protocol==='file:'?'file':u.protocol==='about:'?'about':u.protocol==='https:'?'https':'other';}catch{return 'empty';}};
function inspect(wc,clear){return new Promise(resolve=>{
 const token=randomUUID();const timer=setTimeout(()=>{responses.delete(token);resolve({error:'probe-timeout'});},3000);
 responses.set(token,{id:wc.id,timer,resolve});
 try{wc.send('gui-audit:sample',token,clear);}catch{clearTimeout(timer);responses.delete(token);resolve({error:'send-failed'});}
});}
async function snapshot(label,clear=false){
 const started=performance.now();
 const contents=webContents.getAllWebContents().filter(w=>!w.isDestroyed()).slice(0,32);
 const rows=await Promise.all(contents.map(async wc=>{
  const row={id:wc.id,type:wc.getType(),pid:wc.getOSProcessId(),originClass:bucket(wc.getURL()),loading:wc.isLoading()};
  row.probe=await inspect(wc,clear);return row;
 }));
 const rtt=[];
 for(const wc of contents.filter(w=>!w.isDestroyed()&&w.getType()==='window')){
  const durations=[];
  for(let i=0;i<8;i++){
   const t=performance.now();
   let timer;try{await Promise.race([wc.executeJavaScript('1',false),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),1000);timer.unref();})]);durations.push(performance.now()-t);}
   catch{break;}finally{clearTimeout(timer);}
  }
  rtt.push({id:wc.id,count:durations.length,ms:durations});
 }
 const out={label,elapsedMs:performance.now(),durationMs:performance.now()-started,
  main:{pid:process.pid,heapBytes:v8.getHeapStatistics(),memoryBytes:process.memoryUsage()},
  processMetrics:app.getAppMetrics().map(x=>({pid:x.pid,type:x.type,cpu:x.cpu,memoryKiB:x.memory})),contents:rows,ipcEvaluationRtt:rtt};
 await fs.mkdir(destination,{recursive:true,mode:0o700});
 await fs.writeFile(path.join(destination,label+'.json'),JSON.stringify(out,null,2),{mode:0o600});
}
app.whenReady().then(()=>{
 for(const w of webContents.getAllWebContents())register(w.session);
 // Serial probes, no unbounded timers/parallel requests.
 for(const [seconds,label,clear] of [[25,'visible-25',false],[50,'visible-50',false],[70,'hidden-70',false],[78,'cache-clear-78',true],[85,'after-clear-85',false]]){
  setTimeout(()=>{sequence=sequence.then(()=>snapshot(label,clear)).catch(()=>{});},seconds*1000).unref();
 }
});
