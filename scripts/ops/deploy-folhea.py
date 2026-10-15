#!/usr/bin/env python3
"""Explicit local prepare / SSH transfer / remote activate; default is pure plan.

Never manages NPM/DNS, other projects, registry publishing or database rollback.
Production secrets stay in the explicitly selected Folhea root (0600).
"""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
REMOTE_ROOT = None
PROJECT = 'folhea-prod'
HOST = None
SERVER_ADDRESS = None
SERVICES = ('redis', 'keycloak', 'backend', 'caddy')
WRITERS = ('backend', 'keycloak', 'caddy')
IMAGE_VARIABLES = {name: 'FOLHEA_' + name.upper() + '_IMAGE' for name in SERVICES}
COMPOSE_FILES = ('docker-compose.external-pg.yml', 'docker-compose.external-pg.runtime.yml')
FILES = COMPOSE_FILES + (
    'docker-compose.yml',
    'infra/Caddyfile.npm', 'infra/keycloak/render-realm.sh',
    'infra/keycloak/folhea-realm.prod.template.json',
    'scripts/ops/folhea-postgres.py', 'scripts/ops/lib.sh',
    'scripts/ops/backup-postgres.sh', 'scripts/ops/restore-postgres.sh',
    'scripts/ops/verify-recovery.sh', 'scripts/ops/product-metrics.sh',
    'scripts/ops/verify-recovery.sql', 'scripts/ops/verify-recovery-keycloak.sql', 'scripts/ops/product-metrics.sql',
    'scripts/ops/deploy-folhea.py', 'scripts/ops/validate-npm-compose.py',
    'docs/operations.md',
)


class DeployFailure(RuntimeError):
    pass


def require(condition, category):
    if not condition: raise DeployFailure(category)


def sha(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
    return digest.hexdigest()


def configure_target(host, root, project, address):
    """Select an explicit Folhea namespace; never infer another application's target."""
    require(isinstance(host, str) and re.fullmatch(r'[a-z_][a-z0-9_-]*@[A-Za-z0-9][A-Za-z0-9.-]*', host),
            'explicit-safe-ssh-target-required')
    path = PurePosixPath(root or '')
    require(path.is_absolute() and re.fullmatch(r'/[A-Za-z0-9_./-]+', root or '') and
            path.name == 'folhea' and '..' not in path.parts and str(path) == root,
            'exclusive-folhea-root-required')
    require(isinstance(project, str) and re.fullmatch(r'folhea(?:-[a-z0-9]+)*', project),
            'exclusive-folhea-project-required')
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        raise DeployFailure('explicit-server-address-required') from None
    require(not ip.is_unspecified and not ip.is_multicast, 'explicit-server-address-required')
    global HOST, REMOTE_ROOT, PROJECT, SERVER_ADDRESS
    HOST, REMOTE_ROOT, PROJECT, SERVER_ADDRESS = host, root, project, str(ip)


def target_arguments():
    require(all((HOST, REMOTE_ROOT, SERVER_ADDRESS)), 'explicit-reviewed-target-required')
    return ['--host', HOST, '--remote-root', REMOTE_ROOT, '--project-name', PROJECT,
            '--server-address', SERVER_ADDRESS]


def plan(source, host=None, target=None):
    require(re.fullmatch(r'[0-9a-f]{40}', source or '') is not None, 'full-source-sha-required')
    if host is not None or target is not None:
        require(host == HOST and target == REMOTE_ROOT and HOST is not None, 'reviewed-folhea-target-required')
    host, target = HOST or '<ssh-target>', REMOTE_ROOT or '<exclusive-folhea-root>'
    return {'source': source, 'applied': False, 'host': host, 'root': target, 'project': PROJECT,
            'transport': 'docker save (four verified folhea/service:source-SHA tags) | SSH docker load --quiet; no registry/remote Git',
            'phases': ['prepare: local tests, sequential builds, vulnerability scans, checksummed public bundle',
                       'transfer: strict host key, own release only; no start',
                       'activate: own lock, private env, exact NPM peer, candidate validation, health, atomic current'],
            'prerequisites': ['new install versus data migration decided; migration is not automatic',
                              'normal NPM Proxy Host folhea.app -> folhea-caddy:80 with valid SSL/Force SSL',
                              'public DNS resolves only to the explicitly reviewed server address; no divergent AAAA',
                              'exclusive private production.env; own subnet, disk/RAM headroom checked',
                              'existing PG16.13 identity/network revalidated; only dedicated Folhea DBs/roles provisioned',
                              'upgrade backup and schema compatibility approved separately'],
            'rollback': 'own images/config only if previous image IDs and Flyway history are identical; never downgrade DB',
            'commands': [f'python3 -B scripts/ops/deploy-folhea.py --prepare --source {source} --output /private/folhea-release',
                         f'python3 -B scripts/ops/deploy-folhea.py --transfer --source {source} --bundle /private/folhea-release/release',
                         f'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes {host} python3 -B {target}/releases/{source}/scripts/ops/deploy-folhea.py --activate --source {source} --installation fresh <explicit-target-arguments>']}


def safe_environment(extra=None):
    # Compose environment has precedence over its env-file. Do not inherit
    # unrelated credentials/settings from an operator shell or another app.
    env = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG', 'LC_ALL', 'JAVA_HOME', 'TRIVY_CACHE_DIR') if key in os.environ}
    if extra: env.update(extra)
    return env


def run(command, *, cwd=None, env=None, input=None, timeout=60):
    try:
        result = subprocess.run(command, cwd=cwd, env=env or safe_environment(), input=input,
                                capture_output=True, check=True, timeout=timeout)
        return result.stdout
    except (OSError, subprocess.SubprocessError):
        # Never echo commands' stderr/config/logs; they can contain secrets.
        raise DeployFailure('command-failed-' + Path(command[0]).name) from None


def transport_tags(source, images):
    plan(source)
    require(set(images) == set(SERVICES), 'all-four-own-images-required')
    for image in images.values():
        require(re.fullmatch(r'sha256:[0-9a-f]{64}', image or '') is not None, 'immutable-image-id-required')
    return {service: 'folhea/' + service + ':' + source for service in SERVICES}


def verify_files(base, manifest):
    require(re.fullmatch(r'[0-9a-f]{40}', manifest.get('source', '')) is not None, 'manifest-source-invalid')
    require(isinstance(manifest.get('files'), dict) and manifest['files'], 'manifest-files-required')
    for name, digest in manifest['files'].items():
        path = PurePosixPath(name)
        require(name in FILES and not path.is_absolute() and '..' not in path.parts, 'bundle-path-forbidden')
        candidate = base / name
        require(not any((base / Path(*path.parts[:i])).is_symlink() for i in range(1, len(path.parts) + 1)),
                'bundle-symlink-forbidden')
        require(candidate.is_file() and sha(candidate) == digest, 'bundle-checksum-mismatch')


def read_manifest(base, source):
    require(base.is_dir() and not base.is_symlink(), 'release-directory-required')
    manifest_path = base / 'manifest.json'
    require(not manifest_path.is_symlink(), 'manifest-symlink-forbidden')
    manifest = json.loads(manifest_path.read_text())
    require(manifest['source'] == source and set(manifest['files']) == set(FILES), 'release-source-or-files-mismatch')
    require(set(manifest['images']) == set(SERVICES), 'all-four-images-required')
    for image in manifest['images'].values():
        require(re.fullmatch(r'sha256:[0-9a-f]{64}', image) is not None, 'immutable-image-id-required')
    verify_files(base, manifest)
    actual = {str(p.relative_to(base)) for p in base.rglob('*') if p.is_file() or p.is_symlink()}
    require(actual == set(FILES) | {'manifest.json'}, 'unexpected-release-file')
    return manifest


@contextmanager
def own_lock(base):
    base.mkdir(parents=True, mode=0o700, exist_ok=True)
    lock_path = base / '.folhea-deploy.lock'
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try: fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise DeployFailure('own-deploy-lock-busy') from None
        yield
    finally: os.close(descriptor)


def write_json_atomic(path, value):
    descriptor, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream, sort_keys=True); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def promote(base, source):
    require(re.fullmatch(r'[0-9a-f]{40}', source) is not None and (base / 'releases' / source).is_dir(),
            'verified-candidate-required')
    temporary = base / 'current.next'
    temporary.symlink_to('releases/' + source)
    os.replace(temporary, base / 'current')


