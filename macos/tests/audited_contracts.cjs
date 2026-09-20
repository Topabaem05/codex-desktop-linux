'use strict';
// Exercise classes from the actual patched, digest-verified bundle, not a reimplementation.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const s=fs.readFileSync(process.argv[2],'utf8');
function between(a,b){const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i,`Missing audited contract ${a}`);return s.slice(i+a.length,j);}
const queue='class'+between('ove=class',',sve=class');
const getter='getTextDeltaQueue(){'+between('getTextDeltaQueue(){','getOutputDeltaQueue(){');
for(const enabled of [true,false]){
 const ctx={__codexCommunityLowMemory:enabled,ive:16,Tb:24,ave:8};vm.createContext(ctx);
 const q=vm.runInContext(`(${queue})`,ctx);ctx.ove=q;
 const manager=vm.runInContext(`new(class{${getter}})`,ctx);
 let pending=[],received='';
 manager.scheduler={schedule:(f,ms)=>{const item={f,ms,active:true};pending.push(item);return()=>{item.active=false;};},
  scheduleAnimationFrame:f=>{const item={f,ms:16,active:true};pending.push(item);return()=>{item.active=false;};},canUseAnimationFrame:()=>true};
 manager.applyFrameTextDeltas=items=>{for(const item of items)received+=item.delta;};
 const instance=manager.getTextDeltaQueue();
 instance.enqueue({conversationId:'x',turnId:'turn',itemId:'message',target:{type:'agentMessage'},delta:'한글 abc'});
 assert.equal(received,'');assert.equal(pending.at(-1).ms,enabled?75:16);
 // Completion barriers must finish all text before the caller processes completion.
 if(enabled){assert.equal(instance.drainBefore(()=>{throw Error('unneeded delay');}),false);assert.equal(received,'한글 abc');}
 else instance.flushNow();
 const large='x'.repeat(70000);
 instance.enqueue({conversationId:'x',turnId:'turn',itemId:'message',target:{type:'agentMessage'},delta:large});
 if(enabled)assert.equal(instance.getBufferedDeltaLength(),0);
 instance.flushNow();assert.equal(received,'한글 abc'+large);
 // The real inactivity manager must keep active turns, approvals and followers.
 const ret=s.match(/_b=([^;]+?),Z_e=15e3,vb=(.+?),Q_e=class/);assert.ok(ret);
 const values=vm.runInContext(`[${ret[1]},${ret[2]}]`,ctx);
 assert.equal(values[0],enabled?60000:10800000);assert.equal(values[1],enabled?2:10);
}
assert.ok(s.includes('e.threadRuntimeStatus?.type===`active`'));
assert.ok(s.includes('hasOwnedStreamFollowers'));
console.log(JSON.stringify({passed:true,patchedRealQueue:true,lossless:true,completionBarrier:true,safeModeRestoresConstants:true}));
// Re-check liveness at the async unsubscribe boundary, not just during selection.
(async()=>{
 const {findMatchingBrace}=require('../../scripts/patches/lib/minified-js.js');
 const begin=s.indexOf('Q_e=class')+'Q_e='.length,open=s.indexOf('{',begin),end=findMatchingBrace(s,open);
 const ctx={__codexCommunityLowMemory:true,$_:(e)=>e.turns,ev:e=>e.turns.at(-1),mb:()=>null,yb:()=>false,Y_:e=>e.turns,I_:e=>!!e.approvalRequired};
 vm.createContext(ctx);const Class=vm.runInContext(`(${s.slice(begin,end+1)})`,ctx);
 const instance=Object.create(Class.prototype);instance.unsubscribingConversationIds=new Set();instance.inactiveOwnerConversationSinceById=new Map();
 let active=true,followers=false,calls=0;
 const thread={id:'one',resumeState:'resumed',rolloutPath:'saved',threadRuntimeStatus:{type:'idle'},turns:[{status:'completed',items:[]}]};
 instance.params={threadStore:{getConversation:()=>thread,isConversationActive:()=>active},streamState:{getStreamRole:()=>({role:'owner'}),ownsConversationHistoryStream:()=>true,hasFollowersOrPendingFollowerReconnect:()=>followers},logger:{debug(){},info(){}},requestClient:{sendRequest:async()=>{calls++;throw Error('Active conversation must not unsubscribe');}}};
 let error;try{await instance.unsubscribeInactiveConversation('one');}catch(e){error=e;}assert.equal(calls,0);assert.equal(error,undefined);
 active=false;followers=true;await instance.unsubscribeInactiveConversation('one');assert.equal(calls,0);
 followers=false;thread.threadRuntimeStatus={type:'active'};await instance.unsubscribeInactiveConversation('one');assert.equal(calls,0);
 thread.threadRuntimeStatus={type:'idle'};thread.turns=[{status:'inProgress',items:[]}];await instance.unsubscribeInactiveConversation('one');assert.equal(calls,0);
 thread.turns=[{status:'completed',items:[{approvalRequired:true}]}];await instance.unsubscribeInactiveConversation('one');assert.equal(calls,0);
 console.log(JSON.stringify({inactiveReleaseRaceGuards:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
