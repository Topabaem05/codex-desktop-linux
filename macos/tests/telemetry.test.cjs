'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let lib;
try { lib = require('../runtime/telemetry.cjs'); } catch {}
test('telemetry implementation exists', () => assert.ok(lib));
if (lib) {
  const { groupProcesses, needsDocumentReset, SnapshotWriter, LineDecoder } = lib;
  test('grouping counts shared processes once and excludes paths and argv', () => {
    const rows = [{pid:1,role:'other',footprintBytes:100},{pid:2,role:'other',footprintBytes:200},
      {pid:3,role:'codex-engine',footprintBytes:300},{pid:4,role:'node-tool',footprintBytes:null}];
    const groups = groupProcesses(rows, [{pid:2,type:'Tab'}], 1);
    assert.equal(groups['ui-main'].bytes,100);assert.equal(groups.renderer.bytes,200);
    assert.equal(groups['codex-engine'].bytes,300);assert.equal(groups['node-tool'].bytes,null);
    assert.equal(Object.values(groups).reduce((s,g)=>s+g.count,0),4);
    assert.throws(()=>groupProcesses([...rows,rows[0]],[],1),/duplicate/i);
  });
  test('same-document navigation preserves preload state', () => {
    assert.equal(needsDocumentReset(true,true),false);
    assert.equal(needsDocumentReset(false,false),false);
    assert.equal(needsDocumentReset(false,true),true);
  });
  test('bounded decoder handles split UTF8/frames and rejects runaway output', () => {
    const out=[];const d=new LineDecoder(x=>out.push(x),64);
    const b=Buffer.from('{"message":"한글"}\n{"n":2}\n');
    for(const c of b)d.append(Buffer.from([c]));
    assert.deepEqual(out,[{message:'한글'},{n:2}]);
    assert.throws(()=>d.append(Buffer.alloc(65,32)),/limit/i);
    assert.throws(()=>new LineDecoder(()=>{}).append(Buffer.from('not json\n')),/JSON|Unexpected/);
  });
  test('writer coalesces burst, atomically writes latest snapshot and protects mode', async () => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'budget-writer-'));
    try {
      const writer=new SnapshotWriter(dir,{intervalMs:1000});
      for(let n=0;n<1000;n++)writer.write({n});
      await writer.close();
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'status.json'),'utf8')),{n:999});
      assert.equal((await fs.stat(path.join(dir,'status.json'))).mode&0o777,0o600);
      assert.deepEqual(await fs.readdir(dir),['status.json']);
      assert.ok(writer.writes<=2);assert.equal(writer.write({n:1000}),false);
    } finally {await fs.rm(dir,{recursive:true,force:true});}
  });
  test('writer rejects oversized status without retaining it and tolerates I/O failure', async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'budget-writer-'));
    try {
      const file=path.join(dir,'file');await fs.writeFile(file,'x');let errors=0;
      const writer=new SnapshotWriter(file,{onError:()=>errors++});
      assert.equal(writer.write({x:'x'.repeat(70000)}),false);
      writer.write({n:1});await writer.close();assert.equal(errors,1);
    } finally {await fs.rm(dir,{recursive:true,force:true});}
  });
}