def rollback_allowed(images, before, after):
    return bool(images and set(images) == set(SERVICES) and before is not None and after is not None and before == after)


def copy_public_file(source, destination):
    require(source.is_file() and not source.is_symlink(), 'public-source-file-required')
    destination.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    shutil.copyfile(source, destination)
    # Public bind files are readable by runtime UIDs; secrets are excluded.
    destination.chmod(0o644)


def prepare(args):
    require(args.output, 'private-output-required')
    output = Path(args.output).resolve()
    require(not output.exists() and ROOT not in output.parents and output != ROOT, 'new-output-outside-git-required')
    require(run(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip() == args.source, 'checkout-source-mismatch')
    require(not run(['git', 'status', '--porcelain'], cwd=ROOT).strip(), 'clean-source-required')
    output.mkdir(parents=True, mode=0o700)
    with own_lock(output.parent):
        # No skip-tests path. This is future execution, not a claim that the
        # current local preparation repeated previously passing product gates.
        env = safe_environment({'CI': 'true', 'NODE_OPTIONS': '--max-old-space-size=1024',
                                'NG_BUILD_MAX_WORKERS': '1', 'AO_SESSION_ID': 'folhea-4', 'MAVEN_OPTS': '-Xmx1024m -XX:ActiveProcessorCount=4'})
        # Test a local equivalent of the existing server; never ship/manage PG.
        env['QUARKUS_DATASOURCE_DEVSERVICES_IMAGE_NAME'] = 'postgres:16.13-alpine@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416'
        run(['./mvnw', '-B', 'clean', 'verify'], cwd=ROOT / 'backend', env=env, timeout=1800)
        run(['npm', 'ci', '--ignore-scripts'], cwd=ROOT / 'frontend', env=env, timeout=600)
        for script in ('lint', 'typecheck', 'test:coverage', 'build:ssg', 'validate:ssg', 'e2e:critical'):
            run(['npm', 'run', script], cwd=ROOT / 'frontend', env=env, timeout=900)
        run(['npm', 'audit', '--audit-level=low'], cwd=ROOT / 'frontend', env=env, timeout=300)
        for gate in ('validate-api-contract.mjs', 'validate-oidc-surface.mjs', 'validate-seo.mjs'):
            command = ['node', 'scripts/ci/' + gate]
            if gate == 'validate-seo.mjs': command.append('frontend/dist')
            run(command, cwd=ROOT, env=env, timeout=60)
        run(['python3', '-B', '-m', 'unittest', 'discover', '-s', 'scripts/ops/tests', '-p', 'test_*.py'], cwd=ROOT, timeout=120)
        images = {}
        for service in ('backend', 'caddy', 'keycloak'):
            tag = f'folhea/{service}:{args.source}'
            run(['docker', 'build', '--file', 'infra/Dockerfile', '--target', service + '-runtime',
                 '--label', 'org.opencontainers.image.revision=' + args.source, '--tag', tag, '.'], cwd=ROOT, timeout=1800)
            images[service] = run(['docker', 'image', 'inspect', '--format', '{{.Id}}', tag]).decode().strip()
        # Pin substrate versions from tracked Compose, not tags from another app.
        config_text = (ROOT / 'docker-compose.yml').read_text()
        for service in ('redis',):
            image = re.search(r'\n  ' + service + r':\n    image: ([^\n]+)', config_text).group(1)
            run(['docker', 'pull', image], timeout=300)
            images[service] = run(['docker', 'image', 'inspect', '--format', '{{.Id}}', image]).decode().strip()
        for service, tag in transport_tags(args.source, images).items():
            run(['docker', 'tag', images[service], tag])
        run(['python3', '-B', 'scripts/ci/tests/test-caddy-build.py', '--image', images['caddy']], cwd=ROOT, env=env)
        caddy_env = env | {'CADDY_TEST_IMAGE': images['caddy']}
        for gate in ('test-api-body-limits.mjs', 'test-caddy-startup.mjs', 'test-npm-proxy.mjs'):
            run(['node', 'scripts/ci/tests/' + gate], cwd=ROOT, env=caddy_env, timeout=300)
        for image in images.values():
            run(['trivy', 'image', '--quiet', '--scanners', 'vuln', '--severity', 'HIGH,CRITICAL',
                 '--exit-code', '1', image], timeout=900)
        run(['trivy', 'fs', '--quiet', '--scanners', 'vuln,misconfig,secret', '--severity', 'HIGH,CRITICAL',
             '--exit-code', '1', str(ROOT)], timeout=900)
        require(run(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip() == args.source and
                not run(['git', 'status', '--porcelain'], cwd=ROOT).strip(), 'source-changed-during-prepare')
        release = output / 'release'; release.mkdir(mode=0o700)
        for name in FILES:
            copy_public_file(ROOT / name, release / name)
        manifest = {'source': args.source, 'images': images, 'image_metadata': image_metadata(images), 'files': {name: sha(release / name) for name in FILES},
                    'keycloak_base': re.search(r'FROM (quay.io/keycloak/keycloak:[^ ]+) AS keycloak-runtime',
                                               (ROOT / 'infra/Dockerfile').read_text()).group(1)}
        write_json_atomic(release / 'manifest.json', manifest)
        read_manifest(release, args.source)
    print('prepare: verified public bundle; four images/scans; no remote changes')


def ssh(command):
    target_arguments()
    return ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', HOST,
            shlex.join(command)]


def transfer(args):
    require(args.bundle, 'bundle-required')
    bundle = Path(args.bundle).absolute(); manifest = read_manifest(bundle, args.source)
    tags = transport_tags(args.source, manifest['images'])
    for service, tag in tags.items():
        require(run(['docker', 'image', 'inspect', '--format', '{{.Id}}', tag]).decode().strip() == manifest['images'][service],
                'local-source-tag-changed')
    destination = REMOTE_ROOT + '/releases/' + args.source
    # Never overwrite a release, active config, secret, volume or another app.
    preflight = ('import os,pathlib,shutil; p=pathlib.Path(' + repr(REMOTE_ROOT) + '); '
                 'assert shutil.disk_usage(p.parent).free >= 8*1024**3; '
                 'assert not p.is_symlink(); p.mkdir(mode=0o700,exist_ok=True); '
                 'assert p.stat().st_uid == os.getuid() and p.stat().st_mode & 0o777 == 0o700; '
                 'r=p/"releases"; assert not r.is_symlink(); r.mkdir(mode=0o700,exist_ok=True); '
                 '(r/' + repr(args.source) + ').mkdir(mode=0o700)')
    run(ssh(['python3', '-B', '-c', preflight]))
    entries = sorted({PurePosixPath(name).parts[0] for name in FILES} | {'manifest.json'})
    run(['scp', '-q', '-r', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
         *[str(bundle / entry) for entry in entries], HOST + ':' + destination], timeout=120)
    if args.reuse_transferred_from:
        plan(args.reuse_transferred_from)
        run(ssh(['python3', '-B', destination + '/scripts/ops/deploy-folhea.py', '--receive-images',
                 '--source', args.source, '--reuse-transferred-from', args.reuse_transferred_from,
                 *target_arguments()]), timeout=600)
        print('transfer: public candidate and exact previously loaded configs verified; no duplicate load/start')
        return
    sender = subprocess.Popen(['docker', 'save', *tags.values()], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=safe_environment())
    receiver = None
    try:
        receiver = subprocess.Popen(ssh(['python3', '-B', destination + '/scripts/ops/deploy-folhea.py',
                                        '--receive-images', '--source', args.source, *target_arguments()]), stdin=sender.stdout,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=safe_environment())
        sender.stdout.close()
        require(receiver.wait(timeout=900) == 0 and sender.wait(timeout=30) == 0, 'image-transfer-failed')
    except (OSError, subprocess.SubprocessError):
        raise DeployFailure('image-transfer-failed') from None
    finally:
        if sender.poll() is None: sender.terminate(); sender.wait()
        if receiver and receiver.poll() is None: receiver.terminate(); receiver.wait()
    print('transfer: candidate/images received; no containers started; activation still required')



def verify_archive_config(stream, expected, reference):
    # Docker 29 containerd can expose a manifest digest as .Id. Verify the
    # exact exported config blob (includes all rootfs diff IDs), not a tag.
    matched = {}; manifest = None
    with tarfile.open(fileobj=stream, mode='r|') as archive:
        for entry in archive:
            if not entry.isfile() or entry.size > 1024 * 1024: continue
            body = archive.extractfile(entry).read()
            if entry.name == 'manifest.json': manifest = json.loads(body)
            if 'sha256:' + hashlib.sha256(body).hexdigest() == expected:
                matched[entry.name] = body
    require(isinstance(manifest, list) and len(manifest) == 1 and
            manifest[0].get('RepoTags') == [reference] and manifest[0].get('Config') in matched,
            'exported-image-config-or-reference-mismatch')
    config = json.loads(matched[manifest[0]['Config']])
    require(config.get('rootfs', {}).get('type') == 'layers', 'exported-image-rootfs-required')
    return config


def image_metadata(images):
    result = {}
    for service, image in images.items():
        value = json.loads(run(['docker', 'image', 'inspect', '--format',
                               '{"os":{{json .Os}},"architecture":{{json .Architecture}},"rootfs":{{json .RootFS}}}', image]))
        require(value['os'] == 'linux' and value['architecture'] == 'amd64' and
                value['rootfs']['Type'] == 'layers' and value['rootfs']['Layers'], 'reviewed-image-platform-rootfs-required')
        result[service] = value
    return result


def validate_image_metadata(actual, expected):
    require(actual == expected and expected.get('os') == 'linux' and expected.get('architecture') == 'amd64' and
            expected.get('rootfs', {}).get('Type') == 'layers' and expected['rootfs'].get('Layers'),
            'loaded-image-platform-or-complete-rootfs-mismatch')


def verified_runtime_images(source, images, metadata):
    require(set(metadata) == set(SERVICES), 'all-four-image-metadata-required')
    result = {}
    for service, reference in transport_tags(source, images).items():
        actual = run(['docker', 'image', 'inspect', '--format', '{{.Id}}', reference]).decode().strip()
        require(re.fullmatch('sha256:[0-9a-f]{64}', actual) is not None, 'loaded-runtime-digest-required')
        actual_meta = image_metadata({service: actual})[service]
        validate_image_metadata(actual_meta, metadata[service])
        if actual != images[service]:
            proc = subprocess.Popen(['docker', 'save', reference], stdout=subprocess.PIPE,
                                    stderr=subprocess.DEVNULL, env=safe_environment())
            try:
                config = verify_archive_config(proc.stdout, images[service], reference)
                require(config.get('os') == actual_meta['os'] and config.get('architecture') == actual_meta['architecture'] and
                        config['rootfs']['type'] == actual_meta['rootfs']['Type'] and
                        config['rootfs']['diff_ids'] == actual_meta['rootfs']['Layers'], 'exported-config-platform-or-rootfs-mismatch')
                require(proc.wait(timeout=120) == 0, 'exported-image-verification-failed')
            finally:
                proc.stdout.close()
                if proc.poll() is None: proc.terminate(); proc.wait()
        require(run(['docker', 'image', 'inspect', '--format', '{{.Id}}', reference]).decode().strip() == actual,
                'source-reference-changed-during-verification')
        result[service] = actual
    return result


def runtime_images(base, source, manifest):
    path = base / 'receipts' / (source + '.images.json')
    require(path.is_file() and not path.is_symlink() and path.stat().st_uid == os.getuid() and
            path.stat().st_mode & 0o777 == 0o600, 'verified-runtime-identity-receipt-required')
    proof = json.loads(path.read_text())
    require(set(manifest.get('image_metadata', {})) == set(SERVICES) and
            proof['image_metadata'] == manifest['image_metadata'], 'verified-source-image-metadata-required')
    require(proof['source'] == source and proof['config_images'] == manifest['images'] and
            set(proof['runtime_images']) == set(SERVICES), 'runtime-identity-source-mismatch')
    for image in proof['runtime_images'].values():
        require(re.fullmatch('sha256:[0-9a-f]{64}', image) is not None and
                run(['docker', 'image', 'inspect', '--format', '{{.Id}}', image]).decode().strip() == image,
                'verified-runtime-image-missing')
    for service, actual in image_metadata(proof['runtime_images']).items():
        validate_image_metadata(actual, manifest['image_metadata'][service])
    return proof['runtime_images']


def required_memory(model):
    require(set(model['services']) == set(SERVICES), 'four-own-service-memory-model-required')
    values = []
    for service in model['services'].values():
        value = service.get('mem_limit')
        require(type(value) is int or isinstance(value, str) and re.fullmatch('[1-9][0-9]*', value),
                'finite-effective-memory-quota-required')
        value = int(value); require(value > 0, 'finite-effective-memory-quota-required')
        values.append(value)
    return sum(values) + 512 * 1024 ** 2


def validate_resources(model, available, disk_free):
    require(available >= required_memory(model) and disk_free >= 8 * 1024 ** 3,
            'shared-host-headroom-insufficient')


def receive_images(args):
    base = Path(REMOTE_ROOT); candidate = base / 'releases' / args.source
    require(ROOT == candidate and not base.is_symlink() and base.stat().st_uid == os.getuid() and
            base.stat().st_mode & 0o777 == 0o700, 'private-remote-candidate-required')
    manifest = read_manifest(candidate, args.source)
    with own_lock(base):
        # Snapshot actual running image IDs BEFORE docker load, never mutable
        # tags. Only this Compose project, no environments/users/other apps.
        containers = run(['docker', 'ps', '--all', '--quiet', '--filter',
                          'label=com.docker.compose.project=' + PROJECT]).decode().split()
        live = []
        for container in containers:
            info = json.loads(run(['docker', 'inspect', '--format',
                '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}', container]))
            require(info['service'] in SERVICES, 'unexpected-own-project-service')
            live.append(info)
        receipts = base / 'receipts'
        require(not receipts.is_symlink(), 'receipts-symlink-forbidden')
        receipts.mkdir(mode=0o700, exist_ok=True)
        write_json_atomic(receipts / (args.source + '.json'), {'source': args.source, 'before_load': live})
        # stdin is the docker save stream from SSH, not an env/config stream.
        if args.reuse_transferred_from:
            plan(args.reuse_transferred_from)
            previous = read_manifest(base / 'releases' / args.reuse_transferred_from, args.reuse_transferred_from)
            require(previous['images'] == manifest['images'], 'reused-image-configs-changed')
            actual = verified_runtime_images(args.reuse_transferred_from, manifest['images'], manifest['image_metadata'])
            for service, tag in transport_tags(args.source, manifest['images']).items():
                run(['docker', 'tag', actual[service], tag])
        else:
            run(['docker', 'load', '--quiet'], timeout=900)
            actual = verified_runtime_images(args.source, manifest['images'], manifest['image_metadata'])
        write_json_atomic(receipts / (args.source + '.images.json'),
                          {'source': args.source, 'config_images': manifest['images'], 'runtime_images': actual, 'image_metadata': manifest['image_metadata']})


def load_guard(candidate):
    spec = importlib.util.spec_from_file_location('folhea_npm_guard', candidate / 'scripts/ops/validate-npm-compose.py')
    guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)
    return guard


