'use strict';
// A request-local transport lifetime, never an idle timer or a global process kill.
const fs=require('node:fs/promises'),path=require('node:path');
const metadata=require('./session-policy.cjs');
const counts={wrapped:0,skipped:0,failures:0};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function clean(value){
 if(Array.isArray(value))return value.map(clean);
 if(object(value))return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null).map(([k,v])=>[k,clean(v)]));
 if(value===null)throw Error('Non-TOML array value');return value;
}
function merge(a,b){
 const out=Object.assign(Object.create(null),a);
 for(const [k,v] of Object.entries(clean(b)))out[k]=object(v)&&object(out[k])?merge(out[k],v):v;
 return out;
}
function wrapConfig(effective,p,binary){
 const config={...p.config};let servers=merge({},effective);
 if(config.mcp_servers!==undefined){if(!object(config.mcp_servers))throw Error('Invalid MCP table');servers=merge(servers,config.mcp_servers);}
 for(const key of Object.keys(config))if(key.startsWith('mcp_servers.')){
  const m=/^mcp_servers\.("(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)(?:\.(enabled|command|args|env|url|cwd))?$/.exec(key);
  if(!m)throw Error('Ambiguous override');const name=m[1][0]==='"'?JSON.parse(m[1]):m[1];
  const value=m[2]?{[m[2]]:config[key]}:config[key];if(!object(value))throw Error('Invalid override');
  servers[name]=merge(servers[name]??{},value);delete config[key];
 }
 if(Object.keys(servers).length>1024)throw Error('MCP inspection budget');
 let wrapped=0;
 for(const [name,s] of Object.entries(servers)){
  if(!name||name.length>256||!object(s))throw Error('Invalid MCP entry');
  if(s.enabled===false||s.url||typeof s.command!=='string'||!s.command||s.env?.CODEX_COMMUNITY_MCP_KEEPALIVE==='1'||s.command===binary)continue;
  if(s.args!==undefined&&(!Array.isArray(s.args)||!s.args.every(x=>typeof x==='string')))throw Error('Invalid argv');
  servers[name]={...s,command:binary,args:['--',s.command,...(s.args??[])]};wrapped++;
 }
 config.mcp_servers=servers;return {params:{...p,config},wrapped};
}
async function prepareThread(client,p,options={}){
 if(process.env.CODEX_COMMUNITY_SAFE_MODE==='1')return p;
 if(metadata.eligible(p))return metadata.prepareEphemeral(client,p);
 const enabled=options.enabled??globalThis.__codexCommunityMcpGuard===true;
 if(!enabled||client.isLocalAppServerConnection?.()!==true||client.options?.transport?.kind!=='stdio')return p;
 const binary=options.guardianPath??(process.resourcesPath?path.join(process.resourcesPath,'community','mcp-guardian'):null);
 const guard=client.captureRequestLifetime();
 try{
  const available=options.available??(async p=>{try{await fs.access(p,fs.constants.X_OK);return true;}catch{return false;}});
  if(!binary||!path.isAbsolute(binary)||!await available(binary)){guard();counts.skipped++;return p;}
  const response=await client.sendAppServerRequest('config/read',{includeLayers:false,cwd:p.cwd??null});guard();
  if(!object(response?.config)||!object(p.config??{})||!object(response.config.mcp_servers??{}))throw Error('Unknown config');
  const result=wrapConfig(response.config.mcp_servers??{},p,binary);
  counts.wrapped+=result.wrapped;return result.params;
 }catch(error){guard();if(error?.name==='AbortError')throw error;counts.failures++;return p;}
}
module.exports={prepareThread,wrapConfig,stats:()=>({...counts})};
