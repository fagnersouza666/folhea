"""The real shell transport must address the existing container, not Compose."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


class ExternalPgTransportTest(unittest.TestCase):
    def run_transport(self, database='folhea', role='folhea_app', major=16):
        with tempfile.TemporaryDirectory() as scratch:
            base = Path(scratch); tool = base / 'docker'; trace = base / 'calls.jsonl'
            tool.write_text('#!/usr/bin/python3\nimport sys,json,os\na=sys.argv[1:]\nwith open(os.environ["CALLS"],"a") as f:f.write(json.dumps(a)+"\\n")\nif a[0]=="inspect":print("9"*64+"|sha256:"+"2"*64+"|true|healthy")\nelif a[-1]=="--version":print("pg_dump (PostgreSQL) "+os.environ["CLIENT_MAJOR"]+".13")\nelse:print("actual tool reached")\n')
            tool.chmod(0o700)
            env = dict(os.environ, DOCKER_BIN=str(tool), CALLS=str(trace), CLIENT_MAJOR=str(major),
                       OPS_EXTERNAL_POSTGRES_CONTAINER='shared-pg',
                       OPS_EXTERNAL_POSTGRES_CONTAINER_ID='9' * 64,
                       OPS_EXTERNAL_POSTGRES_IMAGE_ID='sha256:' + '2' * 64,
                       DB_NAME=database, DB_USERNAME=role)
            script = 'source "$1"; ops_postgres_exec pg_dump --format=custom --username "$DB_USERNAME" --dbname "$DB_NAME"'
            r = subprocess.run(['bash', '-c', script, 'test', str(ROOT / 'scripts/ops/lib.sh')],
                               env=env, capture_output=True, text=True)
            calls = [json.loads(x) for x in trace.read_text().splitlines()] if trace.exists() else []
            return r, calls

    def test_dump_reaches_exact_external_container_using_compatible_client(self):
        r, calls = self.run_transport()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('actual tool reached', r.stdout)
        self.assertEqual(calls[-1], ['exec', '-i', 'shared-pg', 'pg_dump', '--format=custom',
                                   '--username', 'folhea_app', '--dbname', 'folhea'])
        self.assertFalse(any('compose' in c for c in calls))

    def test_other_db_role_or_pg18_client_is_rejected_before_dump(self):
        for database, role, major in [('acerto', 'folhea_app', 16), ('folhea', 'postgres', 16), ('folhea', 'folhea_app', 18)]:
            with self.subTest(database=database, role=role, major=major):
                r, calls = self.run_transport(database, role, major)
                self.assertNotEqual(r.returncode, 0)
                self.assertFalse(any('--format=custom' in c for c in calls))


if __name__ == '__main__': unittest.main()