def compose(candidate, env_file, images, *arguments):
    env = safe_environment({IMAGE_VARIABLES[k]: v for k, v in images.items()})
    env.update(COMPOSE_PROJECT_NAME=PROJECT, AO_SESSION_ID='folhea-4')
    cmd = ['docker', 'compose', '--project-name', PROJECT, '--env-file', str(env_file)]
    for name in COMPOSE_FILES: cmd += ['-f', str(candidate / name)]
    return run(cmd + list(arguments), env=env, timeout=420)


def inspected_peer(model):
    name = model['services']['caddy']['environment']['NPM_PROXY_CONTAINER']
    value = json.loads(run(['docker', 'inspect', '--format',
                           '{"id":{{json .Id}},"running":{{json .State.Running}},"networks":{{json .NetworkSettings.Networks}}}', name]))
    return value


def inspected_database(model):
    meta = model['x-folhea-external-postgres']
    return json.loads(run(['docker', 'inspect', '--format',
                          '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"health":{{json .State.Health.Status}},"networks":{{json .NetworkSettings.Networks}}}', meta['container']]))


def database_module(candidate, model):
    spec = importlib.util.spec_from_file_location('folhea_database', candidate / 'scripts/ops/folhea-postgres.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    meta = model['x-folhea-external-postgres']
    if hasattr(module, 'configure'):
        module.configure(meta['container'], meta['network'],
                         proxy_network=model['networks']['npm-proxy']['name'],
                         secret_file=Path(REMOTE_ROOT) / 'secrets/database-credentials.json')
    else:
        # Recovery of an earlier release is allowed only at its exact reviewed
        # endpoint. Never substitute another shared container into old code.
        require(module.CONTAINER == meta['container'] and module.NETWORK == meta['network'],
                'previous-database-endpoint-incompatible')
    return module


def external_preflight(candidate, model):
    load_guard(candidate).validate_external_peer(model, inspected_database(model))
    database = database_module(candidate, model)
    status = database.inspect_catalog()
    require(status['version'] == model['x-folhea-external-postgres']['version'], 'shared-pg-version-changed')
    require(status['max_connections'] - status['connections'] >= 28, 'shared-pg-connection-headroom-insufficient')
    require(database.classify(status) == 'ready', 'own-databases-not-provisioned')


def history(candidate, env_file, images):
    # Read only the two dedicated Folhea histories using their own roles.
    model = json.loads(compose(candidate, env_file, images, 'config', '--format', 'json'))
    external_preflight(candidate, model)
    database = database_module(candidate, model)
    return {key: database.history(name) for key, name in [('app', 'folhea'), ('idp', 'folhea_keycloak')]}


def snapshot(candidate, env_file, images):
    ids = {}
    for service in SERVICES:
        container = compose(candidate, env_file, images, 'ps', '--all', '--quiet', service).decode().strip()
        require(re.fullmatch(r'[0-9a-f]{64}', container or '') is not None, 'one-existing-container-required-' + service)
        info = json.loads(run(['docker', 'inspect', '--format',
                               '{"image":{{json .Image}},"running":{{json .State.Running}},"health":{{json .State.Health.Status}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}', container]))
        require(info.get('project') == PROJECT and info.get('service') == service,
                'previous-container-ownership-mismatch')
        require(info['running'] and info['health'] == 'healthy', 'previous-service-not-healthy-' + service)
        ids[service] = info['image']
    return ids


def check_subnet(model):
    edge = ipaddress.ip_network(model['networks']['edge']['ipam']['config'][0]['subnet'])
    ids = run(['docker', 'network', 'ls', '--quiet']).decode().split()
    for item in json.loads(run(['docker', 'network', 'inspect', *ids])) if ids else []:
        if item.get('Labels', {}).get('com.docker.compose.project') == PROJECT: continue
        for entry in item['IPAM'].get('Config') or []:
            if entry.get('Subnet'):
                other = ipaddress.ip_network(entry['Subnet'])
                require(edge.version != other.version or not edge.overlaps(other), 'own-edge-subnet-collision')


def public_preflight():
    # DNS and public certificate must be ready BEFORE starting Folhea.
    addresses = {item[4][0] for item in socket.getaddrinfo('folhea.app', 443, type=socket.SOCK_STREAM)}
    require(SERVER_ADDRESS is not None and addresses == {SERVER_ADDRESS}, 'public-dns-not-reviewed-server')
    with socket.create_connection(('folhea.app', 443), timeout=15) as connection:
        with ssl.create_default_context().wrap_socket(connection, server_hostname='folhea.app'): pass


def public_health():
    # No cookies/login; redirects are rejected instead of following a loop.
    public_preflight()
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args): return None
    opener = urllib.request.build_opener(NoRedirect)
    for path, expected in [('/', 200), ('/api/v1/me', 401), ('/admin', 404), ('/q/health/ready', 404)]:
        try: response = opener.open('https://folhea.app' + path, timeout=15)
        except urllib.error.HTTPError as error: response = error
        with response: require(response.code == expected, 'external-status-not-ready')


