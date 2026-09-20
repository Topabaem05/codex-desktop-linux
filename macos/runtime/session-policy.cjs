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
function disableServers(effective,p){
 if(!object(effective)||!object(p.config??{}))throw Error('Invalid effective config');
 const config={...p.config},names=new Set(Object.keys(effective));
 if(config.mcp_servers!==undefined){
  if(!object(config.mcp_servers))throw Error('Invalid request MCP table');
  config.mcp_servers=Object.fromEntries(Object.entries(config.mcp_servers).map(([name,value])=>{if(!object(value))throw Error('Invalid MCP table');names.add(name);return[name,{...value,enabled:false}];}));
 }
 for(const key of Object.keys(config))if(key.startsWith('mcp_servers.')){
  const {name,field}=serverName(key);names.add(name);
  if(field==='enabled')config[key]=false;
  else if(!field){if(!object(config[key]))throw Error('Invalid MCP override');config[key]={...config[key],enabled:false};}
 }
 if(names.size>1024)throw Error('MCP configuration exceeds inspection budget');
 for(const name of names){
  if(!name||name.length>256||/[\x00-\x1f\x7f]/u.test(name))throw Error('Invalid server name');
  config[`mcp_servers.${JSON.stringify(name)}.enabled`]=false;
 }
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
  counts.prepared++;counts.serversDisabled+=Object.keys(result.config).filter(k=>k.startsWith('mcp_servers.')&&k.endsWith('.enabled')).length;
  return result;
 }catch(error){
  guard(); // Auth/client disposal must not become a fallback request in a new lifetime.
  if(error?.name==='AbortError')throw error;
  counts.configFailures++;return p;
 }
}
module.exports={eligible,disableServers,prepareEphemeral,stats:()=>({...counts})};
