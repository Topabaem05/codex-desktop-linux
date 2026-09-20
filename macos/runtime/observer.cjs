'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const {LineDecoder}=require('./telemetry.cjs');
function validateSample(data,pid,uid){
 const root=data?.root,rows=data?.processes;
 if(root?.pid!==pid||root.uid!==uid||typeof root.startId!=='string'||!root.startId||!Array.isArray(rows)||!rows.length||rows.length>8192)throw Error('Invalid native sample');
 const seen=new Set();let bytes=0;
 for(const r of rows){
  if(r.uid!==uid||!Number.isInteger(r.pid)||r.pid<1||seen.has(r.pid))throw Error('Invalid native scope');
  seen.add(r.pid);
  if(r.footprintBytes===null)bytes=null;
  else if(!Number.isSafeInteger(r.footprintBytes)||r.footprintBytes<0)throw Error('Invalid footprint');
  else if(bytes!==null){bytes+=r.footprintBytes;if(!Number.isSafeInteger(bytes))throw Error('Footprint overflow');}
 }
 if(!seen.has(pid)||rows.find(r=>r.pid===pid).startId!==root.startId)throw Error('Root missing or reused');
 return {...data,bytes};
}
function observe({pid=process.pid,uid=process.getuid(),onSample,onPressure,onError,
 helper=path.join(__dirname,'budget/native/macos-memory')}){
 const child=spawn(helper,['--watch',String(pid)],{stdio:['ignore','pipe','ignore']});
 let closed=false,identity=null,lastSample=Date.now();
 const stop=()=>{if(closed)return;closed=true;clearInterval(watchdog);if(child.exitCode===null&&child.signalCode===null)child.kill();child.stdout.destroy();};
 const fail=()=>{if(!closed){try{onError();}finally{stop();}}};
 const decoder=new LineDecoder(data=>{
  if(Object.hasOwn(data,'pressure')){
   if(!['unknown','normal','warning','critical'].includes(data.pressure))throw Error('Invalid pressure');
   onPressure(data.pressure);return;
  }
  const s=validateSample(data,pid,uid),key=`${s.root.uid}:${s.root.pid}:${s.root.startId}`;
  if(identity&&identity!==key)throw Error('PID reused');identity=key;
  lastSample=Date.now();onSample(s);
 });
 const watchdog=setInterval(()=>{if(Date.now()-lastSample>45000)fail();},15000);watchdog.unref();
 child.stdout.on('data',b=>{try{decoder.append(b);}catch{fail();}});
 child.on('error',fail);child.on('exit',()=>{if(!closed)fail();});
 return stop;
}
module.exports={validateSample,observe};