def available_memory():
    return next(int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines()
                if line.startswith('MemAvailable:'))


def private_json(path):
    require(path.is_file() and not path.is_symlink() and path.stat().st_uid == os.getuid() and
            path.stat().st_mode & 0o777 == 0o600, 'private-owned-metadata-required')
    value = json.loads(path.read_text())
    require(isinstance(value, dict), 'metadata-object-required')
    return value


def history_digests(value):
    require(isinstance(value, dict) and set(value) == {'app', 'idp'} and
            all(isinstance(item, str) and item for item in value.values()), 'both-schema-histories-required')
    return {key: hashlib.sha256(item.encode()).hexdigest() for key, item in value.items()}


def private_dump(path, base):
    require(isinstance(path, (str, Path)), 'private-own-backup-file-required')
    path = Path(path)
    require(path.is_absolute() and path.resolve() == path and path.is_relative_to(base / 'backups') and
            path.is_file() and not path.is_symlink() and path.stat().st_uid == os.getuid() and
            path.stat().st_mode & 0o777 == 0o600, 'private-own-backup-file-required')
    for parent in path.parents:
        require(parent.stat().st_uid == os.getuid() and parent.stat().st_mode & 0o777 == 0o700,
                'private-own-backup-directory-required')
        if parent == base: break
    with path.open('rb') as stream: require(stream.read(5) == b'PGDMP', 'custom-format-backup-required')
    return path


