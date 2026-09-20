"""Bounded real-process tests; never signal outside owned fixtures."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'native/mcp-guardian.c'

def live(pid):
    p = subprocess.run(['ps', '-p', str(pid), '-o', 'stat='], capture_output=True, text=True)
    return p.returncode == 0 and bool(p.stdout.strip()) and not p.stdout.strip().startswith('Z')

def wait_for(fn, seconds=4):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if fn(): return True
        time.sleep(.03)
    return False

class GuardianTest(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SOURCE.exists(), 'native MCP guardian not implemented')
        self.tmp = tempfile.TemporaryDirectory(prefix='guardian-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.bin = self.root / 'guardian'
        subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2', str(SOURCE), '-o', str(self.bin)], check=True)

    def command(self, *args):
        return [str(self.bin), '--grace-ms', '150', '--', *args]

    def test_binary_relay_argv_env_and_exit(self):
        blob = bytes(range(256)) * 4096
        p = subprocess.run(self.command(sys.executable, '-c', 'import sys;sys.stdout.buffer.write(sys.stdin.buffer.read())'), input=blob, capture_output=True, timeout=6)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, blob)
        p = subprocess.run(self.command(sys.executable, '-c', 'import sys,os,json;print(json.dumps([sys.argv[1],os.environ["TEST_GUARD"],os.getcwd()]));sys.exit(7)', '한 글;$(false)'), env=dict(os.environ, TEST_GUARD='keep'), cwd=self.root, capture_output=True, text=True, timeout=4)
        self.assertEqual(p.returncode, 7, p.stderr)
        self.assertEqual(json.loads(p.stdout), ['한 글;$(false)', 'keep', str(self.root)])

    def fixture(self):
        script = self.root/'stubborn.py'
        script.write_text('''import os,signal,time,sys
signal.signal(signal.SIGTERM,signal.SIG_IGN)
child=os.fork()
with open(sys.argv[1],'a') as f:f.write(str(os.getpid())+'\\n')
if child and len(sys.argv)>2:sys.exit(0)
while True:time.sleep(.1)
''')
        return script

    def tree_case(self, how):
        marker = self.root/'pids'
        cmd = self.command(sys.executable, str(self.fixture()), str(marker), *(['exit'] if how=='command-exit' else []))
        unrelated = subprocess.Popen([sys.executable,'-c','import time;time.sleep(20)'])
        self.addCleanup(lambda: unrelated.poll() is None and unrelated.kill())
        self.addCleanup(lambda: None)
        parent=None
        if how=='parent-crash':
            code='import subprocess,sys,time; p=subprocess.Popen(sys.argv[1:],stdin=subprocess.PIPE);print(p.pid,flush=True);time.sleep(20)'
            parent=subprocess.Popen([sys.executable,'-c',code,*cmd], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            guard_pid=int(parent.stdout.readline())
            guard=None
        else:
            guard=subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            guard_pid=guard.pid
        pids=[]
        try:
            self.assertTrue(wait_for(lambda: marker.exists() and len(marker.read_text().splitlines())>=2))
            pids=list(map(int,marker.read_text().splitlines()))
            self.assertTrue(live(unrelated.pid))
            if how=='eof':guard.stdin.close()
            elif how=='term':guard.terminate()
            elif how=='wrapper-kill':guard.kill()
            elif how=='parent-crash':parent.kill();parent.wait(timeout=3)
            self.assertTrue(wait_for(lambda: all(not live(p) for p in pids)), f'owned descendants remain: {pids}')
            self.assertTrue(wait_for(lambda:not live(guard_pid)), 'guardian remained')
            self.assertTrue(live(unrelated.pid), 'unrelated process killed')
            if guard:guard.wait(timeout=2)
        finally:
            # This is fixture cleanup after assertions, not a product success.
            for pid in pids:
                if live(pid):
                    try:os.kill(pid,signal.SIGKILL)
                    except ProcessLookupError:pass
            if guard and guard.poll() is None:guard.kill();guard.wait()
            if parent and parent.poll() is None:parent.kill();parent.wait()
            unrelated.kill();unrelated.wait()
            if guard:
                for f in [guard.stdin,guard.stdout,guard.stderr]:f.close()
            if parent:parent.stdout.close();parent.stderr.close()

    def test_eof_cleans_stubborn_tree(self):self.tree_case('eof')
    def test_sigterm_cleans_stubborn_tree(self):self.tree_case('term')
    def test_direct_wrapper_kill_cleans_stubborn_tree(self):self.tree_case('wrapper-kill')
    def test_parent_crash_cleans_stubborn_tree(self):self.tree_case('parent-crash')
    def test_exited_command_still_cleans_workers(self):self.tree_case('command-exit')

    def test_full_relay_does_not_hide_upstream_hangup(self):
        marker=self.root/'blocked-pids'
        p=subprocess.Popen(self.command(sys.executable,str(self.fixture()),str(marker)),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        pids=[]
        try:
            self.assertTrue(wait_for(lambda: marker.exists() and len(marker.read_text().splitlines())>=2))
            pids=list(map(int,marker.read_text().splitlines()))
            os.set_blocking(p.stdin.fileno(),False)
            sent=0;end=time.monotonic()+.5
            while time.monotonic()<end:
                try:sent+=os.write(p.stdin.fileno(),b'x'*8192)
                except BlockingIOError:time.sleep(.005)
            self.assertGreater(sent,0)
            p.stdin.close()
            self.assertTrue(wait_for(lambda: p.poll() is not None), 'full relay masked owner pipe closure')
            self.assertTrue(wait_for(lambda: all(not live(pid) for pid in pids)))
        finally:
            for pid in pids:
                if live(pid):
                    try:os.kill(pid,signal.SIGKILL)
                    except ProcessLookupError:pass
            if p.poll() is None:p.kill();p.wait()
            for f in [p.stdin,p.stdout,p.stderr]:f.close()

    def test_rejects_bad_options_and_propagates_exec_error(self):
        for args in [[], ['--grace-ms','-1','--','true'], ['--grace-ms','10x','--','true']]:
            p=subprocess.run([str(self.bin),*args],capture_output=True,timeout=2)
            self.assertEqual(p.returncode,2)
        p=subprocess.run(self.command('/does/not/exist'),capture_output=True,timeout=3)
        self.assertEqual(p.returncode,127)

if __name__=='__main__':unittest.main()
