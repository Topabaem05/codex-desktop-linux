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
if __name__=='__main__':unittest.main()
