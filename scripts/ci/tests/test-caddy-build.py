#!/usr/bin/env python3
"""Verify the shipped binary, not Dockerfile text or a mutable image tag."""
import argparse
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--image', required=True)
args = parser.parse_args()
assert re.fullmatch(r'sha256:[0-9a-f]{64}', args.image), 'immutable image ID required'

def caddy(*command):
    return subprocess.check_output([
        'docker', 'run', '--rm', '--pull=never', '--network=none',
        '--label', 'ao.session=' + os.environ.get('AO_SESSION_ID', 'manual'),
        '--memory=128m', '--cpus=0.5', args.image, 'caddy', *command,
    ], text=True, timeout=30)

info = caddy('build-info')
assert re.search(r'^go\s+go1\.27\.2$', info, re.M), 'shipped Caddy must embed the corrected Go 1.27.2 toolchain'
root = Path(__file__).resolve().parents[3]
sums = set((root / 'infra/caddy-build/go.sum').read_text().splitlines())
for module, version in [('github.com/caddyserver/caddy/v2', 'v2.11.7'), ('golang.org/x/net', 'v0.61.0')]:
    match = re.search(r'^dep\s+' + re.escape(module) + r'\s+(\S+)\s+(h1:\S+)$', info, re.M)
    assert match and match[1] == version, 'unexpected shipped dependency: ' + module
    assert f'{module} {match[1]} {match[2]}' in sums, 'binary dependency checksum must match the tracked Go lock'
assert caddy('version').split()[0] == 'v2.11.7', 'stable Caddy release metadata missing'
modules = caddy('list-modules', '--packages', '--versions')
lines = [line for line in modules.splitlines() if line and not line.startswith('  ')]
assert lines and all(line.split()[1:] == ['v2.11.7', 'github.com/caddyserver/caddy/v2'] for line in lines), 'non-standard plugin or unversioned Caddy module'
assert re.search(r'^  Standard modules: [1-9][0-9]*$', modules, re.M), 'standard modules missing'
print('ok - immutable Caddy binary: release/toolchain/checksummed dependencies/standard modules')
