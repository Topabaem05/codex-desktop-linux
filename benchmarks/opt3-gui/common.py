"""Diagnostic-only helpers. Never retain argv, prompts or credentials in reports."""
import hashlib,json,os,re,shutil,signal,subprocess,sys,urllib.request,urllib.error,zipfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
ELECTRON={'ui-main','renderer','gpu','network','utility','electron-other'}
OPT_DMG='8314e2a94c886c019bd543ab5649c165ce641ebbc05b1199c3946ce58099df7c'
OPT_ZIP='7b6ac785ac2a41c1f3162ae2869833ef6d71861e1c5934e87c8fda749903ab6a'
def same(a,b):
 return bool(a and b and a.get('startId') and all(a.get(k)==b.get(k) for k in ('pid','uid','startId')))
def classify(pid,root,command,native):
 if pid==root:return 'ui-main'
 kind=re.search(r'(?:^|\s)--type=([\w-]+)(?:\s|$)',command)
 if kind:
  value=kind.group(1)
  if value in ('renderer','gpu-process'):return 'renderer' if value=='renderer' else 'gpu'
  if value=='utility':return 'network' if '--utility-sub-type=network.mojom.NetworkService' in command else 'utility'
  return 'electron-other'
 return native if native in {'codex-engine','observer','node-tool','python-tool','build-tool'} else 'other'
def summarize(rows):
 seen=set();groups={}
 for row in rows:
  if row['pid'] in seen:raise ValueError('Duplicate PID')
  seen.add(row['pid']);g=groups.setdefault(row.get('role','other'),{'count':0,'bytes':0,'missing':0,'measuredBytes':0})
  g['count']+=1;b=row.get('footprintBytes')
  if type(b) is int and b>=0:g['measuredBytes']+=b
  else:g['missing']+=1
  g['bytes']=None if g['missing'] else g['measuredBytes']
 total=lambda gs:None if any(g['bytes'] is None for g in gs) else sum(g['bytes'] for g in gs)
 return {'bytes':total(list(groups.values())) if rows else None,'electronBytes':total([g for r,g in groups.items() if r in ELECTRON]),'groups':groups,'processCount':len(rows)}
def cpu_delta(before,after):
 old={r['pid']:r for r in before};total=0
 for row in after:
  a=old.get(row['pid'])
  if same(a,row) and all(type(x.get(k)) is int for x in (a,row) for k in ('cpuUserNs','cpuSystemNs')):
   total+=max(0,row['cpuUserNs']+row['cpuSystemNs']-a['cpuUserNs']-a['cpuSystemNs'])
 return total

def markers(text):
 pats={'primaryReadyReportedMs':r'window ready-to-show appearance=primary[^\n]*startupElapsedMs=(\d+)',
       'routesMountedReportedMs':r'app routes mounted after (\d+)ms'}
 out={k:int(m.group(1)) for k,p in pats.items() if (m:=re.search(p,text))}
 out['installRequests']=text.count('primary_runtime_bundle_install_started')
 out['installOutcomes']=re.findall(r'primary_runtime_bundle_install_outcome[^\n]*\boutcome=([^\s]+)',text)
 out['installTriggers']=re.findall(r'primary_runtime_bundle_install_started[^\n]*\btrigger=([^\s]+)',text)
 out['networkBytes']=None # an install request does not prove a byte download
 return out

def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(4194304),b''):h.update(b)
 return h.hexdigest()
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):return None

def download(url,dest,token=None):
 headers={'User-Agent':'codex-gui-audit'}
 if token:headers['Authorization']='Bearer '+token
 try:r=urllib.request.build_opener(NoRedirect).open(urllib.request.Request(url,headers=headers),timeout=90)
 except urllib.error.HTTPError as e:
  if e.code not in (301,302,303,307,308):raise
  location=e.headers['Location']
  if not location.startswith('https://'):raise RuntimeError('Non-TLS redirect')
  r=urllib.request.urlopen(location,timeout=90) # deliberately omit GitHub token
 with r,open(dest,'wb') as out:shutil.copyfileobj(r,out)

def command(argv,**kw):return subprocess.run(list(map(str,argv)),check=True,**kw)

