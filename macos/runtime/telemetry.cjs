'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ROLES = new Set(['codex-engine','observer','node-tool','python-tool','build-tool','other']);
const validBytes = n => Number.isSafeInteger(n) && n >= 0;
function groupProcesses(rows, metrics, rootPid) {
  const types = new Map(metrics.map(x => [x.pid, x.type]));
  const seen = new Set(), groups = {};
  for (const row of rows) {
    if (seen.has(row.pid)) throw new Error('Duplicate process in sample');
    seen.add(row.pid);
    const type = types.get(row.pid);
    const role = row.pid === rootPid ? 'ui-main' : type === 'Tab' ? 'renderer' :
      type === 'GPU' ? 'gpu' : type === 'Utility' ? 'utility' : ROLES.has(row.role) ? row.role : 'other';
    const g = groups[role] ||= {count:0, bytes:0, measuredBytes:0, missing:0};
    g.count++;
    if (validBytes(row.footprintBytes)) g.measuredBytes += row.footprintBytes;
    else g.missing++;
    g.bytes = g.missing ? null : g.measuredBytes;
  }
  return groups;
}
const needsDocumentReset = (inPlace, mainFrame) => mainFrame === true && inPlace === false;

// At most one frame, copied slices, no retention of the sender's backing buffers.
class LineDecoder {
  constructor(consume, maxBytes = 8 * 1024 * 1024) {
    if (typeof consume !== 'function' || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('Invalid decoder');
    this.consume=consume; this.maxBytes=maxBytes; this.parts=[]; this.bytes=0;
  }
  append(chunk) {
    for (let offset=0; offset<chunk.length;) {
      const end=chunk.indexOf(10,offset), next=end<0?chunk.length:end;
      const length=next-offset;
      if(this.bytes+length>this.maxBytes) {this.parts=[];this.bytes=0;throw new Error('Native frame limit exceeded');}
      if(length) {this.parts.push(Buffer.from(chunk.subarray(offset,next)));this.bytes+=length;}
      if(end>=0) {
        const line=Buffer.concat(this.parts,this.bytes).toString('utf8');this.parts=[];this.bytes=0;
        if(line.trim())this.consume(JSON.parse(line));
      }
      offset=next+1;
    }
  }
}

// Latest snapshot wins. One pending string and one active write, never a promise queue.
class SnapshotWriter {
  constructor(directory,{intervalMs=5000,onError=()=>{}}={}) {
    if(!Number.isSafeInteger(intervalMs)||intervalMs<1)throw new RangeError('Invalid write interval');
    this.directory=directory;this.intervalMs=intervalMs;this.onError=onError;
    this.pending=null;this.timer=null;this.running=null;this.closed=false;this.writes=0;
  }
  write(value) {
    if(this.closed)return false;
    let body;
    try {body=JSON.stringify(value);}catch{return false;}
    if(typeof body!=='string'||Buffer.byteLength(body)>65536)return false;
    this.pending=body;
    if(!this.timer&&!this.running) {this.timer=setTimeout(()=>{void this.flush();},this.intervalMs);this.timer.unref();}
    return true;
  }
  flush() {
    clearTimeout(this.timer);this.timer=null;
    if(this.running)return this.running;
    this.running=this.drain().finally(()=>{this.running=null;});
    return this.running;
  }
  async drain() {
    while(this.pending!==null) {
      const body=this.pending;this.pending=null;
      const temp=path.join(this.directory,`.status-${process.pid}-${randomUUID()}.tmp`);
      try {
        await fs.mkdir(this.directory,{recursive:true,mode:0o700});
        await fs.writeFile(temp,body,{mode:0o600,flag:'wx'});
        await fs.rename(temp,path.join(this.directory,'status.json'));this.writes++;
      } catch(error) {
        await fs.unlink(temp).catch(()=>{});
        try{this.onError(error);}catch{}
      }
    }
  }
  async close() {this.closed=true;await this.flush();}
}
module.exports={groupProcesses,needsDocumentReset,SnapshotWriter,LineDecoder};
