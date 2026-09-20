import importlib.util
from pathlib import Path
import unittest
p=Path(__file__).with_name('common.py')
s=importlib.util.spec_from_file_location('common',p)
m=importlib.util.module_from_spec(s)
if p.exists():s.loader.exec_module(m)
class Metrics(unittest.TestCase):
 def test_role_flags_not_unrelated_names(self):
  self.assertTrue(hasattr(m,'classify'))
  self.assertEqual(m.classify(12,1,'/app/Helper --type=renderer','other'),'renderer')
  self.assertEqual(m.classify(12,1,'python renderer_test.py','python-tool'),'python-tool')
  self.assertEqual(m.classify(1,1,'ChatGPT','other'),'ui-main')
  self.assertEqual(m.classify(12,1,'/app/Helper --type=utility --utility-sub-type=network.mojom.NetworkService','other'),'network')
 def test_missing_not_zero(self):
  self.assertTrue(hasattr(m,'summarize'))
  out=m.summarize([{'pid':1,'role':'renderer','footprintBytes':4},{'pid':2,'role':'renderer','footprintBytes':None}])
  self.assertIsNone(out['bytes']);self.assertIsNone(out['groups']['renderer']['bytes'])
 def test_unique_pid_and_role_totals(self):
  self.assertTrue(hasattr(m,'summarize'))
  with self.assertRaises(ValueError):m.summarize([{'pid':1},{'pid':1}])
  out=m.summarize([{'pid':1,'role':'ui-main','footprintBytes':2},{'pid':2,'role':'codex-engine','footprintBytes':3},{'pid':3,'role':'renderer','footprintBytes':5}])
  self.assertEqual(out['bytes'],10);self.assertEqual(out['electronBytes'],7)
 def test_identity_never_matches_unknown(self):
  self.assertTrue(hasattr(m,'same'))
  self.assertFalse(m.same({'pid':3},{'pid':3}))
  a={'pid':3,'uid':5,'startId':'a'}
  self.assertTrue(m.same(a,dict(a)));self.assertFalse(m.same(a,dict(a,startId='b')))
 def test_install_started_is_not_download_proof(self):
  self.assertTrue(hasattr(m,'markers'))
  out=m.markers('primary_runtime_bundle_install_started trigger=startup_missing\nprimary_runtime_bundle_install_outcome outcome=already-present\n')
  self.assertEqual(out['installRequests'],1);self.assertEqual(out['installOutcomes'],['already-present'])
  self.assertIsNone(out['networkBytes'])
 def test_primary_not_overlay(self):
  self.assertTrue(hasattr(m,'markers'))
  out=m.markers('window ready-to-show appearance=avatarOverlay startupElapsedMs=3\nwindow ready-to-show appearance=primary hostId=local startupElapsedMs=500\napp routes mounted after 900ms')
  self.assertEqual(out['primaryReadyReportedMs'],500);self.assertEqual(out['routesMountedReportedMs'],900)
 def test_cpu_counts_only_matching_lifetimes(self):
  self.assertTrue(hasattr(m,'cpu_delta'))
  a={'pid':1,'uid':500,'startId':'a','cpuUserNs':100,'cpuSystemNs':20}
  b=dict(a,cpuUserNs=150,cpuSystemNs=30)
  self.assertEqual(m.cpu_delta([a],[b]),60)
  self.assertEqual(m.cpu_delta([a],[dict(b,startId='b')]),0)
if __name__=='__main__':unittest.main()