def verify_backup_evidence(name, base, source, previous, before, env_hash):
    require(name, 'bound-backup-evidence-required')
    path = Path(name)
    require(path.is_absolute() and path.resolve() == path and path.is_relative_to(base),
            'private-own-backup-evidence-required')
    proof = private_json(path)
    require(proof.get('version') == 1 and proof.get('candidate') == source and proof.get('previous') == previous and
            proof.get('target') == state_target() and proof.get('env_sha256') == env_hash and
            proof.get('history_sha256') == history_digests(before) and proof.get('schema_compatible_reviewed') is True,
            'backup-review-source-schema-or-target-mismatch')
    dumps = proof.get('dumps', {})
    require(isinstance(dumps, dict) and set(dumps) == {'app', 'idp'} and
            all(isinstance(item, dict) for item in dumps.values()), 'both-own-database-backups-required')
    for key, database, role in [('app', 'folhea', 'folhea_app'), ('idp', 'folhea_keycloak', 'folhea_keycloak')]:
        item = dumps[key]
        require(item.get('database') == database and item.get('role') == role and item.get('client_major') == 16,
                'dedicated-db-and-compatible-backup-client-required')
        require(sha(private_dump(item['path'], base)) == item.get('sha256'), 'backup-checksum-mismatch')
    return {'receipt_sha256': sha(path), 'history_sha256': proof['history_sha256'],
            'dump_sha256': {key: item['sha256'] for key, item in dumps.items()}}


