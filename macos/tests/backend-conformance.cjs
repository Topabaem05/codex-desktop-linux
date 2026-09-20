'use strict';
// No model turns, account credentials, network tools or user projects are used.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {LineDecoder}=require('../runtime/telemetry.cjs');
const policy=require('../runtime/session-policy.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function verify(binary){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'codex-mcp-contract-'));
 const marker=path.join(root,'starts'),sentinel=path.join(root,'sentinel.cjs');
 let child,stopped=false;const pending=new Map();let id=0,stderr='';
 try{
  await fs.writeFile(sentinel,`const fs=require('node:fs');fs.appendFileSync(process.argv[2],'start\\n');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{try{const x=JSON.parse(line);if(x.id===undefined)return;let result=x.method==='initialize'?{protocolVersion:x.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'sentinel',version:'1'}}:x.method==='tools/list'?{tools:[{name:'sentinel',description:'local test',inputSchema:{type:'object',properties:{}}}]}:{};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:x.id,result})+'\\n');}catch{process.exitCode=1;}});`);
  const config=['[features]','plugins = false'];
  for(const name of ['sentinel','sentinel.dot'])config.push(`[mcp_servers.${JSON.stringify(name)}]`,`command = ${JSON.stringify(process.execPath)}`,`args = ${JSON.stringify([sentinel,marker])}`,'startup_timeout_sec = 10');
  await fs.writeFile(path.join(root,'config.toml'),config.join('\n'));
  child=spawn(binary,['app-server'],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root,TMPDIR:root},detached:true,stdio:['pipe','pipe','pipe']});
  const rejectAll=error=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error);}pending.clear();};
  child.stdin.on('error',rejectAll);
  child.on('error',rejectAll);child.on('exit',()=>rejectAll(Error('Test app-server exited')));
  child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-8192);});
  const decoder=new LineDecoder(msg=>{const p=pending.get(msg.id);if(!p)return;pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error(`${p.method}: ${msg.error.message}`)):p.resolve(msg.result);});
  child.stdout.on('data',b=>{try{decoder.append(b);}catch(e){rejectAll(e);}});
  function request(method,params){return new Promise((resolve,reject)=>{
   const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error(`Timeout: ${method}`));},20000);
   pending.set(key,{resolve,reject,timer,method});child.stdin.write(JSON.stringify({id:key,method,params})+'\n');
  });}
  await request('initialize',{clientInfo:{name:'community_conformance',version:'2'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const client={captureRequestLifetime:()=>()=>{assert.equal(stopped,false);},sendAppServerRequest:request};
  const count=async()=>{try{return(await fs.readFile(marker,'utf8')).trim().split('\n').filter(Boolean).length;}catch(e){if(e.code==='ENOENT')return 0;throw e;}};
  const effective=await request('config/read',{includeLayers:false,cwd:root});
  assert.ok(effective.config.mcp_servers?.['sentinel.dot'],'Effective MCP table absent');
  const normal=await request('thread/start',{cwd:root,ephemeral:true,threadSource:'user',approvalPolicy:'never',sandbox:'read-only'});
  await request('mcpServerStatus/list',{threadId:normal.thread.id});
  for(let i=0;i<40&&(await count())<2;i++)await sleep(100);
  const ordinaryStarts=await count();assert.ok(ordinaryStarts>=2,'Positive control MCP did not start');
  const control=await request('thread/start',{cwd:root,ephemeral:true,threadSource:'thread_summary',approvalPolicy:'never',sandbox:'read-only',config:{'features.apps':false}});
  await request('mcpServerStatus/list',{threadId:control.thread.id});await sleep(1000);
  const baseline=await count(),unoptimizedMetadataStarts=baseline-ordinaryStarts;
  await request('thread/unsubscribe',{threadId:control.thread.id});
  let checked=0;
  for(const source of ['thread_summary','thread_title','thread_description']){
   for(let i=0;i<2;i++){
    const p=await policy.prepareEphemeral(client,{cwd:root,ephemeral:true,threadSource:source,approvalPolicy:'never',sandbox:'read-only',config:{'features.apps':false}});
    const t=await request('thread/start',p);
    const status=await request('mcpServerStatus/list',{threadId:t.thread.id});
    assert.ok(!JSON.stringify(status).includes('local test'),'Disabled tool unexpectedly available');
    await request('thread/unsubscribe',{threadId:t.thread.id});checked++;
   }
  }
  await sleep(1000);assert.equal(await count(),baseline,'Metadata sessions spawned inherited MCP');
  await request('thread/unsubscribe',{threadId:normal.thread.id});
  console.log(JSON.stringify({passed:true,authenticated:false,modelTurns:0,positiveControlStarts:ordinaryStarts,unoptimizedMetadataStarts,metadataSessions:checked,extraMcpStarts:0,immediateUnloadClaimed:false,policy:policy.stats()},null,2));
 }catch(e){throw Error(`${e.message}\n${stderr}`);}
 finally{
  stopped=true;
  if(child&&child.exitCode===null){
   child.stdin.end();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(2000)]);
   if(child.exitCode===null){try{process.kill(-child.pid,'SIGTERM');}catch{}await sleep(300);}
   if(child.exitCode===null){try{process.kill(-child.pid,'SIGKILL');}catch{}}
  }
  for(const entry of pending.values())clearTimeout(entry.timer);pending.clear();
  await fs.rm(root,{recursive:true,force:true});
 }
}
if(require.main===module)verify(process.argv[2]).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={verify};
