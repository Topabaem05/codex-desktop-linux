import importlib.util
import pathlib
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
try:
 import optimization_patches as op
except ImportError:
 op=None

class OptimizationTests(unittest.TestCase):
 def test_module_exists(self):self.assertIsNotNone(op)
 def test_unique_anchor_and_drift(self):
  if op is None:self.skipTest('module missing')
  self.assertEqual(op.replace_once('A before B','before','after'),'A after B')
  for src in ['nothing','before before']:
   with self.assertRaises(ValueError):op.replace_once(src,'before','after')
 def test_specs_are_unique_bounded_and_reversible(self):
  if op is None:self.skipTest('module missing')
  self.assertGreaterEqual(len(op.SPECS),5)
  for name,spec in op.SPECS.items():
   self.assertNotIn('..',name.split('/'));self.assertEqual(len(spec['sha256']),64)
   for before,after in spec['edits']:
    self.assertNotEqual(before,after);self.assertIn(op.SWITCH,after)
 def test_unknown_version_rejected_before_edits(self):
  if op is None:self.skipTest('module missing')
  with self.assertRaises(ValueError):op.transform(next(iter(op.SPECS)),b'wrong input')
