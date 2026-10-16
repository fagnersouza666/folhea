"""Public image artifacts reject sensitive inputs, including deleted image layers."""
import gzip
import hashlib
import importlib.util
import io
import json
import secrets
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
CHECK = ROOT / 'scripts/ci/verify-public-image-archive.py'
TAGS = ['folhea:backend-test', 'folhea:caddy-test', 'folhea:keycloak-test']


def private_pem_boundary(edge='BEGIN'):
    # Assemble only in memory, so source scanners do not see a PEM key fixture.
    return ('-' * 5 + edge + ' ' + 'PRIVATE KEY' + '-' * 5).encode()


def tar_bytes(files):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        for name, value in files:
            member = name if isinstance(name, tarfile.TarInfo) else tarfile.TarInfo(name)
            member.size = len(value) if member.isfile() else 0
            archive.addfile(member, io.BytesIO(value) if member.isfile() else None)
    return stream.getvalue()


def fixture(layout='classic', files=None, env=None, history=None, delete_after=False):
    layers = [tar_bytes(files or [('srv/index.html', b'public app')])]
    if delete_after:
        target = delete_after if isinstance(delete_after, str) else 'srv/.env.production'
        parent, leaf = target.rsplit('/', 1)
        layers.append(tar_bytes([(parent + '/.wh.' + leaf, b'')]))
    config = json.dumps({'architecture': 'amd64', 'os': 'linux',
                         'config': {'Env': env or ['KC_DB=postgres', 'PUBLIC_DOMAIN=localhost']},
                         'history': history or [],
                         'rootfs': {'type': 'layers', 'diff_ids': [
                             'sha256:' + hashlib.sha256(layer).hexdigest() for layer in layers]}}).encode()
    config_digest = hashlib.sha256(config).hexdigest()
    if layout in ['classic', 'containerd']:
        config_name = ('blobs/sha256/' if layout == 'containerd' else '') + config_digest
        if layout == 'classic':
            config_name += '.json'
        layer_names = [('blobs/sha256/' + hashlib.sha256(layer).hexdigest()
                        if layout == 'containerd' else hashlib.sha256(layer).hexdigest() + '/layer.tar')
                       for layer in layers]
        metadata = [('manifest.json', json.dumps([
            {'Config': config_name, 'RepoTags': TAGS, 'Layers': layer_names}]).encode())]
        blobs = list(zip(layer_names, layers))
    else:
        config_name = 'blobs/sha256/' + config_digest
        encoded_layers = [gzip.compress(layer) for layer in layers]
        layer_names = ['blobs/sha256/' + hashlib.sha256(layer).hexdigest() for layer in encoded_layers]
        manifest = json.dumps({'schemaVersion': 2, 'config': {
            'mediaType': 'application/vnd.oci.image.config.v1+json',
            'digest': 'sha256:' + config_digest, 'size': len(config)}, 'layers': [
                {'mediaType': 'application/vnd.oci.image.layer.v1.tar+gzip',
                 'digest': 'sha256:' + name.rsplit('/', 1)[1], 'size': len(layer)}
                for name, layer in zip(layer_names, encoded_layers)]}).encode()
        digest = hashlib.sha256(manifest).hexdigest()
        index = {'schemaVersion': 2, 'manifests': [
            {'mediaType': 'application/vnd.oci.image.manifest.v1+json',
             'digest': 'sha256:' + digest, 'size': len(manifest),
             'annotations': {'org.opencontainers.image.ref.name': tag}}
            for tag in TAGS]}
        metadata = [('oci-layout', b'{"imageLayoutVersion":"1.0.0"}'),
                    ('index.json', json.dumps(index).encode()),
                    ('blobs/sha256/' + digest, manifest)]
        blobs = list(zip(layer_names, encoded_layers))
    # Ordering deliberately puts layers before metadata, as real exporters may do.
    return gzip.compress(tar_bytes(blobs + [(config_name, config)] + metadata))


