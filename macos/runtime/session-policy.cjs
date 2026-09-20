'use strict';
// Scope only app-owned, tool-free metadata requests. Never change user sessions.
const SOURCES=new Set(['thread_summary','thread_title','thread_description']);
const counts={prepared:0,serversDisabled:0,configFailures:0};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function eligible(p){
 return p?.ephemeral===true&&SOURCES.has(p.threadSource)&&!p.dynamicTools?.length&&
  p.config?.['features.apps']!==true&&p.config?.features?.apps!==true;
}
function serverName(key){
 const match=/^mcp_servers\.("(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)(?:\.(enabled|command|args|env|url))?$/.exec(key);
 if(!match)throw Error('Unsupported MCP override key');
 return {name:match[1][0]==='"'?JSON.parse(match[1]):match[1],field:match[2]};
}
// ConfigRead serializes absent options as null, but TOML cannot represent null.
function tomlValue(value){
 if(Array.isArray(value))return value.map(tomlValue);
 if(object(value))return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null).map(([k,v])=>[k,tomlValue(v)]));
 if(value===null)throw Error('Null array element is not a TOML value');
 return value;
}
function disableServers(effective,p){
 if(!object(effective)||!object(p.config??{}))throw Error('Invalid effective config');
 const config={...p.config},servers=Object.create(null);
 function merge(name,value){
  if(!name||name.length>256||/[\x00-\x1f\x7f]/u.test(name)||!object(value))throw Error('Invalid MCP table');
  servers[name]={...servers[name],...tomlValue(value),enabled:false};
 }
 for(const [name,value] of Object.entries(effective))merge(name,value);
 if(config.mcp_servers!==undefined){
  if(!object(config.mcp_servers))throw Error('Invalid request MCP table');
  for(const [name,value] of Object.entries(config.mcp_servers))merge(name,value);
 }
 for(const key of Object.keys(config))if(key.startsWith('mcp_servers.')){
  const {name,field}=serverName(key);
  merge(name,field?{[field]:config[key]}:config[key]);delete config[key];
 }
 if(Object.keys(servers).length>1024)throw Error('MCP configuration exceeds inspection budget');
 // The bundled JSON override parser splits dot keys literally. It does not parse
 // TOML quoted key syntax: use a nested value and retain each server's transport.
 config.mcp_servers=servers;
 return {...p,config};
}
async function prepareEphemeral(client,p){
 if(process.env.CODEX_COMMUNITY_SAFE_MODE==='1'||!eligible(p))return p;
 const guard=client.captureRequestLifetime();
 try{
  const response=await client.sendAppServerRequest('config/read',{includeLayers:false,cwd:p.cwd??null});
  guard();
  // Missing effective table means no configured servers, not an unknown sample.
  if(!object(response?.config))throw Error('Config read shape changed');
  const result=disableServers(response.config.mcp_servers??{},p);
  counts.prepared++;counts.serversDisabled+=Object.keys(result.config.mcp_servers).length;
  return result;
 }catch(error){
  guard(); // Auth/client disposal must not become a fallback request in a new lifetime.
  if(error?.name==='AbortError')throw error;
  counts.configFailures++;return p;
 }
}
module.exports={eligible,disableServers,prepareEphemeral,stats:()=>({...counts})};
