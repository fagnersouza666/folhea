"""Effective four-service quotas plus explicit 512 MiB reserve, fail closed."""
import copy
import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[3]
MiB=1024**2
class ResourcesTest(unittest.TestCase):
    def setUp(self):
        s=importlib.util.spec_from_file_location('resources',ROOT/'scripts/ops/deploy-folhea.py')
        self.d=importlib.util.module_from_spec(s);s.loader.exec_module(self.d)
        self.model={'services':{name:{'mem_limit':value*MiB} for name,value in [('keycloak',1024),('backend',768),('redis',384),('caddy',128)]}}
    def test_threshold_exact_below_and_larger_quota(self):
        threshold=2816*MiB
        self.assertEqual(self.d.required_memory(self.model),threshold)
        self.d.validate_resources(self.model,threshold,8*1024**3)
        with self.assertRaises(self.d.DeployFailure):self.d.validate_resources(self.model,threshold-1,8*1024**3)
        bigger=copy.deepcopy(self.model);bigger['services']['keycloak']['mem_limit']+=512*MiB
        self.assertEqual(self.d.required_memory(bigger),threshold+512*MiB)
        with self.assertRaises(self.d.DeployFailure):self.d.validate_resources(self.model,threshold,8*1024**3-1)
    def test_missing_unlimited_invalid_and_shared_pg_fail_closed(self):
        for value in (None,0,-1,True,1.5,'unlimited','1g','0','-1'):
            c=copy.deepcopy(self.model);c['services']['caddy']['mem_limit']=value
            with self.subTest(value=value),self.assertRaises(self.d.DeployFailure):self.d.required_memory(c)
        c=copy.deepcopy(self.model);del c['services']['backend']['mem_limit']
        with self.assertRaises(self.d.DeployFailure):self.d.required_memory(c)
        c=copy.deepcopy(self.model);c['services']['postgres']={'mem_limit':512*MiB}
        with self.assertRaises(self.d.DeployFailure):self.d.required_memory(c)
if __name__=='__main__':unittest.main()