def hybrid_fixture(mutate=None, orphan=False, corrupt=False, variant=None):
    """Moby tarexport/save.go + v1.CreateID reference fixture, no daemon needed."""
    with tarfile.open(fileobj=io.BytesIO(gzip.decompress(
            fixture('containerd', env=['PUBLIC_DOMAIN=site' + str(variant) + '.example']
                    if variant is not None else None,
                    delete_after='srv/index.html' if variant is None else 'srv/file-' + str(variant))))) as archive:
        files = [(member.name, archive.extractfile(member).read()) for member in archive]
    bodies = dict(files)
    item = json.loads(bodies['manifest.json'])[0]
    cfg = json.loads(bodies[item['Config']])
    zero = {'Hostname': '', 'Domainname': '', 'User': '', 'AttachStdin': False,
            'AttachStdout': False, 'AttachStderr': False, 'Tty': False, 'OpenStdin': False,
            'StdinOnce': False, 'Env': None, 'Cmd': None, 'Image': '', 'Volumes': None,
            'WorkingDir': '', 'Entrypoint': None, 'Labels': None}
    chain, parent, records = '', '', []
    for index, diff_id in enumerate(cfg['rootfs']['diff_ids']):
        chain = ('sha256:' + hashlib.sha256((chain + ' ' + diff_id).encode()).hexdigest()
                 if chain else diff_id)
        terminal = index == len(item['Layers']) - 1
        record = {'created': None if terminal else '1970-01-01T00:00:00Z',
                  'container_config': dict(zero)}
        if terminal:
            record.update(config={**zero, **cfg['config']}, architecture=cfg['architecture'])
        # Moby sets os AFTER CreateID for intermediate records.
        if terminal:
            record['os'] = cfg['os']
        if mutate:
            mutate(record, terminal)
        identity = {**record, 'layer_id': chain}
        if parent:
            identity['parent'] = 'sha256:' + parent
        canonical = json.dumps({key: identity[key] for key in sorted(identity)},
                               separators=(',', ':'), ensure_ascii=False)
        legacy_id = hashlib.sha256(canonical.encode()).hexdigest()
        record = {'id': legacy_id, **({'parent': parent} if parent else {}), **record, 'os': cfg['os']}
        body = json.dumps(record, separators=(',', ':')).encode()
        records.append(('blobs/sha256/' + hashlib.sha256(body).hexdigest(), body))
        parent = legacy_id
    if orphan:
        record = json.loads(records[0][1])
        record['id'] = '0' * 64
        body = json.dumps(record, separators=(',', ':')).encode()
        records.append(('blobs/sha256/' + hashlib.sha256(body).hexdigest(), body))
    if corrupt:
        name, body = records[0]
        records[0] = (name, body + b' ')
    manifest = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                'config': {'mediaType': 'application/vnd.oci.image.config.v1+json',
                           'digest': 'sha256:' + item['Config'].rsplit('/', 1)[1],
                           'size': len(bodies[item['Config']])},
                'layers': [{'mediaType': 'application/vnd.oci.image.layer.v1.tar',
                            'digest': 'sha256:' + name.rsplit('/', 1)[1], 'size': len(bodies[name])}
                           for name in item['Layers']]}
    body = json.dumps(manifest, separators=(',', ':')).encode()
    digest = hashlib.sha256(body).hexdigest()
    index = {'schemaVersion': 2, 'manifests': [
        {'digest': 'sha256:' + digest, 'size': len(body),
         'mediaType': 'application/vnd.oci.image.manifest.v1+json',
         'annotations': {'org.opencontainers.image.ref.name': tag}}
        for tag in TAGS]}
    return gzip.compress(tar_bytes(files + records + [
        ('blobs/sha256/' + digest, body),
        ('oci-layout', b'{"imageLayoutVersion":"1.0.0"}'),
        ('index.json', json.dumps(index).encode())]))


def multi_hybrid_fixture(orphan=False):
    # Three different final configs/chains, one shared prefix layer + V1 record.
    files, manifests, descriptors = {}, [], []
    for index, tag in enumerate(TAGS):
        with tarfile.open(fileobj=io.BytesIO(gzip.decompress(
                hybrid_fixture(variant=index, orphan=orphan and index == 0)))) as archive:
            image = {member.name: archive.extractfile(member).read() for member in archive}
        item = json.loads(image.pop('manifest.json'))[0]
        item['RepoTags'] = [tag]
        manifests.append(item)
        descriptors.extend(desc for desc in json.loads(image.pop('index.json'))['manifests']
                           if desc['annotations']['org.opencontainers.image.ref.name'] == tag)
        files.update(image)
    files['manifest.json'] = json.dumps(manifests).encode()
    files['index.json'] = json.dumps({'schemaVersion': 2, 'manifests': descriptors}).encode()
    return gzip.compress(tar_bytes(list(files.items())))


