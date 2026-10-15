"""Config digest remains authoritative across Docker stores exposing manifest IDs."""
import hashlib
import importlib.util
import io
import json
import os
import tempfile
from unittest.mock import patch
from pathlib import Path
import tarfile
import unittest

ROOT = Path(__file__).resolve().parents[3]

class ImageIdentityTest(unittest.TestCase):
    def module(self):
        spec=importlib.util.spec_from_file_location('deploy_identity',ROOT/'scripts/ops/deploy-folhea.py')
        m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

    def archive(self, reference, config, declared_config=None):
        digest=hashlib.sha256(config).hexdigest();name='blobs/sha256/'+digest
        output=io.BytesIO()
        with tarfile.open(fileobj=output,mode='w') as archive:
            for path,body in [(name,config),('manifest.json',json.dumps([{'Config':declared_config or name,'RepoTags':[reference],'Layers':[]}]).encode())]:
                member=tarfile.TarInfo(path);member.size=len(body);archive.addfile(member,io.BytesIO(body))
        output.seek(0);return output,'sha256:'+digest

    def test_exported_config_digest_and_manifest_reference_must_both_match(self):
        m=self.module();reference='folhea/backend:'+'a'*40
        body=json.dumps({'architecture':'amd64','os':'linux','rootfs':{'type':'layers','diff_ids':['sha256:'+'d'*64]}}).encode()
        stream,digest=self.archive(reference,body)
        m.verify_archive_config(stream,digest,reference)
        stream,_=self.archive(reference,body,declared_config='blobs/sha256/'+'f'*64)
        with self.assertRaises(m.DeployFailure):m.verify_archive_config(stream,digest,reference)
        stream,_=self.archive('another/image:mutable',body)
        with self.assertRaises(m.DeployFailure):m.verify_archive_config(stream,digest,reference)
        stream,_=self.archive(reference,body.replace(b'amd64',b'arm64'))
        with self.assertRaises(m.DeployFailure):m.verify_archive_config(stream,digest,reference)

    def test_complete_rootfs_and_platform_match_for_both_image_stores(self):
        m=self.module();good={'os':'linux','architecture':'amd64','rootfs':{'Type':'layers','Layers':['sha256:'+'d'*64]}}
        m.validate_image_metadata(good,good)
        for bad in ({**good,'architecture':'arm64'},{**good,'os':'windows'},
                    {**good,'rootfs':{'Type':'layers','Layers':['sha256:'+'e'*64]}},
                    {**good,'rootfs':{'Type':'layers','Layers':[]}},{}):
            with self.assertRaises(m.DeployFailure):m.validate_image_metadata(bad,good)

    def test_classic_and_containerd_resolve_immutable_runtime_after_attestation(self):
        m=self.module();source='a'*40
        config={'architecture':'amd64','os':'linux','rootfs':{'type':'layers','diff_ids':['sha256:'+'d'*64]}}
        body=json.dumps(config).encode();digest='sha256:'+hashlib.sha256(body).hexdigest()
        metadata={'os':'linux','architecture':'amd64','rootfs':{'Type':'layers','Layers':config['rootfs']['diff_ids']}}
        for store in ('classic','containerd'):
            actual=digest if store=='classic' else 'sha256:'+'f'*64
            with self.subTest(store=store),tempfile.TemporaryDirectory() as folder:
                docker=Path(folder)/'docker'
                script='#!/usr/bin/python3\nimport sys,json,io,tarfile\n'
                script+='body='+repr(body)+';digest='+repr(digest)+';actual='+repr(actual)+';metadata='+repr(metadata)+'\n'
                script+="""a=sys.argv[1:]
if a[0]=='image':
 print(json.dumps(metadata) if 'rootfs' in a[a.index('--format')+1] else actual)
elif a[0]=='save':
 out=io.BytesIO();name='blobs/sha256/'+digest.split(':')[1]
 with tarfile.open(fileobj=out,mode='w') as archive:
  for path,data in [(name,body),('manifest.json',json.dumps([{'Config':name,'RepoTags':[a[-1]],'Layers':[]}]).encode())]:
   entry=tarfile.TarInfo(path);entry.size=len(data);archive.addfile(entry,io.BytesIO(data))
 sys.stdout.buffer.write(out.getvalue())
else:raise SystemExit(2)
"""
                docker.write_text(script);docker.chmod(0o700)
                images={name:digest for name in m.SERVICES};meta={name:metadata for name in m.SERVICES}
                with patch.dict(os.environ,{'PATH':folder}):result=m.verified_runtime_images(source,images,meta)
                self.assertEqual(result,{name:actual for name in m.SERVICES})

if __name__=='__main__':unittest.main()
