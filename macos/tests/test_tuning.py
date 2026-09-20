"""Compile the same portable launch setting parser used by Finder entrypoint."""
from pathlib import Path
import subprocess,tempfile,unittest
ROOT=Path(__file__).resolve().parents[1]
class TuningTest(unittest.TestCase):
 def test_heap_ablation_is_explicit_and_invalid_value_rejected(self):
  header=ROOT/'native/tuning.h';self.assertTrue(header.exists(),'launch ablations not implemented')
  with tempfile.TemporaryDirectory() as t:
   source=Path(t)/'test.c';binary=Path(t)/'test'
   source.write_text('#include <stdio.h>\n#include "tuning.h"\nint main(int n,char**v){int x=community_ablation(n>1?v[1]:NULL);printf("%d\\n",x);return x<0?2:0;}\n')
   subprocess.run(['cc','-std=c11','-Wall','-Wextra','-Werror','-I',str(header.parent),str(source),'-o',str(binary)],check=True)
   for name,value in [('none',0),('no-heap',1),('no-observer',2),('upstream-highlight',3),('typo',-1)]:
    p=subprocess.run([str(binary),name],capture_output=True,text=True)
    self.assertEqual(int(p.stdout),value);self.assertEqual(p.returncode,2 if value<0 else 0)
