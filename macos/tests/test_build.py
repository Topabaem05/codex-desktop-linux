import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('mac_build',Path(__file__).parents[1]/'build.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class BuildTests(unittest.TestCase):
    def test_validate_pinned_input(self):
        valid={'url':'https://persistent.oaistatic.com/codex-app-prod/Codex.dmg','sha256':'a'*64,'teamID':'2DC432GLL2','architecture':'arm64','version':'26.915.31945'}
        self.assertEqual(m.validate_pin(valid),valid)
        for key,value in [('url','http://example.com/a.dmg'),('sha256','a'),('architecture','x86_64'),('teamID','')]:
            with self.subTest(key=key),self.assertRaises(ValueError):
                m.validate_pin(dict(valid,**{key:value}))
    def test_bundle_plist_retains_native_contracts(self):
        old={'CFBundleIdentifier':'com.openai.codex','CFBundleExecutable':'ChatGPT','NSPrincipalClass':'BrowserCrApplication','LSMinimumSystemVersion':'13.0','ElectronAsarIntegrity':{'Resources/app.asar':{'algorithm':'SHA256','hash':'a'*64}}}
        new=m.community_plist(old,'b'*64)
        self.assertEqual(old['CFBundleExecutable'],'ChatGPT')
        self.assertEqual(new['CFBundleExecutable'],'CodexCommunity')
        self.assertEqual(new['CFBundleIdentifier'],old['CFBundleIdentifier'])
        self.assertEqual(new['NSPrincipalClass'],old['NSPrincipalClass'])
        self.assertEqual(new['ElectronAsarIntegrity']['Resources/app.asar']['hash'],'b'*64)
    def test_sign_order_is_inside_out_and_ignores_symlinks(self):
        with tempfile.TemporaryDirectory() as t:
            app=Path(t)/'A.app'; nested=app/'Contents/Frameworks/F.framework/Versions/A'
            nested.mkdir(parents=True); binary=nested/'F'; binary.write_bytes(b'\xcf\xfa\xed\xfe'+b'\0'*12)
            link=app/'alias';link.symlink_to(nested,target_is_directory=True)
            result=m.sign_targets(app)
            self.assertEqual(result[-1],app)
            self.assertIn(binary,result)
            self.assertNotIn(link,result)
            self.assertLess(result.index(binary),result.index(app/'Contents/Frameworks/F.framework'))
    def test_unsafe_original_executable_rejected(self):
        for value in ['../bad','/bin/sh','ChatGPT;echo','',None]:
            with self.subTest(value=value),self.assertRaises(ValueError):m.executable_name(value)
        self.assertEqual(m.executable_name('ChatGPT'),'ChatGPT')
if __name__=='__main__':unittest.main()
