import importlib.util, pathlib, unittest
p=pathlib.Path(__file__).with_name('run.py')
s=importlib.util.spec_from_file_location('bench',p)
m=importlib.util.module_from_spec(s)
if p.exists(): s.loader.exec_module(m)
class Metrics(unittest.TestCase):
 def test_missing_bytes_are_unknown(self):
  self.assertTrue(hasattr(m,'sum_footprint'),'sum_footprint not implemented')
  self.assertIsNone(m.sum_footprint({'processes':[{'footprintBytes':3},{'footprintBytes':None}]}))
 def test_valid_bytes(self):
  self.assertTrue(hasattr(m,'sum_footprint'),'sum_footprint not implemented')
  self.assertEqual(m.sum_footprint({'processes':[{'footprintBytes':3},{'footprintBytes':7}]}),10)
 def test_pid_reuse(self):
  self.assertTrue(hasattr(m,'same_identity'),'same_identity not implemented')
  a={'pid':4,'uid':500,'startId':'a'}
  self.assertFalse(m.same_identity(a,dict(a,startId='b')))
  self.assertFalse(m.same_identity(a,None))
  self.assertTrue(m.same_identity(a,dict(a)))

class Markers(unittest.TestCase):
 def test_primary_marker_does_not_use_overlay(self):
  self.assertTrue(hasattr(m,'markers'),'markers missing')
  data=m.markers('window ready-to-show appearance=avatarOverlay hostId=local startupElapsedMs=20\nwindow ready-to-show appearance=primary hostId=local startupElapsedMs=800\n')
  self.assertEqual(data['primaryReadyReportedMs'],800)
 def test_absent_marker_is_not_zero(self):
  self.assertTrue(hasattr(m,'markers'),'markers missing')
  self.assertEqual(m.markers('unrelated log'),{})

if __name__=='__main__':unittest.main()