def record_backup_review(args):
    """Record an operator's explicit review, after validating existing OWN dumps.

    This does not create a backup, prove cross-database consistency, restore data,
    or decide whether application/schema changes are backwards compatible.
    """
    base, candidate, env_file = activation_paths(args.source)
    require(args.schema_compatible_reviewed and args.expected_current and args.backup_evidence and
            args.app_backup and args.idp_backup,
            'explicit-backup-schema-review-required')
    with own_lock(base):
        require(not pending_recovery(base) and current_is(base, args.expected_current), 'previous-release-or-recovery-changed')
        manifest = read_manifest(candidate, args.source)
        images = runtime_images(base, args.source, manifest)
        model = json.loads(compose(candidate, env_file, images, 'config', '--format', 'json'))
        guard = load_guard(candidate); guard.validate_model(model); guard.validate_peer(model, inspected_peer(model))
        external_preflight(candidate, model)
        previous = base / 'releases' / args.expected_current
        old = read_manifest(previous, previous.name); old_images = runtime_images(base, previous.name, old)
        require(snapshot(previous, env_file, old_images) == old_images, 'previous-images-differ-from-attestation')
        before = history(previous, env_file, old_images)
        container = model['x-folhea-external-postgres']['container']
        version = run(['docker', 'exec', container, 'pg_restore', '--version']).decode()
        require(re.fullmatch(r'pg_restore \(PostgreSQL\) 16\.[^\r\n]+\n?', version), 'postgres16-backup-client-required')
        proof = {'version': 1, 'candidate': args.source, 'previous': previous.name, 'target': state_target(),
                 'env_sha256': sha(env_file), 'history_sha256': history_digests(before),
                 'schema_compatible_reviewed': True, 'dumps': {}}
        for key, database, role, name in [('app', 'folhea', 'folhea_app', args.app_backup),
                                         ('idp', 'folhea_keycloak', 'folhea_keycloak', args.idp_backup)]:
            path = private_dump(name, base)
            try:
                with path.open('rb') as stream:
                    listing = subprocess.run(['docker', 'exec', '-i', container, 'pg_restore', '--list'],
                                             stdin=stream, capture_output=True, check=True,
                                             env=safe_environment(), timeout=60).stdout.decode()
            except (OSError, subprocess.SubprocessError, UnicodeError):
                raise DeployFailure('backup-archive-validation-failed') from None
            require(re.search(r'^;\s+dbname:\s+' + database + r'\s*$', listing, re.M) and
                    re.search(r'Dumped by pg_dump version:\s+16\.', listing), 'backup-database-or-client-mismatch')
            proof['dumps'][key] = {'database': database, 'role': role, 'client_major': 16,
                                    'path': str(path), 'sha256': sha(path)}
        output = Path(args.backup_evidence)
        require(output.is_absolute() and output.resolve() == output and output.is_relative_to(base) and
                not output.exists() and not output.is_symlink(), 'new-private-backup-evidence-path-required')
        write_json_atomic(output, proof)
        verify_backup_evidence(str(output), base, args.source, previous.name, before, sha(env_file))
    print('backup-review: two private OWN dumps/checksums and histories bound to previous/candidate; operator review recorded')


TERMINAL_PHASES = {'healthy-promoted', 'previous-restored'}


def pending_recovery(base):
    path = base / 'deployment-state.json'
    return path.exists() and private_json(path).get('phase') not in TERMINAL_PHASES


@contextmanager
def interruption_handlers(*, restoring=False):
    # Catchable signals trigger rollback. SIGKILL/power loss instead leave the
    # durable journal for an explicit, revalidated recovery on the next run.
    signals = (signal.SIGHUP, signal.SIGTERM, signal.SIGINT)
    previous = {number: signal.getsignal(number) for number in signals}
    def interrupted(number, frame):
        if not restoring: raise DeployFailure('activation-interrupted')
    try:
        for number in signals: signal.signal(number, interrupted)
        yield
    finally:
        for number, handler in previous.items(): signal.signal(number, handler)


def current_is(base, source):
    current = base / 'current'
    return current.is_symlink() and current.resolve() == base / 'releases' / source


def state_target():
    target_arguments()
    return {'host': HOST, 'root': REMOTE_ROOT, 'project': PROJECT, 'address': SERVER_ADDRESS}


