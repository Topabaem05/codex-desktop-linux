#!/usr/bin/env python3
"""Build a separate, development-signed macOS app and verified DMG.

Only the pinned official input is accepted. This never patches an installed app,
never disables an integrity fuse, and never changes machine security settings.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MACHO = {bytes.fromhex(x) for x in ('feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca')}
BUNDLES = {'.app','.framework','.xpc','.bundle','.docktileplugin'}

def run(argv, **kwargs):
    print('+', ' '.join(map(str, argv)), flush=True)
    return subprocess.run(list(map(str, argv)), check=True, **kwargs)

def validate_pin(pin):
    if pin.get('url') != 'https://persistent.oaistatic.com/codex-app-prod/Codex.dmg':
        raise ValueError('Unexpected upstream URL')
    if not re.fullmatch(r'[0-9a-f]{64}',pin.get('sha256','')) or pin.get('teamID') != '2DC432GLL2':
        raise ValueError('Missing upstream SHA-256 or signing identity')
    if pin.get('architecture') != 'arm64' or not re.fullmatch(r'[0-9]+(?:\.[0-9]+)+',pin.get('version','')):
        raise ValueError('Unsupported upstream architecture/version')
    return pin

def executable_name(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}',value):
        raise ValueError('Unsafe upstream executable name')
    return value

def community_plist(original, digest):
    result=copy.deepcopy(original)
    result.update(CFBundleExecutable='CodexCommunity',CFBundleName='Codex Community',CFBundleDisplayName='Codex Community')
    result.pop('LSHasLocalizedDisplayName',None)
    # Native helpers and app-server expect the original bundle identity.
    # It is NOT an OpenAI signature: the entire copy is re-signed below.
    result['ElectronAsarIntegrity']['Resources/app.asar']={'algorithm':'SHA256','hash':digest}
    result['CodexCommunityBuild']=True
    result['CodexCommunityProfile']='all-compatible'
    return result

def sign_targets(app):
    targets=[]
    for parent, dirs, files in os.walk(app,followlinks=False):
        dirs[:]=[d for d in dirs if not (Path(parent)/d).is_symlink()]
        for d in dirs:
            p=Path(parent)/d
            if p.suffix in BUNDLES:targets.append(p)
        for name in files:
            p=Path(parent)/name
            if p.is_symlink():continue
            with p.open('rb') as f:magic=f.read(4)
            if magic in MACHO:targets.append(p)
    # Sign individual code first, then enclosing containers, root last.
    return sorted(set(targets),key=lambda p:(-len(p.parts),str(p)))+[app]

def sha256(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(4*1024*1024),b''):h.update(block)
    return h.hexdigest()

def development_entitlements(original):
    # Drop team-owned access rather than copying another developer's authority.
    restricted={'com.apple.application-identifier','application-identifier','com.apple.developer.team-identifier','keychain-access-groups','com.apple.security.application-groups'}
    cleaned={k:v for k,v in original.items() if k not in restricted}
    if any(k.startswith('com.apple.developer.') for k in cleaned):
        raise ValueError('Unknown restricted entitlement requires an explicit port review')
    return cleaned, sorted(restricted.intersection(original))

def entitlements(path):
    p=subprocess.run(['codesign','-d','--entitlements',':-',str(path)],capture_output=True)
    raw=p.stdout
    start=raw.find(b'<?xml')
    if start>=0:
        result=plistlib.loads(raw[start:])
        cleaned, removed=development_entitlements(result)
        if removed:print('Development signing drops team-bound access:',str(path),','.join(removed),flush=True)
        return cleaned
    return {}

def sign_copy(app, root_ent, scratch):
    targets=sign_targets(app)
    # Read all metadata BEFORE signing any nested code.
    metadata={p:entitlements(p) for p in targets if p!=app}
    metadata[app]=root_ent
    for i,p in enumerate(targets):
        args=['codesign','--force','--sign','-','--timestamp=none','--options','runtime']
        e=metadata[p]
        if p.name=='CodexCommunity':e=root_ent
        if e:
            ef=scratch/f'entitlements-{i}.plist';ef.write_bytes(plistlib.dumps(e))
            args+=['--entitlements',ef]
        run(args+[p])
    run(['codesign','--verify','--deep','--strict','--verbose=2',app])

def build(options):
    if sys.platform!='darwin':raise RuntimeError('DMG build requires macOS; portable tests can run on Linux')
    pin=validate_pin(json.loads((HERE/'upstream.json').read_text()))
    profile=json.loads((HERE/'profile.json').read_text())
    if profile['name']!='all-compatible' or not all(v is True for v in profile['features'].values()):
        raise ValueError('Release profile must enable every implemented compatible feature')
    out=Path(options.output).resolve()
    out.mkdir(parents=True,exist_ok=True)
    dmg_name=f"Codex-Community-{pin['version']}-arm64-dev.dmg"
    final=out/dmg_name
    if final.exists():raise FileExistsError(f'Refusing to overwrite existing artifact: {final}')
    # All destructive work stays inside this owned TemporaryDirectory.
    with tempfile.TemporaryDirectory(prefix='codex-community-build-') as tmp:
        temp=Path(tmp); mount=temp/'mount';mount.mkdir();stage=temp/'image';stage.mkdir()
        dmg=Path(options.upstream_dmg).resolve() if options.upstream_dmg else temp/'upstream.dmg'
        if not options.upstream_dmg:
            run(['curl','--fail','--location','--proto','=https','--proto-redir','=https','--tlsv1.2','--retry','2',pin['url'],'-o',dmg])
        if sha256(dmg)!=pin['sha256']:raise ValueError('Upstream DMG differs from audited pin; re-audit before updating upstream.json')
        run(['hdiutil','attach',dmg,'-readonly','-nobrowse','-mountpoint',mount])
        try:
            apps=[p for p in mount.glob('*.app') if p.is_dir() and not p.is_symlink()]
            if len(apps)!=1:raise ValueError('Expected exactly one upstream app')
            source=apps[0]
            run(['codesign','--verify','--deep','--strict',source])
            details=run(['codesign','-dvvv',source],capture_output=True,text=True).stderr
            if f"TeamIdentifier={pin['teamID']}" not in details:raise ValueError('Unexpected upstream signer')
            old=plistlib.loads((source/'Contents/Info.plist').read_bytes())
            if old['CFBundleShortVersionString']!=pin['version']:raise ValueError('Unexpected source version')
            original_exe=executable_name(old['CFBundleExecutable'])
            arch=run(['lipo','-archs',source/'Contents/MacOS'/original_exe],capture_output=True,text=True).stdout.strip()
            if arch!=pin['architecture']:raise ValueError('Unexpected source executable architecture')
            root_ent=entitlements(source)
            app=stage/'Codex Community.app'
            run(['ditto',source,app])
        finally:run(['hdiutil','detach',mount])
        # Import after platform validation; asar.py is also independently testable.
        sys.path.insert(0,str(HERE))
        from asar import Archive, patch
        archive_path=app/'Contents/Resources/app.asar'
        archive=Archive(archive_path)
        original_hash=archive.header_hash;archive.close()
        if old.get('ElectronAsarIntegrity',{}).get('Resources/app.asar',{}).get('hash')!=original_hash:
            raise ValueError('Source ASAR header integrity mismatch')
        new_archive=archive_path.with_suffix('.asar.community')
        digest=patch(archive_path,new_archive);os.replace(new_archive,archive_path)
        community=app/'Contents/Resources/community';community.mkdir()
        for p in (HERE/'runtime').glob('*.cjs'):shutil.copy2(p,community/p.name)
        shutil.copy2(HERE/'profile.json',community/'profile.json')
        budget=community/'budget';(budget/'runtime').mkdir(parents=True);(budget/'native').mkdir()
        for p in (ROOT/'linux-features/low-memory-budget/runtime').glob('*.js'):shutil.copy2(p,budget/'runtime'/p.name)
        run(['xcrun','clang','-std=c11','-Wall','-Wextra','-Werror','-O2','-fblocks','-arch','arm64','-mmacosx-version-min=13.0',ROOT/'linux-features/low-memory-budget/native/macos-memory.c','-o',budget/'native/macos-memory'])
        run(['xcrun','clang','-std=c11','-Wall','-Wextra','-Werror','-O2','-arch','arm64','-mmacosx-version-min=13.0',f'-DCOMMUNITY_HEAP_MIB={int(profile["heapMiB"])}',f'-DUPSTREAM_EXECUTABLE="{original_exe}"',HERE/'launcher.c','-o',app/'Contents/MacOS/CodexCommunity'])
        info=community_plist(old,digest)
        (app/'Contents/Info.plist').write_bytes(plistlib.dumps(info))
        provenance={'upstream':pin,'sourceHeaderSHA256':original_hash,'patchedHeaderSHA256':digest,'profile':profile,'signing':'ad-hoc development; not notarized','teamBoundAccess':'removed; no access to original app groups or keychain groups','hardLimitEnforced':False}
        (community/'build-info.json').write_text(json.dumps(provenance,indent=2)+'\n')
        sign_copy(app,root_ent,temp)
        plan=run([app/'Contents/MacOS/CodexCommunity','--community-launch-plan'],capture_output=True,text=True)
        if json.loads(plan.stdout)['heapMiB']!=profile['heapMiB']:raise ValueError('Launcher profile mismatch')
        # Actual app boot is a release gate, not a test of a fabricated Electron fixture.
        run([sys.executable,HERE/'smoke.py',app,out/'smoke.json',out/'smoke.log'])
        shutil.copy2(HERE/'INSTALL.txt',stage/'INSTALL.txt')
        (stage/'Applications').symlink_to('/Applications',target_is_directory=True)
        candidate=temp/dmg_name
        run(['hdiutil','create','-volname','Codex Community','-srcfolder',stage,'-format','UDZO',candidate])
        run(['hdiutil','verify',candidate])
        run(['hdiutil','attach',candidate,'-readonly','-nobrowse','-mountpoint',mount])
        try:
            installed=mount/app.name
            run(['codesign','--verify','--deep','--strict',installed])
            copied=Archive(installed/'Contents/Resources/app.asar')
            try:
                if copied.header_hash!=digest:raise ValueError('DMG ASAR differs from tested app')
            finally:copied.close()
        finally:run(['hdiutil','detach',mount])
        shutil.move(candidate,final)
        provenance.update(dmg=dmg_name,sha256=sha256(final),bytes=final.stat().st_size)
        (out/'build-info.json').write_text(json.dumps(provenance,indent=2)+'\n')
        (out/'SHA256SUMS').write_text(provenance['sha256']+'  '+dmg_name+'\n')
        print(json.dumps(provenance,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',default=str(HERE/'dist'))
    parser.add_argument('--upstream-dmg',help='Audited local DMG; still must match pinned SHA-256')
    args=parser.parse_args()
    try:build(args)
    except (ValueError,RuntimeError,OSError,subprocess.CalledProcessError) as e:
        print('macOS build failed: '+str(e),file=sys.stderr);sys.exit(1)
