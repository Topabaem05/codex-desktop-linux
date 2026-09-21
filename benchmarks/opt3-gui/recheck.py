#!/usr/bin/env python3
"""Recover numeric GUI diagnostics without misreporting unsupported cache APIs.

Runs only against verified disposable copies. Stock timing is NOT collected by
instrumented copies. The existing run.py stock path remains independently usable.
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path


def finite_number(value):
    return type(value) in (int, float) and 0 <= value < float('inf')


def assess(trial):
    probes = trial.get('internalProbes', [])
    primaries = [[c for c in p.get('contents', [])
                  if c.get('type') == 'window' and c.get('originClass') == 'packaged-app']
                 for p in probes]
    def has_heap(c):
        renderer = c.get('probe') or {}
        heap = renderer.get('heapKiB') or {}
        debug = (c.get('numericDebugger') or {}).get('heapBytes') or {}
        return finite_number(heap.get('usedHeapSize')) or finite_number(debug.get('usedSize'))
    ready = (trial.get('observed') is True and
             finite_number(trial.get('routesMountedReportedMs')))
    samples = trial.get('samples', [])
    complete = (ready and bool(samples) and all(finite_number(s.get('bytes')) for s in samples)
                and len(probes) == 5 and all(rows and any(has_heap(c) for c in rows) for rows in primaries)
                and all(finite_number(p.get('main', {}).get('heapBytes', {}).get('used_heap_size')) for p in probes))
    caches = [c.get('probe', {}).get('resourcesBytes') for rows in primaries for c in rows]
    cache_complete = len(probes) == 5 and all(primaries) and bool(caches) and all(isinstance(c, dict) for c in caches)
    return {'startupValid': ready, 'coreComplete': bool(complete),
            'cacheMeasurementComplete': cache_complete,
            'cacheMeasurementStatus': 'complete' if cache_complete else 'unavailable',
            'cacheClearMeasured': any(c.get('probe', {}).get('cacheClearAttempted') is True for rows in primaries for c in rows)}


def sanitize_cpu(value):
    """rusage fields were Mach ticks, not ns; do not publish invalid CPU rates."""
    if isinstance(value, list):
        return [sanitize_cpu(v) for v in value]
    if not isinstance(value, dict):
        return value
    names = {'cpuUserNs': 'cpuUserMachTicks', 'cpuSystemNs': 'cpuSystemMachTicks'}
    return {names.get(k, k): sanitize_cpu(v) for k, v in value.items()
            if k != 'survivingProcessCpuPercentOneCore'}


def main():
    if sys.platform != 'darwin':
        raise RuntimeError('Actual GUI recheck requires macOS')
    # Import platform work only after pure metric functions have been tested.
    import subprocess
    from common import ROOT, OPT_DMG, OPT_ZIP, prepare, build_observer, command
    from run import trial
    from instrument import inject
    output_dir = ROOT / 'gui-audit-reports'
    output_dir.mkdir(exist_ok=True)
    output = output_dir / 'recheck.json'
    result = {'kind': 'numeric-probe-recheck', 'authenticated': False, 'modelTurns': 0,
              'productModified': False, 'opt3DmgSHA256': OPT_DMG,
              'opt3ArtifactZipSHA256': OPT_ZIP, 'warmups': [], 'trials': [],
              'stockReferenceRun': 35510598767,
              'cpuNote': 'Native CPU counters are raw Mach ticks. Invalid old ns-based rates are omitted. Electron-provided CPU statistics are separate.',
              'cacheNote': 'Unavailable API != zero cache and != successful cache release.',
              'environment': {'os': subprocess.check_output(['sw_vers'], text=True),
                              'arch': subprocess.check_output(['uname', '-m'], text=True).strip(),
                              'ramBytes': int(subprocess.check_output(['sysctl', '-n', 'hw.memsize'], text=True))}}
    def save():
        output.write_text(json.dumps(sanitize_cpu(result), indent=2) + '\n')
    try:
        with tempfile.TemporaryDirectory(prefix='codex-probe-recheck-', ignore_cleanup_errors=True) as tmp:
            root = Path(tmp)
            apps, pin = prepare(root)
            result['originalDmgSHA256'] = pin['sha256']
            helper, window = build_observer(root)
            result['backendVersions'] = {mode: command([app / 'Contents/Resources/codex', '--version'], capture_output=True, text=True).stdout.strip() for mode, app in apps.items()}
            # Warm actual, unmodified binaries first. Each mode retains only its
            # own disposable profile; sign/instrument AFTER runtime preparation.
            for mode, app in apps.items():
                warm = trial(app, root / (mode + '-profile'), mode, helper, window, warmup=True)
                result['warmups'].append(warm)
                save()
                print(json.dumps({'mode': mode, 'stage': 'warmup', 'observed': warm['observed']}), flush=True)
            result['probeCopies'] = {}
            for mode, app in apps.items():
                scratch = root / (mode + '-signing')
                scratch.mkdir()
                result['probeCopies'][mode] = inject(app, scratch)
            for mode, app in apps.items():
                profile = root / (mode + '-profile')
                # Never mistake a previous process's probe snapshots for this one.
                shutil.rmtree(profile / 'probe', ignore_errors=True)
                record = trial(app, profile, mode, helper, window, probe=True)
                record['assessment'] = assess(record)
                result['trials'].append(record)
                save()
                print(json.dumps({'mode': mode, 'stage': 'measured-probe', **record['assessment']}), flush=True)
            result['coreComplete'] = len(result['trials']) == 2 and all(t['assessment']['coreComplete'] for t in result['trials'])
            result['cacheMeasurementComplete'] = all(t['assessment']['cacheMeasurementComplete'] for t in result['trials'])
            save()
            if not result['coreComplete']:
                raise RuntimeError('Core GUI/heap observations incomplete; no matched memory claim allowed')
    except Exception as exc:
        result['error'] = str(exc)
        save()
        raise


if __name__ == '__main__':
    main()