def prepare(root):
 import plistlib
 sys.path.insert(0,str(ROOT/'macos'))
 from asar import Archive
 pin=json.loads((ROOT/'macos/upstream.json').read_text())
 original=root/'original.dmg';optzip=root/'opt3.zip';opt=root/'opt3.dmg'
 download(pin['url'],original)
 if sha(original)!=pin['sha256']:raise RuntimeError('Original DMG drift')
 download('https://api.github.com/repos/Topabaem05/codex-desktop-linux/actions/artifacts/10604633755/zip',optzip,os.environ.get('GH_TOKEN'))
 if sha(optzip)!=OPT_ZIP:raise RuntimeError('Shipped artifact drift')
 with zipfile.ZipFile(optzip) as z:
  names=[n for n in z.namelist() if n.endswith('.dmg')]
  if len(names)!=1:raise RuntimeError('Expected one DMG')
  with z.open(names[0]) as a,opt.open('wb') as b:shutil.copyfileobj(a,b)
 if sha(opt)!=OPT_DMG:raise RuntimeError('Shipped opt3 drift')
 apps={}
 for mode,dmg in [('original',original),('opt3',opt)]:
  mount=root/(mode+'-mount');mount.mkdir();appdir=root/mode;appdir.mkdir()
  command(['hdiutil','attach',dmg,'-readonly','-nobrowse','-mountpoint',mount],stdout=subprocess.DEVNULL)
  try:
   found=list(mount.glob('*.app'))
   if len(found)!=1:raise RuntimeError('Expected one app')
   src=found[0];command(['codesign','--verify','--deep','--strict',src])
   info=plistlib.loads((src/'Contents/Info.plist').read_bytes())
   if info['CFBundleShortVersionString']!=pin['version']:raise RuntimeError('Version mismatch')
   if mode=='original':
    details=command(['codesign','-dvvv',src],capture_output=True,text=True).stderr
    if 'TeamIdentifier='+pin['teamID'] not in details:raise RuntimeError('Wrong source signer')
   a=Archive(src/'Contents/Resources/app.asar')
   try:
    if a.header_hash!=info['ElectronAsarIntegrity']['Resources/app.asar']['hash']:raise RuntimeError('ASAR integrity mismatch')
   finally:a.close()
   apps[mode]=appdir/src.name;command(['ditto',src,apps[mode]])
  finally:command(['hdiutil','detach',mount],stdout=subprocess.DEVNULL)
 return apps,pin

def build_observer(root):
 # Use the reviewed read-only identity-safe sampler and add CPU counters only.
 text=(ROOT/'linux-features/low-memory-budget/native/macos-memory.c').read_text()
 old='if (ok) printf(",\\\"rssBytes\\\":%" PRIu64 ",\\\"footprintBytes\\\":%" PRIu64 "}", usage.ri_resident_size, usage.ri_phys_footprint);'
 new='if (ok) printf(",\\\"rssBytes\\\":%" PRIu64 ",\\\"footprintBytes\\\":%" PRIu64 ",\\\"cpuUserNs\\\":%" PRIu64 ",\\\"cpuSystemNs\\\":%" PRIu64 "}", usage.ri_resident_size, usage.ri_phys_footprint, usage.ri_user_time, usage.ri_system_time);'
 if text.count(old)!=1:raise RuntimeError('Sampler source contract changed')
 source=root/'audit-observer.c';source.write_text(text.replace(old,new));helper=root/'audit-observer'
 command(['xcrun','clang','-std=c11','-O2','-Wall','-Wextra','-Werror','-fblocks',source,'-o',helper])
 window=root/'audit-window'
 command(['xcrun','clang','-fobjc-arc','-O2','-Wall','-Wextra','-Werror',HERE/'window.m','-framework','AppKit','-framework','CoreGraphics','-o',window])
 return helper,window

def raw_sample(helper,pid):
 try:
  p=subprocess.run([str(helper),str(pid)],capture_output=True,timeout=5)
  return json.loads(p.stdout) if p.returncode==0 else None
 except (subprocess.TimeoutExpired,ValueError):return None

def sample(helper,pid):
 snap=raw_sample(helper,pid)
 if snap is None:return None
 # Read argv transiently solely to classify Chromium process types; never save it.
 ps=subprocess.run(['ps','-axo','pid=,args='],capture_output=True,text=True,timeout=5)
 args={}
 if ps.returncode==0:
  for line in ps.stdout.splitlines():
   item=line.strip().split(None,1)
   if len(item)==2 and item[0].isdigit():args[int(item[0])]=item[1]
 for row in snap['processes']:row['role']=classify(row['pid'],pid,args.get(row['pid'],''),row.get('role','other'))
 snap.update(summarize(snap['processes']));return snap

def cleanup(helper,known):
 # Only previously observed UID/PID/start identities, never names or guessed groups.
 for row in reversed(list(known.values())):
  snap=raw_sample(helper,row['pid'])
  if snap and same(row,snap['root']):
   try:os.kill(row['pid'],signal.SIGKILL)
   except ProcessLookupError:pass

def app_env(root):
 allowed=('PATH','TMPDIR','HOME','USER','LOGNAME','LANG','SHELL','__CF_USER_TEXT_ENCODING','XPC_FLAGS','XPC_SERVICE_NAME','COMMAND_MODE','SECURITYSESSIONID')
 env={k:os.environ[k] for k in allowed if k in os.environ}
 env.update(CODEX_HOME=str(root/'codex'),CODEX_COMMUNITY_STATE_DIR=str(root/'state'))
 return env
