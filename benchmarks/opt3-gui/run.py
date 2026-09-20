#!/usr/bin/env python3
"""Stock binary A/B plus a separate, equal-instrumentation heap diagnostic."""
import json,os,plistlib,signal,statistics,subprocess,sys,tempfile,time
from pathlib import Path
from common import HERE,ROOT,OPT_DMG,OPT_ZIP,app_env,prepare,build_observer,sample,raw_sample,same,cleanup,markers,cpu_delta,command

def window_call(tool,action,pid):
 try:return json.loads(command([tool,action,pid],capture_output=True,text=True,timeout=5).stdout)
 except (ValueError,subprocess.SubprocessError):return {'unavailable':True}

def trial(app,root,mode,helper,window,*,warmup=False,probe=False):
 root.mkdir(parents=True,exist_ok=True);info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
 env=app_env(root);diag=root/'probe';env['CODEX_GUI_AUDIT_DIR']=str(diag)
 result={'mode':mode,'warmup':warmup,'instrumented':probe,'observed':False,'samples':[]}
 known={};child=None;logpath=root/'latest.log';before=None;before_time=None
 try:
  with logpath.open('wb') as log:
   started=time.monotonic()
   child=subprocess.Popen([str(app/'Contents/MacOS'/info['CFBundleExecutable']),'--user-data-dir='+str(root/'profile')],
    env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   schedule=[1,5,15,30,60]+([] if warmup else ([70,95] if probe else [70,75]))
   for seconds in schedule:
    if seconds==70:result['hideRequest']=window_call(window,'hide',child.pid)
    if seconds==75:result['showRequest']=window_call(window,'show',child.pid)
    while time.monotonic()<started+seconds:
     if child.poll() is not None:raise RuntimeError('App exited during observation')
     time.sleep(.1)
    snap=sample(helper,child.pid)
    if snap is None:raise RuntimeError('Native process sample unavailable')
    for row in snap['processes']:known[row['pid']]=row
    now=time.monotonic();snap['elapsedSeconds']=now-started;snap['targetSeconds']=seconds
    snap['windows']=window_call(window,'windows',child.pid)
    if before is not None:
     snap['survivingProcessCpuPercentOneCore']=100*cpu_delta(before,snap['processes'])/1e9/(now-before_time)
    before=snap['processes'];before_time=now
    result['samples'].append(snap)
   log.flush()
  text=logpath.read_text(errors='replace');result.update(markers(text))
  status=root/'state/status.json'
  if mode=='opt3' and status.exists():
   st=json.loads(status.read_text());result['opt3Status']={k:st.get(k) for k in ('pid','ready','ablation','safeMode','observerMode','groups','lastError','uiApplied','preloadReady')}
   if st.get('pid')!=child.pid or st.get('safeMode') or st.get('ablation')!='none':raise RuntimeError('Opt3 profile mismatch')
  if probe:
   result['internalProbes']=[json.loads(f.read_text()) for f in sorted(diag.glob('*.json'))]
  result['observed']='routesMountedReportedMs' in result and all(s['bytes'] is not None for s in result['samples'])
  result['quitRequest']=window_call(window,'quit',child.pid);quit_at=time.monotonic()
  while child.poll() is None and time.monotonic()-quit_at<5:time.sleep(.1)
  time.sleep(max(0,5-(time.monotonic()-quit_at)))
  remaining=[];unknown=[]
  for pid,row in known.items():
   alive=raw_sample(helper,pid)
   if alive and same(row,alive['root']):remaining.append({'pid':pid,'role':row['role']})
   elif alive is None:
    try:os.kill(pid,0);unknown.append(pid)
    except ProcessLookupError:pass
  result['afterQuit5s']={'rootExited':child.poll() is not None,'knownSurvivors':remaining,'unknownLivePids':unknown}
 except Exception as e:result['error']=str(e)
 finally:
  if child and child.poll() is None:
   snap=sample(helper,child.pid)
   if snap:
    for row in snap['processes']:known[row['pid']]=row
  cleanup(helper,known)
  if child and child.poll() is None:child.kill()
  if child:
   try:child.wait(timeout=5)
   except subprocess.TimeoutExpired:pass
  time.sleep(.5)
 return result

def cli_baseline(binary,root,helper):
 root.mkdir();env=app_env(root);known={};out={'scope':'initialized app-server only; no thread/model/tool; not equivalent agent workload','samples':[]};p=None
 try:
  with (root/'stdout').open('wb') as stdout,(root/'stderr').open('wb') as stderr:
   p=subprocess.Popen([str(binary),'app-server'],env=env,cwd=root,stdin=subprocess.PIPE,stdout=stdout,stderr=stderr,start_new_session=True)
   p.stdin.write(b'{"id":1,"method":"initialize","params":{"clientInfo":{"name":"gui_memory_baseline","version":"1"}}}\n');p.stdin.flush()
   time.sleep(1)
   text=(root/'stdout').read_text(errors='replace')
   replies=[json.loads(l) for l in text.splitlines() if l.startswith('{')]
   if not any(x.get('id')==1 and 'result' in x for x in replies):raise RuntimeError('CLI initialization not confirmed')
   p.stdin.write(b'{"method":"initialized"}\n');p.stdin.flush()
   for delay in (4,15):
    time.sleep(delay);snap=sample(helper,p.pid)
    if not snap:raise RuntimeError('CLI sample unavailable')
    for row in snap['processes']:
     known[row['pid']]=row
     if row['pid']==p.pid:row['role']='codex-engine'
    from common import summarize
    snap.update(summarize(snap['processes']));out['samples'].append(snap)
   out['observed']=True;p.stdin.close();p.wait(timeout=5)
 except Exception as e:out.update(observed=False,error=str(e))
 finally:
  cleanup(helper,known)
  if p and p.poll() is None:p.kill();p.wait(timeout=5)
 return out

def main(kind):
 if sys.platform!='darwin':raise RuntimeError('macOS required')
 if kind not in ('stock','probe'):raise ValueError('Unknown audit mode')
 reports=ROOT/'gui-audit-reports';reports.mkdir(exist_ok=True)
 result={'kind':kind,'authenticated':False,'modelTurns':0,'version':'26.915.31945','opt3DmgSHA256':OPT_DMG,
  'opt3ArtifactZipSHA256':OPT_ZIP,'trials':[],'environment':{
   'os':subprocess.check_output(['sw_vers'],text=True),'arch':subprocess.check_output(['uname','-m'],text=True).strip(),
   'ramBytes':int(subprocess.check_output(['sysctl','-n','hw.memsize'],text=True))}}
 output=reports/(kind+'.json')
 def save():output.write_text(json.dumps(result,indent=2)+'\n')
 with tempfile.TemporaryDirectory(prefix='codex-gui-audit-',ignore_cleanup_errors=True) as temp:
  root=Path(temp);apps,pin=prepare(root);result['originalDmgSHA256']=pin['sha256'];helper,window=build_observer(root)
  result['backendVersions']={mode:command([app/'Contents/Resources/codex','--version'],capture_output=True,text=True).stdout.strip() for mode,app in apps.items()}
  if kind=='stock':
   result['cliBaseline']=cli_baseline(apps['original']/'Contents/Resources/codex',root/'cli',helper);save()
   schedule=[('original',True),('opt3',True)]+[(mode,False) for mode in ('original','opt3','opt3','original','original','opt3')]
  else:
   from instrument import inject
   result['probeCopies']={}
   for mode,app in apps.items():
    scratch=root/(mode+'-signing');scratch.mkdir();result['probeCopies'][mode]=inject(app,scratch)
   schedule=[('original',False),('opt3',False)]
  for mode,warm in schedule:
   r=trial(apps[mode],root/(mode+'-profile'),mode,helper,window,warmup=warm,probe=kind=='probe')
   result['trials'].append(r);save()
   print(json.dumps({'mode':mode,'warmup':warm,'observed':r['observed'],'routesMs':r.get('routesMountedReportedMs'),
    'endFootprintMiB':r['samples'][-1]['bytes']/1048576 if r['samples'] and r['samples'][-1]['bytes'] is not None else None,'error':r.get('error')}),flush=True)
  result['completed']=all(r['observed'] for r in result['trials'])
  if kind=='probe':result['completed'] &= all(len(r.get('internalProbes',[]))==5 and all(any(c.get('probe',{}).get('heapKiB') for c in v.get('contents',[])) for v in r.get('internalProbes',[])) for r in result['trials'])
  save()
 if not result['completed']:raise RuntimeError('Incomplete measurements; do not treat absent values as success')
if __name__=='__main__':main(sys.argv[1])