class PublicImageArchiveTest(unittest.TestCase):
    def check(self, data, *, tags=TAGS):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'images.tar.gz'
            path.write_bytes(data)
            path.chmod(0o600)
            command = [sys.executable, str(CHECK), str(path)]
            for tag in tags:
                command += ['--expected-tag', tag]
            return subprocess.run(command, capture_output=True, text=True, timeout=15)

    def rejected(self, data, category, sensitive=None):
        result = self.check(data)
        self.assertEqual(result.returncode, 1)
        self.assertIn(category, result.stderr)
        if sensitive:
            self.assertTrue(sensitive not in result.stdout + result.stderr,
                            'Diagnostics must not expose the synthetic sensitive value')

    def test_accepts_classic_and_oci_archives_with_benign_environment(self):
        for layout in ['classic', 'containerd', 'oci']:
            with self.subTest(layout=layout):
                result = self.check(fixture(layout))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('images=3', result.stdout)

    def test_hybrid_moby_export_links_legacy_records_to_real_layer_chain_and_final_config(self):
        result = self.check(hybrid_fixture())
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_three_hybrid_images_share_a_prefix_without_requiring_one_global_chain(self):
        result = self.check(multi_hybrid_fixture())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('images=3 layers=4', result.stdout)

    def test_three_hybrid_images_still_reject_orphan_legacy_metadata(self):
        self.rejected(multi_hybrid_fixture(orphan=True), 'unexpected-entry')

    def test_hybrid_legacy_metadata_cannot_hide_a_secret(self):
        value = secrets.token_urlsafe(32)
        def mutate(record, terminal):
            if not terminal:
                record['container_config']['Env'] = ['APP_SECRET=' + value]
        self.rejected(hybrid_fixture(mutate=mutate), 'sensitive-metadata', value)

    def test_hybrid_legacy_orphan_and_config_mismatch_are_rejected(self):
        self.rejected(hybrid_fixture(orphan=True), 'unexpected-entry')
        def mutate(record, terminal):
            if terminal:
                record['config']['Env'] = ['PUBLIC_DOMAIN=unrelated.example']
        self.rejected(hybrid_fixture(mutate=mutate), 'invalid-legacy-metadata')

    def test_hybrid_legacy_blob_digest_is_still_verified(self):
        self.rejected(hybrid_fixture(corrupt=True), 'digest-mismatch')

    def test_rejects_sensitive_environment_without_printing_value(self):
        value = secrets.token_urlsafe(32)
        self.rejected(fixture(env=['KC_DB_PASSWORD=' + value]), 'sensitive-environment', value)

    def test_rejects_sensitive_build_history_without_printing_value(self):
        value = secrets.token_urlsafe(32)
        self.rejected(fixture(history=[{'created_by': 'ENV APP_SECRET=' + value}]),
                      'sensitive-metadata', value)

    def test_rejects_private_file_even_when_a_later_layer_deletes_it(self):
        value = secrets.token_urlsafe(32)
        self.rejected(fixture(files=[('srv/.env.production', value.encode())], delete_after=True),
                      'private-file', value)

    def test_private_file_diagnostic_exposes_only_reason_kind_and_public_signature(self):
        value = secrets.token_urlsafe(32)
        path = 'srv/' + secrets.token_hex(16) + '/.env.production'
        result = self.check(fixture(files=[(path, value.encode())]))
        self.assertEqual(result.returncode, 1)
        self.assertIn('category=private-file rule=ENV_FILE kind=file extension=other signature=none',
                      result.stderr)
        self.assertIn('path_sha256=' + hashlib.sha256(path.encode()).hexdigest(), result.stderr)
        self.assertRegex(result.stderr, r'layer_path_sha256=[0-9a-f]{64}')
        self.assertRegex(result.stderr, r'\Apublic-image-archive: FAIL category=private-file '
                         r'rule=ENV_FILE kind=file extension=other signature=none '
                         r'path_sha256=[0-9a-f]{64} layer_path_sha256=[0-9a-f]{64}\n\Z')
        self.assertTrue(path not in result.stderr and value not in result.stderr,
                        'Diagnostic must not include a path or synthetic value')

    def test_private_suffix_remains_rejected_even_for_a_public_pem_signature(self):
        certificate = b'-----BEGIN CERTIFICATE-----\npublic certificate\n-----END CERTIFICATE-----'
        result = self.check(fixture(files=[('etc/vendor/public.key', certificate)]))
        self.assertEqual(result.returncode, 1)
        self.assertIn('rule=KEY_MATERIAL_EXTENSION kind=file extension=key signature=certificate',
                      result.stderr)
        self.assertNotIn('etc/vendor/public.key', result.stderr)

    def test_rejects_private_key_but_accepts_public_certificate(self):
        value = secrets.token_urlsafe(32)
        key = b'\n'.join([private_pem_boundary(), value.encode(), private_pem_boundary('END')])
        self.rejected(fixture(files=[('etc/custom.pem', key)]), 'private-key', value)
        certificate = b'-----BEGIN CERTIFICATE-----\npublic certificate\n-----END CERTIFICATE-----'
        self.assertEqual(self.check(fixture(files=[('etc/ssl/certs/public.pem', certificate)])).returncode, 0)

    def test_rejects_rendered_realm_outside_the_import_directory_too(self):
        value = secrets.token_urlsafe(32)
        realm = json.dumps({'realm': 'test', 'enabled': True,
                            'clients': [{'secret': value}]}).encode()
        self.rejected(fixture(files=[('opt/keycloak/conf/copied.json', realm)]), 'embedded-realm', value)

    def test_rejects_even_an_unrendered_realm_in_the_runtime_import_directory(self):
        realm = json.dumps({'realm': 'test', 'clients': [{'secret': '${CLIENT_SECRET}'}]}).encode()
        self.rejected(fixture(files=[('opt/keycloak/data/import/realm.json', realm)]), 'embedded-realm')

    def test_public_placeholder_template_outside_auto_import_is_not_a_secret(self):
        realm = json.dumps({'realm': 'test', 'clients': [{'secret': '${CLIENT_SECRET}'}]}).encode()
        result = self.check(fixture(files=[('templates/realm.template.json', realm)]))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_a_placeholder_does_not_hide_a_rendered_client_secret(self):
        value = secrets.token_urlsafe(32)
        realm = json.dumps({'realm': 'test', 'clients': [
            {'secret': '${CLIENT_SECRET}'}, {'secret': value}]}).encode()
        self.rejected(fixture(files=[('templates/realm.json', realm)]), 'embedded-realm', value)

    def test_camel_case_realm_credentials_must_be_empty_or_placeholders(self):
        for field in ['clientSecret', 'secretData', 'credentialData', 'privateKey',
                      'accessToken', 'refreshToken']:
            with self.subTest(field=field):
                value = secrets.token_urlsafe(32)
                obj = {'realm': 'test', 'clients': [{'secret': '${CLIENT_SECRET}'}],
                       'identityProviders': [{'config': {field: value}}]}
                self.rejected(fixture(files=[('templates/realm.json', json.dumps(obj).encode())]),
                              'embedded-realm', value)
                for permitted in ['', '${PROVIDER_CREDENTIAL}']:
                    obj['identityProviders'][0]['config'][field] = permitted
                    result = self.check(fixture(files=[('templates/realm.json', json.dumps(obj).encode())]))
                    self.assertEqual(result.returncode, 0, result.stderr)

    def test_public_realm_lifetimes_and_endpoints_are_not_credential_values(self):
        obj = {'realm': 'test', 'accessTokenLifespan': 300,
               'clients': [{'secret': '${CLIENT_SECRET}'}],
               'identityProviders': [{'config': {'tokenUrl': 'https://idp.example/token'}}]}
        result = self.check(fixture(files=[('templates/realm.json', json.dumps(obj).encode())]))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_text_private_key_after_first_chunk_and_across_boundary_is_rejected(self):
        chunk = 128 * 1024
        certificate = b'-----BEGIN CERTIFICATE-----\npublic certificate\n-----END CERTIFICATE-----\n'
        for offset in [chunk + 41, chunk - 9]:
            with self.subTest(offset=offset):
                value = secrets.token_urlsafe(32)
                prefix = certificate + b' ' * (offset - len(certificate))
                body = prefix + b'\n'.join([private_pem_boundary(), value.encode(), private_pem_boundary('END')])
                self.rejected(fixture(files=[('etc/bundle.pem', body)], delete_after='etc/bundle.pem'),
                              'private-key', value)

    def test_binary_parser_literals_are_not_private_pem_files(self):
        body = b'\x7fELF\x00' + b' ' * (128 * 1024) + private_pem_boundary()
        result = self.check(fixture(files=[('usr/lib/parser.so', body)]))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_large_public_certificate_bundle_is_allowed(self):
        body = (b'-----BEGIN CERTIFICATE-----\npublic certificate\n-----END CERTIFICATE-----\n'
                * 5000)
        result = self.check(fixture(files=[('etc/ssl/certs/public.pem', body)]))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_unbounded_pem_label_cannot_escape_the_overlap_window(self):
        body = b'-----BEGIN ' + b'X' * (128 * 1024) + b' PRIVATE KEY-----'
        self.rejected(fixture(files=[('etc/oversized-label.pem', body)]), 'unsupported-pem-label')

    def test_rejects_traversal_without_extracting_any_file(self):
        self.rejected(fixture(files=[('../escape', b'not extracted')]), 'unsafe-path')

    def test_layer_symlinks_are_inspected_as_metadata_and_never_followed(self):
        link = tarfile.TarInfo('usr/share/public-reference')
        link.type = tarfile.SYMTYPE
        link.linkname = '/nonexistent-target-outside-archive'
        result = self.check(fixture(files=[(link, b'')]))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_missing_expected_image(self):
        result = self.check(fixture(), tags=TAGS + ['folhea:unexpected'])
        self.assertEqual(result.returncode, 1)
        self.assertIn('unexpected-images', result.stderr)

    def test_rejects_broken_config_digest_link(self):
        data = gzip.decompress(fixture())
        files = []
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            for member in archive:
                body = archive.extractfile(member).read()
                if member.name.endswith('.json') and member.name != 'manifest.json':
                    body += b' '
                files.append((member.name, body))
        self.rejected(gzip.compress(tar_bytes(files)), 'digest-mismatch')

    def test_rejects_unreferenced_private_outer_payload(self):
        data = gzip.decompress(fixture())
        files = []
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            files = [(member.name, archive.extractfile(member).read()) for member in archive]
        files.append(('production.env', secrets.token_bytes(20)))
        self.rejected(gzip.compress(tar_bytes(files)), 'unexpected-entry')

    def test_unexpected_entry_diagnostics_use_fixed_enums_and_only_opaque_identifiers(self):
        with tarfile.open(fileobj=io.BytesIO(gzip.decompress(fixture()))) as archive:
            base = [(member.name, archive.extractfile(member).read()) for member in archive]
        arbitrary = secrets.token_hex(16)
        value = secrets.token_urlsafe(32)
        link = tarfile.TarInfo('extra-' + arbitrary)
        link.type = tarfile.SYMTYPE
        link.linkname = 'target-' + arbitrary
        layer = tar_bytes([('srv/' + arbitrary, value.encode())])
        cases = [
            ((link, b''), 'OUTER_NON_REGULAR', 'symlink', link.name, link.linkname),
            (base[0], 'OUTER_DUPLICATE', 'file', base[0][0], None),
            (('extra-' + arbitrary, value.encode()), 'OUTER_NON_JSON', 'file', 'extra-' + arbitrary, None),
            (('extra-' + arbitrary + '.json', json.dumps({'opaque': value}).encode()),
             'UNREFERENCED_METADATA', 'file', 'extra-' + arbitrary + '.json', None),
            ((hashlib.sha256(layer).hexdigest() + '/layer.tar', layer), 'UNREFERENCED_LAYER', 'file',
             hashlib.sha256(layer).hexdigest() + '/layer.tar', None),
        ]
        for extra, reason, kind, name, target in cases:
            with self.subTest(reason=reason):
                result = self.check(gzip.compress(tar_bytes(base + [extra])))
                self.assertEqual(result.returncode, 1)
                target_digest = hashlib.sha256(target.encode()).hexdigest() if target else 'none'
                expected = ('public-image-archive: FAIL category=unexpected-entry reason=' + reason
                            + ' kind=' + kind + ' path_sha256=' + hashlib.sha256(name.encode()).hexdigest()
                            + ' target_sha256=' + target_digest + '\n')
                self.assertEqual(result.stderr, expected)
                self.assertTrue(arbitrary not in result.stdout + result.stderr
                                and value not in result.stdout + result.stderr,
                                'Diagnostic must not expose an arbitrary path, target, or value')

    def test_rejects_layer_tampering_even_when_config_is_unchanged(self):
        files = []
        with tarfile.open(fileobj=io.BytesIO(gzip.decompress(fixture()))) as archive:
            for member in archive:
                body = archive.extractfile(member).read()
                if member.name.endswith('/layer.tar'):
                    body = tar_bytes([('srv/index.html', b'different public content')])
                files.append((member.name, body))
        self.rejected(gzip.compress(tar_bytes(files)), 'digest-mismatch')

    def test_truncated_archive_fails_without_traceback_or_payload(self):
        result = self.check(fixture()[:100])
        self.assertEqual(result.returncode, 1)
        self.assertIn('category=', result.stderr)
        self.assertNotIn('Traceback', result.stderr)

    def test_unknown_format_is_not_accepted_as_an_empty_success(self):
        self.rejected(gzip.compress(tar_bytes([('README', b'not an image')])), 'unexpected-entry')


