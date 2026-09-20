#!/usr/bin/env python3
"""Reproduce startup and lifecycle comparisons in a disposable macOS CI account.
No account login/model turn. No global kills. No production package modifications.
"""
import hashlib,json,os,pathlib,plistlib,shutil,signal,subprocess,sys,tempfile,time,urllib.request,urllib.error,zipfile
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[1]
EXPECTED_DMG='f5f9d06e99dae41a6689a8be0e9c335deb25cd067dfc343ddc7eaee540cc1149'
EXPECTED_ZIP='f7b22fc69148abcf1c42f11738cd8911fce164ccc417124353b1e50d3f2a2694'
def sum_footprint(snapshot):
 rows=snapshot.get('processes',[])
 if not rows or any(type(x.get('footprintBytes')) is not int or x['footprintBytes']<0 for x in rows):return None
 return sum(x['footprintBytes'] for x in rows)
def same_identity(a,b):
 return bool(a and b and all(a.get(k)==b.get(k) for k in ('pid','uid','startId')) and a.get('startId'))
def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(4194304),b''):h.update(b)
 return h.hexdigest()
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):return None
def download(url,dest,token=None):
 # Never forward a GitHub authorization header to artifact storage.
 headers={'User-Agent':'codex-community-ab-test'}
 if token:headers['Authorization']='Bearer '+token
 req=urllib.request.Request(url,headers=headers)
 try:r=urllib.request.build_opener(NoRedirect).open(req,timeout=60)
 except urllib.error.HTTPError as e:
  if e.code not in (301,302,303,307,308):raise
  location=e.headers['Location']
  if not location.startswith('https://'):raise RuntimeError('Non-TLS redirect')
  r=urllib.request.urlopen(location,timeout=60)
 with r,open(dest,'wb') as out:shutil.copyfileobj(r,out)
def copy_app(dmg,destination,mount):
 subprocess.run(['hdiutil','attach',str(dmg),'-readonly','-nobrowse','-mountpoint',str(mount)],check=True,stdout=subprocess.DEVNULL)
 try:
  apps=list(mount.glob('*.app'))
  if len(apps)!=1:raise RuntimeError('Expected one app')
  subprocess.run(['codesign','--verify','--deep','--strict',str(apps[0])],check=True)
  subprocess.run(['ditto',str(apps[0]),str(destination)],check=True)
 finally:subprocess.run(['hdiutil','detach',str(mount)],check=True,stdout=subprocess.DEVNULL)
def sample(helper,pid):
 p=subprocess.run([str(helper),str(pid)],capture_output=True,timeout=5)
 return json.loads(p.stdout) if p.returncode==0 else None
def cleanup_known(helper,identities):
 for identity in identities.values():
  row=sample(helper,identity['pid'])
  if same_identity(identity,row.get('root') if row else None):
   try:os.kill(identity['pid'],signal.SIGKILL)
   except ProcessLookupError:pass

