import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('mac_build_entitlements',Path(__file__).parents[1]/'build.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class EntitlementTests(unittest.TestCase):
    def test_development_signing_drops_only_original_team_claims(self):
        original={'com.apple.security.cs.allow-jit':True,'com.apple.security.cs.disable-library-validation':True,'com.apple.security.application-groups':['OLDTEAM.app'],'com.apple.developer.team-identifier':'OLDTEAM','keychain-access-groups':['OLDTEAM.secret']}
        cleaned,removed=m.development_entitlements(original)
        self.assertEqual(cleaned,{'com.apple.security.cs.allow-jit':True,'com.apple.security.cs.disable-library-validation':True})
        self.assertEqual(set(removed),{'com.apple.security.application-groups','com.apple.developer.team-identifier','keychain-access-groups'})
        self.assertIn('keychain-access-groups',original)
        with self.assertRaises(ValueError):m.development_entitlements({'com.apple.developer.unknown-restricted-capability':True})
    def test_original_apns_production_claim_is_not_copied(self):
        clean,removed=m.development_entitlements({'com.apple.developer.aps-environment':'production','com.apple.security.network.client':True})
        self.assertEqual(clean,{'com.apple.security.network.client':True})
        self.assertEqual(removed,['com.apple.developer.aps-environment'])
