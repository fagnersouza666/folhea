"""Run the real backup script; only Docker and the remote S3 boundary are fakes."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]


class BackupDestinationTest(unittest.TestCase):
    def test_s3_prefix_and_bucket_root_accept_trailing_slashes(self):
        # A different upload/head key must fail, even when a filesystem would
        # collapse consecutive slashes. S3 object keys are exact strings.
        for destination in ('s3://bucket/prefix', 's3://bucket/prefix/',
                            's3://bucket/prefix///', 's3://bucket',
                            's3://bucket/', 's3://bucket///'):
            with self.subTest(destination=destination), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                (base / 'compose.yml').write_text('services: {}\n')
                (base / 'env').write_text('DB_PASSWORD=synthetic-fixture\n')
                objects = base / 'objects'; objects.mkdir()
                docker = base / 'docker'
                docker.write_text('#!/bin/sh\nprintf "PGDMP synthetic backup\\n"\n')
                docker.chmod(0o700)
                aws = base / 'aws'
                aws.write_text('''#!/usr/bin/env python3
import hashlib,os,shutil,sys
from pathlib import Path
args=sys.argv[1:]
if args[:2]==['s3','cp']:
    uri=args[-1]
elif args[:2]==['s3api','head-object']:
    uri='s3://'+args[args.index('--bucket')+1]+'/'+args[args.index('--key')+1]
else:
    sys.exit(2)
obj=Path(os.environ['FAKE_S3_OBJECTS'])/hashlib.sha256(uri.encode()).hexdigest()
if args[:2]==['s3','cp']:
    shutil.copyfile(args[-2],obj)
elif not obj.is_file():
    sys.exit(1)
''')
                aws.chmod(0o700)
                env = dict(os.environ, DOCKER_BIN=str(docker), AWS_BIN=str(aws),
                           FAKE_S3_OBJECTS=str(objects), DB_NAME='folhea', DB_USERNAME='folhea',
                           COMPOSE_FILE=str(base / 'compose.yml'), COMPOSE_ENV_FILE=str(base / 'env'),
                           BACKUP_DIR=str(base / 'backups'), BACKUP_EXTERNAL_DESTINATION=destination)
                env.pop('OPS_EXTERNAL_POSTGRES_CONTAINER', None)
                result = subprocess.run(['bash', str(ROOT / 'scripts/ops/backup-postgres.sh')],
                                        env=env, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                artifact, = (base / 'backups').glob('*.dump')
                prefix = 'prefix/' if '/prefix' in destination else ''
                for path in (artifact, Path(str(artifact) + '.sha256')):
                    key = 's3://bucket/' + prefix + path.name
                    uploaded = objects / hashlib.sha256(key.encode()).hexdigest()
                    self.assertEqual(uploaded.read_bytes(), path.read_bytes())


if __name__ == '__main__':
    unittest.main()