def startup(app,mode,helper,window,index):
 info=plistlib.loads((app/'Contents/Info.plist').read_bytes());exe=app/'Contents/MacOS'/info['CFBundleExecutable']
 result={'mode':mode,'trial':index,'scope':'fresh unauthenticated profile; warm OS file caches; first ordinary window, not interactive readiness'}
 identities={};child=None;watch=None
 with tempfile.TemporaryDirectory(prefix='codex-ab-gui-') as tmp:
  p=pathlib.Path(tmp)
  env={k:os.environ[k] for k in ('PATH','TMPDIR','LANG','__CF_USER_TEXT_ENCODING') if k in os.environ}
  env.update(HOME=tmp,CODEX_HOME=str(p/'codex'),CODEX_COMMUNITY_STATE_DIR=str(p/'state'))
  try:
   started=time.monotonic()
   child=subprocess.Popen([str(exe),'--user-data-dir='+str(p/'profile')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
   watch=subprocess.Popen([str(window),str(child.pid)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   while watch.poll() is None and time.monotonic()-started<32:
    if child.poll() is not None:raise RuntimeError('App exited before window')
    time.sleep(.02)
   if watch.poll()!=0:raise RuntimeError('Window visibility measurement unavailable')
   result['firstWindowMs']=round((time.monotonic()-started)*1000,2)
   result['samples']=[]
   for seconds in (10,20):
    time.sleep(max(0,started+seconds-time.monotonic()))
    if child.poll() is not None:raise RuntimeError('App exited during idle sample')
    s=sample(helper,child.pid)
    if not s:raise RuntimeError('Native sample unavailable')
    for x in s['processes']:identities[x['pid']]=x
    result['samples'].append({'seconds':seconds,'footprintBytes':sum_footprint(s),'processCount':len(s['processes'])})
   # OS termination signal, not a claim of normal Cmd-Q coverage.
   termination_started=time.monotonic()
   child.send_signal(signal.SIGTERM)
   try:child.wait(timeout=5)
   except subprocess.TimeoutExpired:pass
   time.sleep(max(0,termination_started+5-time.monotonic()))
   alive=[];unknown=[]
   for pid,idn in identities.items():
    s=sample(helper,pid)
    if s and same_identity(idn,s['root']):alive.append(pid)
    elif s is None:
     try:os.kill(pid,0);unknown.append(pid)
     except ProcessLookupError:pass
   result['trackedSurvivors5sAfterSIGTERM']=len(alive)
   result['unknownLivePidsAfterSIGTERM']=len(unknown)
   result['observed']=True
  except Exception as e:result.update(observed=False,error=str(e))
  finally:
   if watch and watch.poll() is None:watch.kill();watch.wait(timeout=3)
   if child and child.poll() is None:child.kill();child.wait(timeout=3)
   cleanup_known(helper,identities)
 return result

def main():
 if sys.platform!='darwin':raise RuntimeError('Native macOS runner required')
 reports=ROOT/'ab-reports';reports.mkdir(exist_ok=True)
 pin=json.loads((ROOT/'macos/upstream.json').read_text())
 envinfo={'os':subprocess.check_output(['sw_vers'],text=True),'arch':subprocess.check_output(['uname','-m'],text=True).strip(),'ramBytes':int(subprocess.check_output(['sysctl','-n','hw.memsize'],text=True))}
 with tempfile.TemporaryDirectory(prefix='codex-ab-images-') as tmp:
  p=pathlib.Path(tmp);original=p/'original.dmg';artifact=p/'opt2.zip';optimized=p/'opt2.dmg'
  download(pin['url'],original)
  if sha(original)!=pin['sha256']:raise RuntimeError('Original pin drift')
  download('https://api.github.com/repos/Topabaem05/codex-desktop-linux/actions/artifacts/10603397258/zip',artifact,os.environ.get('GH_TOKEN'))
  if sha(artifact)!=EXPECTED_ZIP:raise RuntimeError('Artifact differs from verified opt2')
  with zipfile.ZipFile(artifact) as z:
   names=[n for n in z.namelist() if n.endswith('.dmg')]
   if len(names)!=1:raise RuntimeError('One verified DMG required')
   with z.open(names[0]) as a,optimized.open('wb') as b:shutil.copyfileobj(a,b)
  if sha(optimized)!=EXPECTED_DMG:raise RuntimeError('DMG differs from shipped opt2')
  original_app=p/'original/ChatGPT.app';optimized_app=p/'opt2/Codex Community.app'
  for dmg,app in [(original,original_app),(optimized,optimized_app)]:
   app.parent.mkdir();mount=p/(app.parent.name+'-mount');mount.mkdir();copy_app(dmg,app,mount)
  helper=ROOT/'linux-features/low-memory-budget/native/macos-memory';window=p/'window'
  subprocess.run(['sh',str(ROOT/'linux-features/low-memory-budget/native/build-macos.sh')],check=True)
  subprocess.run(['xcrun','clang','-std=c11','-O2','-Wall','-Wextra','-Werror',str(HERE/'window.c'),'-framework','CoreGraphics','-framework','CoreFoundation','-o',str(window)],check=True)
  output={'environment':envinfo,'originalDmgSHA256':pin['sha256'],'optimizedDmgSHA256':EXPECTED_DMG,'modelTurns':0,'startup':[]}
  for index,mode in enumerate(['original','opt2','opt2','original','original','opt2'],1):
   r=startup(original_app if mode=='original' else optimized_app,mode,helper,window,index)
   output['startup'].append(r);(reports/'startup.json').write_text(json.dumps(output,indent=2));print(json.dumps(r),flush=True)
  subprocess.run(['node',str(HERE/'lifecycle.cjs'),str(original_app/'Contents/Resources/codex'),str(optimized_app/'Contents/Resources/codex'),str(helper),str(reports/'lifecycle.json')],check=True,timeout=400)
  sys.path.insert(0,str(ROOT/'macos'))
  from asar import Archive
  paths=[]
  for app,label in [(original_app,'original'),(optimized_app,'opt2')]:
   a=Archive(app/'Contents/Resources/app.asar')
   try:data=a.read('.vite/build/main-DUHZj4_w.js',32*1024*1024)
   finally:a.close()
   target=p/(label+'.js');target.write_bytes(data);paths.append(target)
  with (reports/'queue.json').open('w') as out:subprocess.run(['node',str(HERE/'queue.cjs'),*map(str,paths)],check=True,stdout=out)
if __name__=='__main__':main()
