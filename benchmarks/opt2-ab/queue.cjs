'use strict';
// Deterministic event-loop replay of the exact original/patched queue. No React/GPU timing claim.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function replay(source,enabled,chunk,conversations){
 function between(a,b){const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i);return source.slice(i+a.length,j);}
 const ctx={__codexCommunityLowMemory:enabled,ive:16,Tb:24,ave:8};vm.createContext(ctx);
 ctx.ove=vm.runInContext(`(class${between('ove=class',',sve=class')})`,ctx);
 const getter='getTextDeltaQueue(){'+between('getTextDeltaQueue(){','getOutputDeltaQueue(){');
 const m=vm.runInContext(`new(class{${getter}})`,ctx);
 let now=0,jobs=[],flushes=0,peak=0,first=null;const got=new Map(),wanted=new Map();
 function schedule(fn,ms){const job={fn,time:now+ms,active:true};jobs.push(job);return()=>{job.active=false;};}
 m.scheduler={schedule,scheduleAnimationFrame:fn=>schedule(fn,16),canUseAnimationFrame:()=>true};
 m.applyFrameTextDeltas=items=>{flushes++;if(first===null)first=now;for(const item of items)got.set(item.conversationId,(got.get(item.conversationId)||'')+item.delta);};
 const q=m.getTextDeltaQueue();
 function advance(until){let n=0;while(true){jobs=jobs.filter(j=>j.active).sort((a,b)=>a.time-b.time);const j=jobs[0];if(!j||j.time>until)break;jobs.shift();now=j.time;j.fn();assert.ok(n++<100000);}now=until;}
 for(let i=0;i<500;i++){
  advance(i*20);
  for(let c=0;c<conversations;c++){
   const id='c'+c;wanted.set(id,(wanted.get(id)||'')+chunk);
   q.enqueue({conversationId:id,turnId:'turn',itemId:'item',target:{type:'agentMessage'},delta:chunk});
  }
  peak=Math.max(peak,q.getBufferedDeltaLength());
 }
 const end=now;let done=null;
 if(!q.drainBefore(()=>{done=now;}))done=now;
 advance(end+1000);assert.equal(q.getBufferedDeltaLength(),0);assert.deepEqual([...got],[...wanted]);
 return {mode:enabled?'opt2':'original',conversations,codeUnitsPerSecondPerConversation:chunk.length*50,flushCallbacks:flushes,firstDisplayDelaySimulatedMs:first,completionDelaySimulatedMs:done-end,peakBufferedCodeUnits:peak,textPreserved:true};
}
if(require.main===module){
 const [a,b]=process.argv.slice(2),results=[];
 for(const count of [1,3])for(const chunk of ['가나다라abcd','가나다라abcd'.repeat(10)]){
  results.push(replay(fs.readFileSync(a,'utf8'),false,chunk,count),replay(fs.readFileSync(b,'utf8'),true,chunk,count));
 }
 console.log(JSON.stringify({scope:'exact bundled JavaScript queue with simulated 50-Hz input and 16-ms frames; not app FPS, elapsed time, token throughput or whole-agent benchmark',results},null,2));
}
module.exports={replay};
