'use strict';
// Actual bundled Rust server; local fixtures only. Measure BEFORE test cleanup.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {LineDecoder}=require('../runtime/telemetry.cjs');
const policy=require('../runtime/guardian-policy.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function probe(helper,pid){try{return JSON.parse(execFileSync(helper,[String(pid)],{timeout:2000,stdio:['ignore','pipe','ignore']})).root;}catch{return null;}}
function same(a,b){return a&&b&&a.uid===b.uid&&a.pid===b.pid&&a.startId===b.startId;}
function live(pid){try{return !execFileSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim().startsWith('Z');}catch{return false;}}
async function scenario(binary,guardian,helper,enabled,shutdown){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'guardian-native-'));
 const marker=path.join(root,'pids'),script=path.join(root,'fixture.cjs');
 let child,closed=false,id=0;const pending=new Map(),identities=new Map();let errorTail='';
 try{
  await fs.writeFile(script,`const fs=require('node:fs'),{spawn}=require('node:child_process');process.on('SIGTERM',()=>{});setInterval(()=>{},1000);fs.appendFileSync(process.argv[2],process.pid+'\\n');if(process.argv[3]!=='worker'){spawn(process.execPath,[__filename,process.argv[2],'worker'],{stdio:'ignore'});require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const x=JSON.parse(line);if(x.id===undefined)return;const result=x.method==='initialize'?{protocolVersion:x.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'guardian-test',version:'1'}}:x.method==='tools/list'?{tools:[{name:'check',description:'fixture',inputSchema:{type:'object',properties:{}}}]}:{};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:x.id,result})+'\\n');});}`);
  await fs.writeFile(path.join(root,'config.toml'),`[features]\nplugins=false\n[mcp_servers.sentinel]\ncommand=${JSON.stringify(process.execPath)}\nargs=${JSON.stringify([script,marker])}\nstartup_timeout_sec=10\n`);
  child=spawn(binary,['app-server'],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root,TMPDIR:root},stdio:['pipe','pipe','pipe']});
  const fail=e=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(e);}pending.clear();};
  child.on('error',fail);child.on('exit',()=>{closed=true;fail(Error('backend exited'));});child.stdin.on('error',fail);
  child.stderr.on('data',b=>{errorTail=(errorTail+b).slice(-4000);});
  const decoder=new LineDecoder(m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);});
  child.stdout.on('data',b=>{try{decoder.append(b);}catch(e){fail(e);}});
  function request(method,params){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('RPC timeout '+method));},20000);pending.set(key,{resolve,reject,timer});child.stdin.write(JSON.stringify({id:key,method,params})+'\n');});}
  await request('initialize',{clientInfo:{name:'guardian_conformance',version:'3'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
  const client={isLocalAppServerConnection:()=>true,options:{transport:{kind:'stdio'}},captureRequestLifetime:()=>()=>{if(closed)throw Error('retired');},sendAppServerRequest:request};
  let params={cwd:root,ephemeral:true,threadSource:'user',approvalPolicy:'never',sandbox:'read-only'};
  if(enabled)params=await policy.prepareThread(client,params,{enabled:true,guardianPath:guardian});
  if(enabled)assert.equal(params.config?.mcp_servers?.sentinel?.command,guardian,'guard override absent');
  const thread=await request('thread/start',params);
  const tools=await request('mcpServerStatus/list',{threadId:thread.thread.id});
  assert.ok(JSON.stringify(tools).includes('fixture'),'MCP handshake or tool listing failed');
  await sleep(800);
  const pids=(await fs.readFile(marker,'utf8')).trim().split('\n').map(Number);assert.ok(pids.length>=2&&pids.length<20,'fixture bounds');
  for(const pid of pids){const row=probe(helper,pid);if(row)identities.set(pid,row);}
  assert.ok(identities.size>=2,'no live positive control');
  await request('thread/unsubscribe',{threadId:thread.thread.id});await sleep(300);
  // Mere unsubscribe must not abort still-loaded sessions or legitimate MCP calls.
  const liveBeforeShutdown=[...identities.keys()].filter(live).length;assert.ok(liveBeforeShutdown>=2);
  if(shutdown==='crash')child.kill('SIGKILL');else child.stdin.end();
  await sleep(5000);
  const observed=[...identities].map(([pid,row])=>({pid,row,current:probe(helper,pid),alive:live(pid)}));
  const unknown=observed.filter(x=>x.alive&&!x.current);
  assert.equal(unknown.length,0,'Live fixture identity could not be measured');
  const survivors=observed.filter(x=>same(x.row,x.current)&&x.alive);
  assert.ok(closed,'Backend root has not exited');
  if(enabled)assert.equal(survivors.length,0,'guarded stubborn descendants survived');
  else assert.ok(survivors.length>0,'unguarded negative control unexpectedly cleaned every stubborn child');
  return{guarded:enabled,shutdown,modelTurns:0,liveBeforeShutdown,liveAfter5s:survivors.length,measuredBeforeHarnessCleanup:true,passed:true};
 }catch(e){throw Error(e.message+'\n'+errorTail);}
 finally{
  for(const [pid,row]of identities)if(same(row,probe(helper,pid))&&live(pid)){try{process.kill(pid,'SIGKILL');}catch{}}
  if(child&&!closed){child.kill('SIGKILL');await sleep(100);}
  for(const p of pending.values())clearTimeout(p.timer);pending.clear();
  await fs.rm(root,{recursive:true,force:true});
 }
}
(async()=>{
 const [binary,guardian,helper]=process.argv.slice(2),results=[];
 for(const enabled of [false,true])for(const stop of ['eof','crash'])results.push(await scenario(binary,guardian,helper,enabled,stop));
 console.log(JSON.stringify({results,scope:'local configured stdio MCP process groups; no detached escape guarantee; no authenticated/model turns'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
