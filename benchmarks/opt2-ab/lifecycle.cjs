'use strict';
// Test fixtures only: no account, model turn, user configuration or project.
const fs=require('node:fs/promises'), path=require('node:path'), os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {LineDecoder}=require('../../macos/runtime/telemetry.cjs');
const policy=require('../../macos/runtime/session-policy.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function probe(helper,pid){try{return JSON.parse(execFileSync(helper,[String(pid)],{timeout:3000,stdio:['ignore','pipe','ignore']}));}catch{return null;}}
function same(a,b){return !!a&&!!b&&!!a.startId&&a.pid===b.pid&&a.uid===b.uid&&a.startId===b.startId;}
function exists(pid){try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
async function scenario(binary,helper,mode,shutdown,fixture,rounds){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'codex-ab-'));const marker=path.join(root,'starts');
 const sentinel=path.join(root,'sentinel.cjs');let child,sequence=0,closed=false;const pending=new Map(),known=new Map();
 const result={mode,shutdown,fixture,rounds,modelTurns:0,latenciesMs:[],samples:[]};
 let errorTail='';
 try{
  await fs.writeFile(sentinel,`const fs=require('node:fs'),{spawn}=require('node:child_process');
const [marker,kind,behavior]=process.argv.slice(2);
fs.appendFileSync(marker,JSON.stringify({pid:process.pid,ppid:process.ppid,kind})+'\\n');
if(behavior==='stubborn')process.on('SIGTERM',()=>{});
const timer=setInterval(()=>{},1000);
if(kind==='worker'){}else{
const worker=spawn(process.execPath,[__filename,marker,'worker',behavior],{stdio:'ignore'});
const rl=require('node:readline').createInterface({input:process.stdin});
if(behavior==='cooperative')rl.on('close',()=>{worker.kill('SIGTERM');clearInterval(timer);});
rl.on('line',line=>{const x=JSON.parse(line);if(x.id===undefined)return;
const result=x.method==='initialize'?{protocolVersion:x.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'sentinel',version:'1'}}:x.method==='tools/list'?{tools:[{name:'sentinel',description:'local test',inputSchema:{type:'object',properties:{}}}]}:{};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:x.id,result})+'\\n');});}
`);
  const config=['[features]','plugins = false'];
  for(const name of ['sentinel','sentinel.dot'])config.push(`[mcp_servers.${JSON.stringify(name)}]`,`command = ${JSON.stringify(process.execPath)}`,`args = ${JSON.stringify([sentinel,marker,'server',fixture])}`,'startup_timeout_sec = 5');
  await fs.writeFile(path.join(root,'config.toml'),config.join('\n'));
  child=spawn(binary,['app-server'],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root,TMPDIR:root},detached:true,stdio:['pipe','pipe','pipe']});
  const fail=e=>{for(const x of pending.values()){clearTimeout(x.timer);x.reject(e);}pending.clear();};
  child.on('error',fail);child.on('exit',()=>{closed=true;fail(Error('Server exited'));});child.stdin.on('error',fail);
  child.stderr.on('data',b=>{errorTail=(errorTail+b).slice(-4096);});
  const decoder=new LineDecoder(msg=>{const p=pending.get(msg.id);if(!p)return;pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);});
  child.stdout.on('data',b=>{try{decoder.append(b);}catch(e){fail(e);}});
  function request(method,params={}){return new Promise((resolve,reject)=>{
   const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`Timeout ${method}`));},20000);
   pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });}
  async function capture(){
   let lines=[];try{lines=(await fs.readFile(marker,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
   assert.ok(lines.length<=160,'Fixture growth budget exceeded');
   for(const line of lines)if(!known.has(line.pid)){
    const p=probe(helper,line.pid);if(p&&p.root.uid===process.getuid())known.set(line.pid,p.root);
   }
   const live=[],unknown=[];
   for(const row of lines)if(!known.has(row.pid)&&exists(row.pid))unknown.push(row.pid);
   for(const [pid,id]of known){const p=probe(helper,pid);if(same(p?.root,id)){
    try{const stat=execFileSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'}).trim();
     if(!stat.startsWith('Z'))live.push(pid);
    }catch{if(exists(pid))unknown.push(pid);}
   }else if(!p&&exists(pid))unknown.push(pid);}
   const tree=!closed?probe(helper,child.pid):null;
   const rows=tree?.processes;const bytes=rows?.every(x=>Number.isInteger(x.footprintBytes))?rows.reduce((a,b)=>a+b.footprintBytes,0):null;
   return {starts:lines.length,serverStarts:lines.filter(x=>x.kind==='server').length,knownIdentities:known.size,liveFixtureProcesses:live.length,unknownLiveIdentities:unknown.length,treeFootprintBytes:bytes};
  }
  await request('initialize',{clientInfo:{name:'community_ab_audit',version:'1'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const client={captureRequestLifetime:()=>()=>{if(closed)throw Error('Disposed');},sendAppServerRequest:request};
  const normal=await request('thread/start',{cwd:root,ephemeral:true,threadSource:'user',approvalPolicy:'never',sandbox:'read-only'});
  await request('mcpServerStatus/list',{threadId:normal.thread.id});await sleep(500);
  result.positiveControl=await capture();assert.ok(result.positiveControl.serverStarts>=2,'No working MCP positive control');
  for(let i=0;i<rounds;i++){
   let p={cwd:root,ephemeral:true,threadSource:['thread_summary','thread_title','thread_description'][i%3],approvalPolicy:'never',sandbox:'read-only',config:{'features.apps':false}};
   const start=performance.now();
   if(mode==='opt2')p=await policy.prepareEphemeral(client,p);
   const t=await request('thread/start',p);await request('mcpServerStatus/list',{threadId:t.thread.id});
   await request('thread/unsubscribe',{threadId:t.thread.id});
   result.latenciesMs.push(performance.now()-start);
   await sleep(100);result.samples.push(await capture());
  }
  result.loadedBeforeNormalUnsubscribe=(await request('thread/loaded/list')).data.length;
  await request('thread/unsubscribe',{threadId:normal.thread.id});
  await sleep(5000);
  result.afterUnsubscribe5s=await capture();
  result.loadedAfterUnsubscribe5s=(await request('thread/loaded/list')).data.length;
  if(mode==='opt2')assert.equal(result.afterUnsubscribe5s.serverStarts,result.positiveControl.serverStarts,'Optimization started additional metadata MCP');
  result.beforeShutdown=await capture();
  if(shutdown==='crash')child.kill('SIGKILL');else child.stdin.end();
  await sleep(5000);result.serverExited=closed;
  result.afterShutdown5s=await capture();
  result.automaticCleanupPass=closed&&result.afterShutdown5s.liveFixtureProcesses===0&&result.afterShutdown5s.unknownLiveIdentities===0;
  result.observationComplete=true;
 }catch(e){result.error=e.message;result.errorTail=errorTail;result.observationComplete=false;}
 finally{
  // Measure first. Cleanup is a harness action, never scored as application cleanup.
  for(const [pid,id]of known){if(same(probe(helper,pid)?.root,id)){try{process.kill(pid,'SIGKILL');}catch{}}}
  if(child&&!closed)child.kill('SIGKILL');
  for(const x of pending.values())clearTimeout(x.timer);pending.clear();
  await sleep(100);await fs.rm(root,{recursive:true,force:true});
 }
 return result;
}
async function main(){
 const [original,opt2,helper,out]=process.argv.slice(2);const results=[];
 for(const [mode,shutdown,fixture,rounds]of [
  ['original','graceful','cooperative',6],['opt2','graceful','cooperative',6],
  ['opt2','graceful','cooperative',6],['original','graceful','cooperative',6],
  ['original','crash','cooperative',2],['opt2','crash','cooperative',2],
  ['original','graceful','stubborn',1],['opt2','graceful','stubborn',1],
  ['original','crash','stubborn',1],['opt2','crash','stubborn',1]]){
   const r=await scenario(mode==='original'?original:opt2,helper,mode,shutdown,fixture,rounds);
   results.push(r);await fs.writeFile(out,JSON.stringify({scope:'unauthenticated disposable native MCP fixture; no model turns',cleanupBeforeHarnessKill:true,results},null,2));
   console.log(JSON.stringify(r));
 }
 if(results.some(x=>!x.observationComplete))process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={same};
