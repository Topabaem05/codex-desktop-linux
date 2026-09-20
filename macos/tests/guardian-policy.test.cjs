'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
let api;try{api=require('../runtime/guardian-policy.cjs');}catch{}
test('ownership-aware MCP policy is implemented',()=>assert.ok(api));
if(api){
const binary='/Applications/Codex Community.app/Contents/Resources/community/mcp-guardian';
const opts={guardianPath:binary,enabled:true,available:async()=>true};
const client=(servers)=>({isLocalAppServerConnection:()=>true,options:{transport:{kind:'stdio'}},captureRequestLifetime:()=>()=>{},sendAppServerRequest:async()=>({config:{mcp_servers:servers}})});
test('local stdio wrapper preserves command argv environment cwd and disabled entries',async()=>{
 const p={cwd:'/work',config:{'mcp_servers.a.env':{B:'two'}}};
 const servers={a:{command:'node',args:['x y',';not-shell'],env:{A:'one'},cwd:'/nested',tool_timeout_sec:null},web:{url:'https://example.test/mcp'},disabled:{command:'node',enabled:false},keep:{command:'node',env:{CODEX_COMMUNITY_MCP_KEEPALIVE:'1'}}};
 const r=await api.prepareThread(client(servers),p,opts);
 assert.equal(r.config.mcp_servers.a.command,binary);
 assert.deepEqual(r.config.mcp_servers.a.args,['--','node','x y',';not-shell']);
 assert.deepEqual({...r.config.mcp_servers.a.env},{A:'one',B:'two'});
 assert.equal(r.config.mcp_servers.a.cwd,'/nested');
 assert.equal(r.config.mcp_servers.web.url,servers.web.url);
 assert.equal(r.config.mcp_servers.disabled.command,'node');
 assert.equal(r.config.mcp_servers.keep.command,'node');
 assert.equal(Object.hasOwn(r.config.mcp_servers.a,'tool_timeout_sec'),false);
 assert.equal(servers.a.command,'node');assert.ok(p.config['mcp_servers.a.env']);
});
test('remote, websocket, safe mode, unavailable guardian and disabled profile do not wrap',async()=>{
 const p={threadSource:'user'},c=client({a:{command:'node'}});
 for(const change of [()=>c.isLocalAppServerConnection=()=>false,()=>{c.isLocalAppServerConnection=()=>true;c.options.transport.kind='websocket';}]){change();assert.equal(await api.prepareThread(c,p,opts),p);}
 c.options.transport.kind='stdio';
 assert.equal(await api.prepareThread(c,p,{...opts,available:async()=>false}),p);
 assert.equal(await api.prepareThread(c,p,{...opts,enabled:false}),p);
 process.env.CODEX_COMMUNITY_SAFE_MODE='1';try{assert.equal(await api.prepareThread(c,p,opts),p);}finally{delete process.env.CODEX_COMMUNITY_SAFE_MODE;}
});
test('metadata still disables MCP, normal sessions retain enabled=true and no double wrapping',async()=>{
 const c=client({'a.dot':{command:'node',args:[],enabled:true}});
 const p={ephemeral:true,threadSource:'thread_summary'};
 const r=await api.prepareThread(c,p,opts);assert.equal(r.config.mcp_servers['a.dot'].enabled,false);
 const r2=await api.prepareThread(c,{threadSource:'user'},opts);assert.equal(r2.config.mcp_servers['a.dot'].enabled,true);
 const c2=client(r2.config.mcp_servers);const r3=await api.prepareThread(c2,{threadSource:'user'},opts);
 assert.deepEqual(r3.config.mcp_servers['a.dot'].args,['--','node']);
});
test('lifetime invalidation aborts; ambiguous overrides fall back without config writes',async()=>{
 const c=client({a:{command:'node'}});c.captureRequestLifetime=()=>()=>{throw new DOMException('retired','AbortError');};
 await assert.rejects(api.prepareThread(c,{},opts),{name:'AbortError'});
 const p={config:{'mcp_servers.a.unsupported.nested':true}};
 assert.equal(await api.prepareThread(client({a:{command:'node'}}),p,opts),p);
 assert.equal(JSON.stringify(api.stats()).includes('node'),false);
});
}
