import unittest
from recheck import assess, sanitize_cpu

class RecheckTests(unittest.TestCase):
    def valid(self):
        return {'observed':True,'routesMountedReportedMs':5000,
                'samples':[{'bytes':700,'processes':[]}],
                'internalProbes':[{'label':str(n),'main':{'heapBytes':{'used_heap_size':50}},
                   'contents':[{'type':'window','originClass':'packaged-app',
                       'probe':{'heapKiB':{'usedHeapSize':10},'resourcesBytes':None,
                                'apiErrors':{'resourcesBytes':'unavailable'}}}]} for n in range(5)]}
    def test_missing_cache_is_not_zero_or_full_success(self):
        r=assess(self.valid())
        self.assertTrue(r['coreComplete'])
        self.assertFalse(r['cacheMeasurementComplete'])
        self.assertEqual(r['cacheMeasurementStatus'],'unavailable')
    def test_startup_failure_cannot_look_like_a_memory_improvement(self):
        t=self.valid();t.pop('routesMountedReportedMs')
        self.assertFalse(assess(t)['coreComplete'])
    def test_partial_heap_and_missing_samples_remain_failures(self):
        t=self.valid();t['internalProbes'][0]['contents'][0]['probe']['heapKiB']=None
        self.assertFalse(assess(t)['coreComplete'])
        t=self.valid();t['samples'][0]['bytes']=None
        self.assertFalse(assess(t)['coreComplete'])
    def test_raw_mach_ticks_must_not_be_reported_as_nanoseconds(self):
        t={'samples':[{'cpuUserNs':10,'cpuSystemNs':20,'survivingProcessCpuPercentOneCore':1.0}],
           'main':{'memoryBytes':{'rss':30}}, 'cpu':{'cumulativeCPUUsage':1.2}}
        out=sanitize_cpu(t)
        self.assertNotIn('cpuUserNs',out['samples'][0])
        self.assertEqual(out['samples'][0]['cpuUserMachTicks'],10)
        self.assertNotIn('survivingProcessCpuPercentOneCore',out['samples'][0])
        self.assertEqual(out['main']['memoryBytes']['rss'],30)
        self.assertEqual(out['cpu']['cumulativeCPUUsage'],1.2)

if __name__=='__main__':unittest.main()