def restore_previous(base, candidate, env_file, images, state):
    """Restore OWN writers only; never restore or downgrade either database."""
    previous = base / 'releases' / state['previous']
    require(re.fullmatch(r'[0-9a-f]{40}', state['previous']) and previous.parent == base / 'releases',
            'recovery-previous-source-invalid')
    require(state['target'] == state_target() and sha(env_file) == state['env_sha256'],
            'recovery-target-or-env-changed')
    require(current_is(base, state['previous']) or current_is(base, state['source']), 'recovery-current-changed')
    old_manifest = read_manifest(previous, previous.name)
    old_images = runtime_images(base, previous.name, old_manifest)
    require(old_images == state['running_images'], 'recovery-previous-images-changed')
    model = json.loads(compose(previous, env_file, old_images, 'config', '--format', 'json'))
    guard = load_guard(previous)
    guard.validate_model(model); guard.validate_peer(model, inspected_peer(model))
    external_preflight(previous, model)
    if state['candidate_attempted']:
        after = history(candidate, env_file, images)
        require(rollback_allowed(old_images, state['flyway_before'], after), 'schema-changed-no-db-downgrade')
    state['phase'] = 'restoring-previous'; write_json_atomic(base / 'deployment-state.json', state)
    compose(previous, env_file, old_images, 'up', '-d', '--no-build', '--pull', 'never', '--wait',
            '--wait-timeout', '300', '--no-deps', *WRITERS)
    require(snapshot(previous, env_file, old_images) == old_images, 'rollback-images-not-restored')
    public_health()
    if not current_is(base, previous.name): promote(base, previous.name)
    state['phase'] = 'previous-restored'; write_json_atomic(base / 'deployment-state.json', state)


def recover_activation(args):
    base, candidate, env_file = activation_paths(args.source)
    with own_lock(base), interruption_handlers(restoring=True):
        state = private_json(base / 'deployment-state.json')
        require(state.get('source') == args.source and state.get('previous') == args.expected_current and
                state.get('target') == state_target(), 'recovery-source-or-target-mismatch')
        require(state.get('previous') and state.get('phase') not in TERMINAL_PHASES,
                'pending-upgrade-recovery-required')
        manifest = read_manifest(candidate, args.source)
        images = runtime_images(base, args.source, manifest)
        verify_backup_evidence(state['backup_evidence'], base, args.source, state['previous'],
                               state['flyway_before'], state['env_sha256'])
        restore_previous(base, candidate, env_file, images, state)
    print('recover: exact previous OWN writers healthy; current restored; no database rollback')


def activation_paths(source):
    target_arguments()
    base = Path(REMOTE_ROOT); candidate = base / 'releases' / source
    require(ROOT == candidate, 'run-exact-remote-candidate-required')
    env_file = base / 'production.env'
    require(env_file.is_file() and not env_file.is_symlink() and env_file.stat().st_mode & 0o777 == 0o600 and
            env_file.stat().st_uid == os.getuid(), 'private-owned-env-required')
    require(not base.is_symlink() and base.stat().st_uid == os.getuid() and
            base.stat().st_mode & 0o777 == 0o700, 'private-owned-deploy-root-required')
    return base, candidate, env_file


