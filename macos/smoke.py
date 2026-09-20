#!/usr/bin/env python3
"""Boot the actual app in a disposable profile and verify runtime hooks.

This is an unauthenticated launch test, not an agent memory benchmark.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

def smoke(app, report_path, log_path, mode="normal"):
    app=Path(app).resolve(); report_path=Path(report_path);log_path=Path(log_path)
    report_path.parent.mkdir(parents=True,exist_ok=True)
    if sys.platform!='darwin':raise RuntimeError('Native smoke requires macOS')
    with tempfile.TemporaryDirectory(prefix='codex-community-smoke-') as tmp:
        root=Path(tmp);state=root/'telemetry'
        env=dict(os.environ,CODEX_COMMUNITY_STATE_DIR=str(state),CODEX_HOME=str(root/'codex'))
        env.pop('CODEX_COMMUNITY_SAFE_MODE',None)
        env.pop('CODEX_COMMUNITY_ABLATION',None)
        command=[str(app/'Contents/MacOS/CodexCommunity'),'--user-data-dir='+str(root/'profile')]
        safe=mode=='safe'
        if safe:command.append('--community-safe-mode')
        final={'passed':False,'authenticated':False,'agentBenchmark':False,'safeModeTest':safe}
        with log_path.open('wb') as log:
            child=subprocess.Popen(command,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            try:
                deadline=time.monotonic()+120
                while time.monotonic()<deadline:
                    if child.poll() is not None:raise RuntimeError(f'Actual app exited during boot: {child.returncode}')
                    status=state/'status.json'
                    if status.exists():
                        value=json.loads(status.read_text())
                        final['runtime']=value
                        if safe and value.get('ready') and value.get('safePreloadReady',0)>0:
                            if not value.get('safeMode') or value.get('samples')!=0 or value.get('uiApplied')!=0:
                                raise RuntimeError('Safe mode still applies optimization hooks')
                            final['passed']=True;break
                        if not safe and value.get('ready') and value.get('samples',0)>=2 and value.get('uiApplied',0)>0 and value.get('preloadReady',0)>0:
                            if not isinstance(value.get('bytes'),int) or value['bytes']<=0:raise RuntimeError('Footprint telemetry missing')
                            if value['heapLimitBytes']>650*1024*1024:raise RuntimeError('Configured heap limit not applied')
                            if value.get('version')!=3 or value.get('observerMode')!='persistent-native':raise RuntimeError('Old optimization runtime')
                            if value.get('groups',{}).get('observer',{}).get('count')!=1:raise RuntimeError('Observer duplicated or missing')
                            if value['hardLimitEnforced'] or value['safeMode']:raise RuntimeError('Unexpected active profile')
                            final['passed']=True;break
                    time.sleep(1)
                if not final['passed']:raise RuntimeError('Runtime/CSS/preload/footprint integration did not become ready')
            finally:
                report_path.write_text(json.dumps(final,indent=2)+'\n')
                # Only our own still-live process group. Never kill by app name.
                if child.poll() is None:
                    os.killpg(child.pid,signal.SIGTERM)
                    try:child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5)
        print(json.dumps(final,indent=2))
if __name__=='__main__':
    try:smoke(*sys.argv[1:])
    except (RuntimeError,OSError,ValueError) as e:
        print('Native smoke failed: '+str(e),file=sys.stderr);sys.exit(1)
