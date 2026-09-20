'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
let api;try{api=require('../runtime/session-policy.cjs');}catch{}
test('metadata policy exists',()=>assert.ok(api));
if(api){
const p={ephemeral:true,threadSource:'thread_summary',config:{'features.apps':false,'mcp_servers.codex_app':{enabled:false,command:''}}};
test('only allowlisted tool-free metadata is eligible',()=>{
 assert.ok(api.eligible(p));
 for(const x of [{...p,ephemeral:false},{...p,threadSource:'user'},{...p,threadSource:'side_conversation'},{...p,dynamicTools:[{}]},{...p,config:{'features.apps':true}}])assert.equal(api.eligible(x),false);
});
test('server overrides quote dotted names and preserve unrelated settings without mutating input',()=>{
 const req={...p,config:{...p.config,model_reasoning_effort:'low'}};
 const result=api.disableServers({'hello.world':{command:'node'},plain:{command:'python3'}},req);
 assert.equal(result.config['mcp_servers."hello.world".enabled'],false);
 assert.equal(result.config['mcp_servers."plain".enabled'],false);
 assert.equal(result.config['mcp_servers."codex_app".enabled'],false);
 assert.equal(result.config.model_reasoning_effort,'low');assert.notEqual(result,req);
 assert.equal(Object.keys(req.config).length,3);
});
test('explicit table/flag overrides cannot re-enable metadata MCP after key sorting',()=>{
 const result=api.disableServers({x:{command:'node'}},{...p,config:{mcp_servers:{x:{enabled:true,command:'node'}},'mcp_servers.x':{enabled:true,command:'node'},'mcp_servers.x.enabled':true}});
 assert.equal(result.config.mcp_servers.x.enabled,false);
 assert.equal(result.config['mcp_servers.x'].enabled,false);
 assert.equal(result.config['mcp_servers.x.enabled'],false);
});
test('normal user sessions and safe mode never read configuration',async()=>{
 const client={sendAppServerRequest(){throw Error('must not call');}};
 const ordinary={...p,threadSource:'user'};assert.equal(await api.prepareEphemeral(client,ordinary),ordinary);
 process.env.CODEX_COMMUNITY_SAFE_MODE='1';try{assert.equal(await api.prepareEphemeral(client,p),p);}finally{delete process.env.CODEX_COMMUNITY_SAFE_MODE;}
});
test('effective config is read from the correct cwd; lifetime change aborts',async()=>{
 let valid=true;const client={captureRequestLifetime:()=>()=>{if(!valid)throw new DOMException('changed','AbortError');},
  async sendAppServerRequest(method,params){assert.equal(method,'config/read');assert.equal(params.cwd,'/tmp/project');return{config:{mcp_servers:{example:{command:'node'}}}};}};
 assert.equal((await api.prepareEphemeral(client,{...p,cwd:'/tmp/project'})).config['mcp_servers."example".enabled'],false);
 client.sendAppServerRequest=async()=>{valid=false;return{config:{mcp_servers:{}}};};
 await assert.rejects(api.prepareEphemeral(client,p),{name:'AbortError'});
});
test('failed config reads preserve requests and diagnostics contain no private configuration',async()=>{
 const client={captureRequestLifetime:()=>()=>{},sendAppServerRequest:async()=>{throw Error('secret-token');}};
 assert.equal(await api.prepareEphemeral(client,p),p);
 assert.equal(JSON.stringify(api.stats()).includes('secret-token'),false);
});
}