def activate(args):
    base, candidate, env_file = activation_paths(args.source)
    require(args.installation in ('fresh', 'upgrade'), 'explicit-installation-mode-required')
    with own_lock(base):
        require(not pending_recovery(base), 'pending-recovery-requires-explicit-recover')
        public_preflight()
        manifest = read_manifest(candidate, args.source)
        images = runtime_images(base, args.source, manifest)
        model = json.loads(compose(candidate, env_file, images, 'config', '--format', 'json'))
        guard = load_guard(candidate)
        guard.validate_model(model); guard.validate_peer(model, inspected_peer(model))
        required_memory(model)  # Validate every finite quota BEFORE changing any resource.
        require(shutil.disk_usage(base).free >= 8 * 1024 ** 3, 'shared-host-headroom-insufficient')
        external_preflight(candidate, model)
        require(all(not service.get('build') for service in model['services'].values()), 'remote-build-forbidden')
        check_subnet(model)
        current = base / 'current'
        previous = None; previous_images = None; before = None; review = None
        if args.installation == 'fresh':
            require(not current.exists() and not current.is_symlink(), 'fresh-has-existing-release')
            for object_type in ('container', 'volume', 'network'):
                command = ['docker', object_type, 'ls', '--quiet']
                if object_type == 'container': command.append('--all')
                require(not run(command + ['--filter', 'label=com.docker.compose.project=' + PROJECT]).strip(),
                        'fresh-has-existing-own-resources')
            validate_resources(model, available_memory(), shutil.disk_usage(base).free)
        else:
            require(args.schema_compatible_reviewed and args.expected_current, 'upgrade-review-and-expected-current-required')
            require(current_is(base, args.expected_current), 'previous-release-changed')
            previous = base / 'releases' / args.expected_current
            old_manifest = read_manifest(previous, previous.name)
            require(old_manifest['keycloak_base'] == manifest['keycloak_base'], 'idp-version-upgrade-needs-separate-plan')
            old_runtime = runtime_images(base, previous.name, old_manifest)
            previous_images = snapshot(previous, env_file, old_runtime)
            require(previous_images == old_runtime, 'previous-images-differ-from-attestation')
            require(images['redis'] == previous_images['redis'], 'substrate-upgrade-needs-separate-plan')
            before = history(previous, env_file, previous_images)
            review = verify_backup_evidence(args.backup_evidence, base, args.source, previous.name, before, sha(env_file))
        env_hash = sha(env_file)
        # Candidate validation is bounded and finishes before writers stop.
        edge_env = model['services']['caddy']['environment']
        run(['docker', 'run', '--rm', '--pull=never', '--network=none', '--memory=128m', '--cpus=0.5',
             '--label', 'ao.session=folhea-4', '--mount', f'type=bind,source={candidate / "infra/Caddyfile.npm"},target=/etc/caddy/Caddyfile,readonly',
             '--env', 'PUBLIC_DOMAIN=folhea.app', '--env', 'NPM_PROXY_IP=' + edge_env['NPM_PROXY_IP'],
             '--env', 'STATIC_ROOT=/srv', '--env', 'OIDC_PUBLIC_ORIGIN=https://folhea.app',
             images['caddy'], 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
        guard.validate_peer(model, inspected_peer(model)); external_preflight(candidate, model)
        require(sha(env_file) == env_hash, 'env-changed-before-activation')
        if previous: require(current_is(base, previous.name), 'previous-release-changed')
        state = {'source': args.source, 'previous': previous.name if previous else None,
                 'target': state_target(), 'running_images': previous_images, 'flyway_before': before,
                 'env_sha256': env_hash, 'candidate_attempted': False,
                 'backup_evidence': args.backup_evidence if previous else None, 'backup_review': review,
                 'phase': 'stopping-previous' if previous else 'starting-candidate'}
        # Journal is fsynced BEFORE the first possibly partial stop/start.
        write_json_atomic(base / 'deployment-state.json', state)
        with interruption_handlers():
            try:
                if previous:
                    compose(previous, env_file, previous_images, 'stop', *WRITERS)
                    state['phase'] = 'previous-stopped'; write_json_atomic(base / 'deployment-state.json', state)
                    validate_resources(model, available_memory(), shutil.disk_usage(base).free)
                require(sha(env_file) == env_hash, 'env-changed-during-activation')
                if previous: require(current_is(base, previous.name), 'previous-release-changed')
                state['phase'] = 'starting-candidate'; state['candidate_attempted'] = True
                write_json_atomic(base / 'deployment-state.json', state)
                arguments = ['up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '300']
                if previous: arguments += ['--no-deps', *WRITERS]
                compose(candidate, env_file, images, *arguments)
                require(sha(env_file) == env_hash, 'env-changed-during-activation')
                compose(candidate, env_file, images, 'exec', '-T', 'backend', 'wget', '--quiet', '--spider',
                        'http://127.0.0.1:8080/q/health/ready')
                public_health()
                require(snapshot(candidate, env_file, images) == images, 'running-images-differ-from-manifest')
                if previous: require(current_is(base, previous.name), 'previous-release-changed')
                state['phase'] = 'candidate-healthy'; write_json_atomic(base / 'deployment-state.json', state)
                promote(base, args.source)
                state['phase'] = 'healthy-promoted'; write_json_atomic(base / 'deployment-state.json', state)
            except BaseException as failure:
                state['cause'] = str(failure) if isinstance(failure, DeployFailure) else 'activation-interrupted-or-command-failed'
                with interruption_handlers(restoring=True):
                    try:
                        require(previous is not None, 'fresh-installation-needs-manual-recovery')
                        restore_previous(base, candidate, env_file, images, state)
                    except BaseException:
                        state['phase'] = 'manual-recovery-required-no-db-downgrade'
                        # No down, volume removal, Redis, shared PG or proxy lifecycle.
                        try: compose(candidate, env_file, images, 'stop', *WRITERS)
                        except BaseException: pass
                        write_json_atomic(base / 'deployment-state.json', state)
                raise DeployFailure(state['phase']) from None
    print('activate: four own services healthy; canonical TLS/status; exact images; release promoted')
    print('authentication/CSRF/signup/logout and data acceptance still require own real fixture checks')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--dry-run', action='store_true')
    mode.add_argument('--prepare', action='store_true')
    mode.add_argument('--transfer', action='store_true')
    mode.add_argument('--activate', action='store_true')
    mode.add_argument('--recover', action='store_true', help='Explicitly restore the journal-bound previous OWN writers; never restore a database')
    mode.add_argument('--record-backup-review', action='store_true', help='Validate existing private APP/KC dumps with PG16 and record an operator review')
    mode.add_argument('--receive-images', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output'); parser.add_argument('--bundle')
    parser.add_argument('--reuse-transferred-from', help='Exact previous release with identical already-loaded config digests; verifies export, never trusts tags')
    parser.add_argument('--installation', choices=('fresh', 'upgrade'))
    parser.add_argument('--expected-current', help='Full SHA of the currently verified release; upgrade only')
    parser.add_argument('--schema-compatible-reviewed', action='store_true', help='Operator reviewed backup/data compatibility; never a DB rollback')
    parser.add_argument('--backup-evidence', help='Private source/schema/dump-hash review receipt; mandatory for upgrade')
    parser.add_argument('--app-backup', help='Existing private custom-format APP dump under the own backups directory')
    parser.add_argument('--idp-backup', help='Existing private custom-format KC dump under the own backups directory')
    parser.add_argument('--host', help='Explicit SSH user@host; no password or SSH options')
    parser.add_argument('--remote-root', help='Exclusive, absolute Folhea deployment directory')
    parser.add_argument('--project-name', default='folhea-prod', help='Exclusive Folhea Compose namespace')
    parser.add_argument('--server-address', help='Reviewed literal public server address; DNS must match exactly')
    args = parser.parse_args()
    try:
        if args.transfer or args.activate or args.receive_images or args.recover or args.record_backup_review or args.host or args.remote_root or args.server_address:
            configure_target(args.host, args.remote_root, args.project_name, args.server_address)
        value = plan(args.source)
        if args.prepare: prepare(args)
        elif args.transfer: transfer(args)
        elif args.activate: activate(args)
        elif args.recover: recover_activation(args)
        elif args.record_backup_review: record_backup_review(args)
        elif args.receive_images: receive_images(args)
        else: print(json.dumps(value, ensure_ascii=False, indent=2))
        return 0
    except (DeployFailure, OSError, ValueError, KeyError, TypeError, AttributeError, UnicodeError, RuntimeError, tarfile.TarError) as error:
        category = str(error) if isinstance(error, DeployFailure) else 'metadata-or-configuration-unavailable'
        print('deploy: failed category=' + category, file=sys.stderr); return 1


if __name__ == '__main__': sys.exit(main())
