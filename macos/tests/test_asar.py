import hashlib, json, pathlib, struct, tempfile, unittest
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import asar

class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()
    def fixture(self):
        p = self.root / 'app.asar'
        package = b'{"main":"main.js","name":"upstream"}'
        payload = package + b'console.log("original");'
        header = {'files': {'package.json': {'offset': '0', 'size': len(package)},
                            'main.js': {'offset': str(len(package)), 'size': len(payload)-len(package)}}}
        p.write_bytes(asar.encode_header(header)[0] + payload)
        return p, payload
    def test_append_preserves_original_payload_and_main(self):
        p, original = self.fixture(); out = self.root/'new.asar'
        old = asar.Archive(p); before=old.read('main.js'); old.close()
        digest = asar.patch(p, out)
        a=asar.Archive(out)
        self.assertEqual(a.read('main.js'), before)
        self.assertEqual(out.read_bytes()[a.data_offset:a.data_offset+len(original)], original)
        package=json.loads(a.read('package.json'))
        self.assertEqual(package['main'], '.community-bootstrap.cjs')
        self.assertIn(b'community/runtime.cjs', a.read('.community-bootstrap.cjs'))
        self.assertEqual(a.header_hash, digest)
        e=a.header['files']['package.json']; self.assertEqual(e['integrity']['hash'],hashlib.sha256(a.read('package.json')).hexdigest())
        a.close()
    def test_nested_overlays_preserve_payload_and_integrity(self):
        p,original=self.fixture();out=self.root/'nested.asar'
        asar.patch(p,out,overlays={'nested/mod.js':b'"use strict";'})
        a=asar.Archive(out)
        self.assertEqual(a.read('nested/mod.js'),b'"use strict";')
        self.assertEqual(out.read_bytes()[a.data_offset:a.data_offset+len(original)],original)
        self.assertEqual(a.header['files']['nested']['files']['mod.js']['integrity']['hash'],hashlib.sha256(b'"use strict";').hexdigest())
        a.close()
    def test_overlay_cannot_override_bootstrap_or_escape_archive(self):
        p,_=self.fixture()
        for name in ['../bad.js','/bad.js','package.json','.community-bootstrap.cjs']:
            with self.assertRaises(ValueError):asar.patch(p,self.root/'bad.asar',overlays={name:b'x'})
    def test_refuses_repeated_patching(self):
        p,_=self.fixture(); out=self.root/'new.asar'; asar.patch(p,out)
        with self.assertRaises(ValueError): asar.patch(out,self.root/'third.asar')
    def test_refuses_overwrite_source(self):
        p,_=self.fixture()
        with self.assertRaises(ValueError): asar.patch(p,p)
    def test_refuses_unsafe_or_missing_entry(self):
        p,_=self.fixture(); a=asar.Archive(p)
        for name in ['../main.js','/main.js','missing.js']:
            with self.assertRaises((ValueError,KeyError)): a.read(name)
        a.close()
    def test_rejects_truncated_header(self):
        p=self.root/'bad';p.write_bytes(b'1234')
        with self.assertRaises(ValueError): asar.Archive(p)
    def test_alignment(self):
        for n in range(12):
            encoded,digest=asar.encode_header({'files':{},'padding':'x'*n})
            self.assertEqual(len(encoded)%4,0)
            self.assertEqual(struct.unpack_from('<I',encoded,4)[0]+8,len(encoded))

if __name__ == '__main__': unittest.main()