class PublicBuildBoundaryTest(unittest.TestCase):
    def test_caddy_validate_requires_both_tmpfs_mounts_on_the_same_run(self):
        spec = importlib.util.spec_from_file_location('public_archive_gate', CHECK)
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        command = 'caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile'
        cases = [
            ('RUN ' + command, False),
            ('RUN --mount=type=tmpfs,target=/data ' + command, False),
            ('RUN --mount=type=cache,target=/data --mount=type=tmpfs,target=/config ' + command, False),
            ('RUN --mount=type=tmpfs,target=/data --mount=type=tmpfs,target=/config true\nRUN '
             + command, False),
            ('RUN echo --mount=type=tmpfs,target=/data --mount=type=tmpfs,target=/config && '
             + command, False),
            ('RUN --mount=type=tmpfs,target=/data --mount=type=tmpfs,target=/config ' + command, True),
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'infra').mkdir()
            (root / '.dockerignore').write_text((ROOT / '.dockerignore').read_text())
            for index, (run, permitted) in enumerate(cases):
                with self.subTest(case=index):
                    (root / 'infra/Dockerfile').write_text('FROM base\n' + run + '\n')
                    with patch.object(gate, 'ROOT', root):
                        if permitted:
                            self.assertEqual(gate.check_source(), 1)
                        else:
                            with self.assertRaisesRegex(gate.Rejected, '^persistent-validation-state$'):
                                gate.check_source()

    def test_release_upload_requires_success_and_follows_archive_validation(self):
        workflow = (ROOT / '.github/workflows/cd.yml').read_text()
        release = workflow.split('  deploy:', 1)[0]
        self.assertIn('verify-public-image-archive.py', release)
        upload = release.split('- name: Upload release evidence', 1)[1]
        self.assertIn('if: success()', upload)
        self.assertNotIn('if: always()', upload)
        self.assertNotIn('surefire-reports', upload)
        self.assertLess(release.index('verify-public-image-archive.py'), release.index('Upload release evidence'))

    def test_cd_manual_dispatch_is_explicitly_main_only(self):
        workflow = (ROOT / '.github/workflows/cd.yml').read_text()
        self.assertIn("github.ref == 'refs/heads/main'", workflow)

    def test_git_ignores_private_files_but_not_the_example_model(self):
        private = ['frontend/.env.production', 'backend/local.key', 'nested/cert.pem',
                   'nested/store.p12', 'nested/production.env']
        result = subprocess.run(['git', 'check-ignore', '--no-index', '--stdin'], cwd=ROOT,
                                input='\n'.join(private + ['.env.example']) + '\n',
                                capture_output=True, text=True, check=False)
        self.assertEqual(set(result.stdout.splitlines()), set(private))

    def test_build_input_policy_allows_current_configuration_after_ignore_hardening(self):
        result = subprocess.run([sys.executable, str(CHECK), '--check-source'], cwd=ROOT,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_source_policy_rejects_secret_build_channels_and_embedded_realms(self):
        spec = importlib.util.spec_from_file_location('public_archive_gate', CHECK)
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'infra').mkdir()
            (root / '.dockerignore').write_text((ROOT / '.dockerignore').read_text())
            for recipe in ['FROM base\nARG APP_SECRET\n',
                           'FROM base\nENV KC_DB_PASSWORD\n',
                           'FROM base\nCOPY rendered-realm.json /opt/keycloak/data/import/realm.json\n']:
                with self.subTest(instruction=recipe.splitlines()[1].split()[0]):
                    (root / 'infra/Dockerfile').write_text(recipe)
                    with patch.object(gate, 'ROOT', root), self.assertRaises(gate.Rejected):
                        gate.check_source()

    def test_source_policy_rejects_missing_context_exclusions_and_broad_exceptions(self):
        spec = importlib.util.spec_from_file_location('public_archive_gate', CHECK)
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'infra').mkdir()
            (root / 'infra/Dockerfile').write_text('FROM base\nENV PUBLIC_DOMAIN=localhost\n')
            for rules in ['.git\n', (ROOT / '.dockerignore').read_text() + '\n!**/*.env\n']:
                (root / '.dockerignore').write_text(rules)
                with patch.object(gate, 'ROOT', root), self.assertRaises(gate.Rejected):
                    gate.check_source()


if __name__ == '__main__':
    unittest.main()
