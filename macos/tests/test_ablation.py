import importlib.util,pathlib,unittest
p=pathlib.Path(__file__).with_name('startup-ablation.py')
spec=importlib.util.spec_from_file_location('ablation',p);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class AblationTest(unittest.TestCase):
 def test_markers_do_not_convert_missing_measurements_to_zero(self):
  self.assertEqual(mod.markers('unrelated 000'),{})
  self.assertEqual(mod.markers('window ready-to-show appearance=primary startupElapsedMs=123\napp routes mounted after 456ms'),{'primaryReadyMs':123,'routesMountedMs':456})
 def test_identity_requires_start_id(self):
  self.assertFalse(mod.same({'pid':1,'uid':2},{'pid':1,'uid':2}))
  self.assertTrue(mod.same({'pid':1,'uid':2,'startId':'3'},{'pid':1,'uid':2,'startId':'3'}))
