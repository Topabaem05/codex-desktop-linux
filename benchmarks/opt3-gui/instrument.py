"""Add identical, diagnostic-only probes to owned temp app copies. No fuse changes."""
import hashlib,json,os,plistlib,shutil,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'macos'))
from asar import Archive,encode_header,BLOCK
from build import sign_copy,entitlements

def inject(app,scratch):
 archive_path=app/'Contents/Resources/app.asar';archive=Archive(archive_path)
 try:
  package=json.loads(archive.read('package.json'));main=package['main']
  if package.get('type')=='module' or 'auditOriginalMain' in package:raise ValueError('Unexpected entry contract')
  archive.read(main)
  package.update(auditOriginalMain=main,main='.gui-audit-entry.cjs')
  bootstrap=b"'use strict';require(require('node:path').join(process.resourcesPath,'gui-audit/probe-main.cjs'));require(require('node:path').join(__dirname,require('./package.json').auditOriginalMain));\n"
  additions={'package.json':json.dumps(package,separators=(',',':')).encode(),'.gui-audit-entry.cjs':bootstrap}
  offset=archive.data_size
  for name,data in additions.items():
   archive.header['files'][name]={'size':len(data),'offset':str(offset),'integrity':{'algorithm':'SHA256','hash':hashlib.sha256(data).hexdigest(),'blockSize':BLOCK,'blocks':[hashlib.sha256(data[i:i+BLOCK]).hexdigest() for i in range(0,len(data),BLOCK)]}}
   offset+=len(data)
  header,digest=encode_header(archive.header);target=archive_path.with_suffix('.audit')
  with target.open('xb') as out:
   out.write(header);archive.file.seek(archive.data_offset);shutil.copyfileobj(archive.file,out,BLOCK)
   for data in additions.values():out.write(data)
 finally:archive.close()
 os.replace(target,archive_path)
 info_path=app/'Contents/Info.plist';info=plistlib.loads(info_path.read_bytes())
 info['ElectronAsarIntegrity']['Resources/app.asar']={'algorithm':'SHA256','hash':digest}
 info_path.write_bytes(plistlib.dumps(info))
 dest=app/'Contents/Resources/gui-audit';dest.mkdir()
 for name in ['probe-main.cjs','probe-preload.cjs']:shutil.copy2(HERE/name,dest/name)
 sign_copy(app,entitlements(app),scratch)
 return {'instrumented':True,'headerSHA256':digest,'signing':'temporary ad-hoc test copy; not the distributed binary'}
