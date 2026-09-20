#!/usr/bin/env python3
"""Within-build startup ablations. No authenticated/model workload speed claim."""
import json,os,re,signal,statistics,subprocess,sys,tempfile,time
from pathlib import Path

MODES=('none','no-heap','no-observer','upstream-highlight')
def markers(text):
    patterns={'primaryReadyMs':r'window ready-to-show appearance=primary[^\n]*startupElapsedMs=(\d+)',
              'routesMountedMs':r'app routes mounted after (\d+)ms'}
    return {key:int(m.group(1)) for key,p in patterns.items() if (m:=re.search(p,text))}

def sample(helper,pid):
    try:
        p=subprocess.run([str(helper),str(pid)],capture_output=True,timeout=3)
        return json.loads(p.stdout) if p.returncode==0 else None
    except (subprocess.TimeoutExpired,ValueError):return None

def same(a,b):return bool(a and b and a.get('startId') and all(a.get(k)==b.get(k) for k in ('pid','uid','startId')))

def trial(app,root,mode,warmup):
    helper=app/'Contents/Resources/community/budget/native/macos-memory'
    env={k:os.environ[k] for k in ('PATH','TMPDIR','HOME','USER','LOGNAME','LANG','SHELL','__CF_USER_TEXT_ENCODING','XPC_FLAGS','XPC_SERVICE_NAME','COMMAND_MODE','SECURITYSESSIONID') if k in os.environ}
    env.update(CODEX_HOME=str(root/'codex'),CODEX_COMMUNITY_STATE_DIR=str(root/'state'),CODEX_COMMUNITY_ABLATION=mode)
    logpath=root/'launch.log';known={};p=None
    result={'mode':mode,'warmup':warmup,'observed':False,'authenticated':False,'modelTurns':0}
    try:
        with logpath.open('wb') as log:
            start=time.monotonic()
            p=subprocess.Popen([str(app/'Contents/MacOS/CodexCommunity'),'--user-data-dir='+str(root/'profile')],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            for seconds in (1,5,10,20):
                while time.monotonic()<start+seconds and p.poll() is None:time.sleep(.1)
                if p.poll() is not None:raise RuntimeError('Application exited')
                snap=sample(helper,p.pid)
                if snap:
                    for row in snap['processes']:known[row['pid']]=row
                if seconds==20:
                    rows=snap.get('processes',[]) if snap else []
                    result['footprintAt20s']=sum(r['footprintBytes'] for r in rows) if rows and all(type(r.get('footprintBytes')) is int for r in rows) else None
            log.flush()
        text=logpath.read_text(errors='replace');result.update(markers(text))
        result['runtimeDownloadObserved']='primary_runtime_bundle_install_started' in text
        status=root/'state/status.json'
        if status.exists():
            state=json.loads(status.read_text());result['actualTuning']={k:state.get(k) for k in ('ablation','observerMode','heapLimitBytes','safeMode','lastError','uiApplied','preloadReady')}
            if state.get('pid')!=p.pid:raise RuntimeError('Stale status snapshot')
            if state.get('ablation')!=mode or state.get('safeMode'):raise RuntimeError('Wrong profile')
            if mode=='no-observer' and state.get('observerMode')!='disabled':raise RuntimeError('Observer ablation not applied')
        else:raise RuntimeError('Status absent')
        result['observed']='primaryReadyMs' in result
    except Exception as e:result['error']=str(e)
    finally:
        if p:
            if p.poll() is None:
                snap=sample(helper,p.pid)
                if snap:
                    for row in snap['processes']:known[row['pid']]=row
                p.terminate()
                try:p.wait(timeout=3)
                except subprocess.TimeoutExpired:p.kill();p.wait(timeout=3)
            # Only disposable test launch identities, after observation.
            for pid,row in known.items():
                snap=sample(helper,pid)
                if same(row,snap.get('root') if snap else None):
                    try:os.kill(pid,signal.SIGKILL)
                    except ProcessLookupError:pass
    return result

def main(app,output):
    if sys.platform!='darwin':raise RuntimeError('Requires macOS runner')
    app=Path(app).resolve();output=Path(output)
    report={'scope':'within-build unauthenticated startup; per-mode reused profiles after warm-up, optional downloads may remain; no causal performance guarantee',
        'os':subprocess.check_output(['sw_vers'],text=True),'ramBytes':int(subprocess.check_output(['sysctl','-n','hw.memsize'])),
        'trials':[],'median':{}}
    with tempfile.TemporaryDirectory(prefix='opt3-ablation-',ignore_cleanup_errors=True) as temp:
        roots={m:Path(temp)/m for m in MODES}
        for root in roots.values():root.mkdir()
        # Four profile warmups, then counterbalanced measured rounds (n=2 each).
        schedule=[(m,True) for m in MODES]+[(m,False) for m in MODES]+[(m,False) for m in reversed(MODES)]
        for mode,warmup in schedule:
            r=trial(app,roots[mode],mode,warmup);report['trials'].append(r)
            output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(r),flush=True)
    for mode in MODES:
        rows=[r for r in report['trials'] if r['mode']==mode and not r['warmup'] and r['observed']]
        report['median'][mode]={'validSamples':len(rows),'runtimeDownloadTrials':sum(r.get('runtimeDownloadObserved',False) for r in rows)}
        for key in ('primaryReadyMs','routesMountedMs','footprintAt20s'):
            values=[r[key] for r in rows if r.get(key) is not None]
            report['median'][mode][key]=statistics.median(values) if len(values)==2 else None
    report['completed']=all(r['observed'] for r in report['trials']);output.write_text(json.dumps(report,indent=2)+'\n')
    if not report['completed']:raise RuntimeError('Ablation measurement incomplete; inspect observations')
if __name__=='__main__':main(*sys.argv[1:])
