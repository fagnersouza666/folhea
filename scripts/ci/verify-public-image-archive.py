#!/usr/bin/env python3
"""Check the public release boundary without extracting or loading image archives.

This is a policy gate for Folhea's build inputs and Docker-save/OCI artifacts,
not a replacement for the repository secret scanner. All layers, including
subsequently deleted files, are inspected. Diagnostics never echo file contents,
image metadata values, exceptions from parsers, or attacker-controlled paths.
"""
import argparse
import gzip
import hashlib
import io
import json
import re
import shlex
import sys
import tarfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
MAX_METADATA = 16 * 1024 * 1024
CHUNK = 128 * 1024
SENSITIVE = re.compile(r'(?:^|_)(?:PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIALS?|API_KEY|PRIVATE_KEY)(?:_|$)', re.I)
ASSIGNMENT = re.compile(r'\b([A-Za-z_][A-Za-z_0-9]*)\s*=\s*([^\s;]+)')
PRIVATE_KEY = re.compile(rb'-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----')
# Public lifespan/URL fields (accessTokenLifespan/tokenUrl) are not credentials.
# These actual Keycloak credential names use camelCase, unlike environment keys.
KEYCLOAK_CREDENTIAL_FIELDS = {'clientsecret', 'secretdata', 'credentialdata',
                              'privatekey', 'accesstoken', 'refreshtoken'}
PEM_OVERLAP = 256
DIGEST = re.compile(r'^[0-9a-f]{64}$')
PRIVATE_SUFFIXES = {'.key', '.p12', '.pfx', '.jks', '.keystore', '.dump'}


class Rejected(Exception):
    pass


def reject(category):
    raise Rejected(category)


def safe_path(name):
    if not isinstance(name, str) or '\\' in name or '\x00' in name:
        reject('unsafe-path')
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts:
        reject('unsafe-path')
    return str(path)


def private_path_rule(name):
    parts = PurePosixPath(name).parts
    if any(p in {'.ssh', '.local', '.ao', '.aws', '.kube'} for p in parts):
        return 'PRIVATE_STATE_DIRECTORY'
    leaf = parts[-1] if parts else ''
    # The committed example is a public placeholder model, not a runtime env.
    if leaf == '.env.example':
        return None
    if leaf == '.env' or leaf.startswith(('.env.', '.env-')) or leaf.endswith('.env'):
        return 'ENV_FILE'
    if leaf.endswith('.dump.gz') or PurePosixPath(leaf).suffix.lower() == '.dump':
        return 'DATABASE_DUMP'
    if PurePosixPath(leaf).suffix.lower() in PRIVATE_SUFFIXES:
        return 'KEY_MATERIAL_EXTENSION'
    if leaf in {'id_rsa', 'id_ed25519', 'credentials', 'credentials.json'}:
        return 'CREDENTIAL_NAME'
    return None


def private_path(name):
    return private_path_rule(name) is not None


def sensitive_field(key):
    return bool(SENSITIVE.search(key)) or key.casefold() in KEYCLOAK_CREDENTIAL_FIELDS


def private_file_diagnostic(entry, name, layer_name, content):
    """Only fixed enums and one-way path identifiers may reach public logs.

    layer_path_sha256 identifies the enclosing archive member's NAME, not its
    content digest. Never expose a member name, link target or parser exception.
    This classifies the existing rejection; it does not exempt public-looking
    payloads from any rule.
    """
    kind = ('file' if entry.isfile() else 'directory' if entry.isdir()
            else 'symlink' if entry.issym() else 'hardlink' if entry.islnk()
            else 'fifo' if entry.isfifo() else 'device' if entry.isdev() else 'other')
    suffix = PurePosixPath(name).suffix.lower()
    extension = {'.key': 'key', '.p12': 'p12', '.pfx': 'pfx', '.jks': 'jks',
                 '.keystore': 'keystore', '.dump': 'dump', '.env': 'env', '.json': 'json'
                 }.get(suffix, 'other')
    signature = ('private' if PRIVATE_KEY.search(content)
                 else 'public' if re.search(rb'-----BEGIN (?:RSA |EC |PGP )?PUBLIC KEY(?: BLOCK)?-----', content)
                 else 'certificate' if b'-----BEGIN CERTIFICATE-----' in content else 'none')
    return (f'private-file rule={private_path_rule(name)} kind={kind}'
            f' extension={extension} signature={signature}'
            f' path_sha256={hashlib.sha256(name.encode()).hexdigest()}'
            f' layer_path_sha256={hashlib.sha256(layer_name.encode()).hexdigest()}')


def metadata_policy(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if sensitive_field(key) and item not in (None, '', [], {}):
                reject('sensitive-metadata')
            metadata_policy(item)
    elif isinstance(value, list):
        for item in value:
            metadata_policy(item)
    elif isinstance(value, str):
        for key, item in ASSIGNMENT.findall(value):
            if sensitive_field(key) and item.strip('"\''):
                reject('sensitive-metadata')
        if PRIVATE_KEY.search(value.encode()):
            reject('private-key')
        if re.search(r'https?://[^\s/@]+:[^\s/@]+@', value):
            reject('sensitive-metadata')


def config_policy(config):
    for env in (config.get('config') or {}).get('Env') or []:
        if not isinstance(env, str) or '=' not in env:
            reject('invalid-config')
        key, value = env.split('=', 1)
        if sensitive_field(key) and value:
            reject('sensitive-environment')
    metadata_policy(config)


def public_realm_template(obj, body):
    """A placeholder template outside the auto-import directory is public data."""
    if not re.search(rb'\$\{[A-Z_][A-Z_0-9]*\}', body) or obj.get('users'):
        return False

    def placeholders(value):
        if isinstance(value, dict):
            return all((not sensitive_field(key) or item in (None, '')
                        or isinstance(item, str) and re.fullmatch(r'\$\{[A-Z_][A-Z_0-9]*\}', item))
                       and placeholders(item) for key, item in value.items())
        if isinstance(value, list):
            return all(placeholders(item) for item in value)
        return True

    return placeholders(obj)


class HashedReader(io.RawIOBase):
    """Digest a stream while tarfile consumes it; never retain layer contents."""
    def __init__(self, source):
        self.source = source
        self.digest = hashlib.sha256()

    def readable(self):
        return True

    def readinto(self, buffer):
        data = self.source.read(len(buffer))
        buffer[:len(data)] = data
        self.digest.update(data)
        return len(data)


def drain(stream):
    while stream.read(CHUNK):
        pass


def inspect_file(content, size, collect_json):
    """Scan textual files through EOF, retaining only a bounded PEM overlap.

    Preserve the initial NUL-byte binary classification: executable libraries
    may contain PEM parser literals rather than a PEM document. JSON collection
    has its separate MAX_METADATA bound. Non-JSON file size does not affect RAM.
    """
    block = content.read(min(size, CHUNK))
    text = b'\x00' not in block
    pieces = []
    overlap = b''
    while block:
        if text:
            window = overlap + block
            if PRIVATE_KEY.search(window):
                reject('private-key')
            # Do not silently truncate a contrived, unbounded armor label. All
            # standard PEM labels fit the overlap; oversized labels fail closed.
            pending = re.search(rb'-----BEGIN [A-Z0-9 ]*$', window)
            if pending and len(pending.group()) > PEM_OVERLAP:
                reject('unsupported-pem-label')
            overlap = window[-PEM_OVERLAP:]
        if collect_json:
            pieces.append(block)
        block = content.read(CHUNK)
    return b''.join(pieces) if collect_json else None


def layer_policy(stream, layer_name):
    with tarfile.open(fileobj=stream, mode='r|') as layer:
        for entry in layer:
            name = safe_path(entry.name)
            if private_path(name):
                content = (layer.extractfile(entry).read(min(entry.size, CHUNK))
                           if entry.isfile() else b'')
                reject(private_file_diagnostic(entry, name, layer_name, content))
            if not entry.isfile():
                # Links and devices are never followed or materialized.
                continue
            content = layer.extractfile(entry)
            is_json = name.endswith('.json')
            if is_json:
                if 'opt/keycloak/data/import/' in name:
                    reject('embedded-realm')
                if entry.size > MAX_METADATA:
                    reject('oversized-json')
            body = inspect_file(content, entry.size, is_json)
            if is_json:
                try:
                    obj = json.loads(body)
                except (ValueError, UnicodeError):
                    continue
                if isinstance(obj, dict) and isinstance(obj.get('realm'), str) and (
                        'clients' in obj or 'users' in obj):
                    if not public_realm_template(obj, body):
                        reject('embedded-realm')
    drain(stream)  # Include tar padding in the uncompressed layer digest.


def read_archive(path):
    objects, hashes, sizes, layers = {}, {}, {}, {}
    with tarfile.open(path, mode='r|*') as archive:
        for member in archive:
            name = safe_path(member.name)
            if member.isdir():
                continue
            if not member.isfile() or name in hashes:
                reject('unexpected-entry')
            hashed = HashedReader(archive.extractfile(member))
            stream = io.BufferedReader(hashed)
            prefix = stream.peek(512)
            is_layer = (name.endswith('/layer.tar') or prefix.startswith(b'\x1f\x8b')
                        or len(prefix) >= 262 and prefix[257:262] == b'ustar'
                        or len(prefix) >= 512 and prefix[:512] == bytes(512))
            if is_layer:
                decoded = gzip.GzipFile(fileobj=stream) if prefix.startswith(b'\x1f\x8b') else stream
                layer_hash = HashedReader(decoded)
                buffered = io.BufferedReader(layer_hash)
                layer_policy(buffered, name)
                drain(stream)
                layers[name] = layer_hash.digest.hexdigest()
            else:
                if member.size > MAX_METADATA:
                    reject('unsupported-entry')
                body = stream.read()
                if name.endswith('/VERSION') and body.strip() == b'1.0':
                    objects[name] = None
                else:
                    try:
                        objects[name] = json.loads(body)
                    except (ValueError, UnicodeError):
                        reject('unexpected-entry')
            hashes[name] = hashed.digest.hexdigest()
            sizes[name] = member.size
            if name.startswith('blobs/sha256/') and name.rsplit('/', 1)[1] != hashes[name]:
                reject('digest-mismatch')
    return objects, hashes, sizes, layers


def verify_archive(path, expected):
    objects, hashes, sizes, layers = read_archive(path)
    used, images = set(), []

    def config(name, layer_names):
        if name not in objects or not isinstance(objects[name], dict):
            reject('missing-config')
        digest = name.rsplit('/', 1)[-1].removesuffix('.json')
        if not DIGEST.fullmatch(digest) or hashes[name] != digest:
            reject('digest-mismatch')
        cfg = objects[name]
        config_policy(cfg)
        if not cfg.get('os') or not cfg.get('architecture'):
            reject('invalid-config')
        if any(layer not in layers for layer in layer_names):
            reject('missing-layer')
        if (cfg.get('rootfs') or {}).get('diff_ids') != ['sha256:' + layers[n] for n in layer_names]:
            reject('digest-mismatch')
        used.update([name, *layer_names])

    def descriptor(desc):
        digest = desc.get('digest', '')
        if not isinstance(digest, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
            reject('unsupported-descriptor')
        name = 'blobs/sha256/' + digest[7:]
        if name not in hashes or desc.get('size') != sizes[name]:
            reject('missing-descriptor')
        used.add(name)
        return name

    classic = objects.get('manifest.json')
    if classic is not None:
        if not isinstance(classic, list) or not classic:
            reject('invalid-manifest')
        used.add('manifest.json')
        for item in classic:
            names = item.get('Layers', [])
            config(item['Config'], names)
            images.extend(item.get('RepoTags') or [])
        # Exporters may include equivalent OCI metadata as well. Validate every
        # JSON metadata object; do not silently permit unrelated payload files.
    elif objects.get('oci-layout') == {'imageLayoutVersion': '1.0.0'}:
        used.update(['oci-layout', 'index.json'])
        visiting = set()

        def visit(desc, tag=None):
            name = descriptor(desc)
            if name in visiting:
                reject('invalid-manifest')
            visiting.add(name)
            obj = objects.get(name, {})
            tag = (desc.get('annotations') or {}).get('org.opencontainers.image.ref.name', tag)
            if 'manifests' in obj:
                for child in obj['manifests']:
                    visit(child, tag)
            elif obj.get('schemaVersion') == 2 and 'config' in obj and 'layers' in obj:
                cfg = descriptor(obj['config'])
                config(cfg, [descriptor(item) for item in obj['layers']])
                if not tag:
                    reject('unexpected-images')
                images.append(tag)
            else:
                reject('unsupported-manifest')
            visiting.remove(name)

        for desc in objects.get('index.json', {}).get('manifests', []):
            visit(desc)
    else:
        reject('unsupported-layout')
    if set(images) != set(expected) or len(images) != len(expected):
        reject('unexpected-images')
    for name, obj in objects.items():
        metadata_policy(obj)
        if name in used:
            continue
        # Docker classic auxiliary metadata and containerd's OCI index are
        # public descriptors. Their referenced blobs must already be audited.
        if name == 'repositories' or name.endswith(('/VERSION', '/json')):
            continue
        if classic is not None and name in {'oci-layout', 'index.json'}:
            continue
        if classic is not None and name.startswith('blobs/sha256/') and isinstance(obj, dict):
            refs = [obj.get('config', {}), *obj.get('layers', []), *obj.get('manifests', [])]
            if obj.get('schemaVersion') == 2 and refs:
                for ref in refs:
                    if ref:
                        descriptor(ref)
                continue
        reject('unexpected-entry')
    if set(layers) - used:
        reject('unexpected-entry')
    return len(images), len(layers)


def check_source():
    required = {'**/.env', '**/.env.*', '**/*.env', '**/*.key', '**/*.pem',
                '**/*.p12', '**/*.pfx', '**/*.jks', '**/*.keystore', '**/.ssh', '**/.local'}
    rules = {line.strip() for line in (ROOT / '.dockerignore').read_text().splitlines()
             if line.strip() and not line.startswith('#')}
    if not required <= rules or any(rule.startswith('!') and rule != '!**/.env.example' for rule in rules):
        reject('unsafe-build-context')
    recipe = (ROOT / 'infra/Dockerfile').read_text().replace('\\\n', ' ')
    for line in recipe.splitlines():
        tokens = shlex.split(line, comments=True)
        if not tokens:
            continue
        instruction = tokens[0].upper()
        if instruction in {'ARG', 'ENV'}:
            keys = [token.split('=', 1)[0] for token in tokens[1:]]
            if any(sensitive_field(key) for key in keys):
                reject('sensitive-build-input')
        if instruction in {'COPY', 'ADD'}:
            if any(private_path(token) or 'realm' in token.lower()
                   for token in tokens[1:] if not token.startswith('--')):
                reject('private-build-input')
    return 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', nargs='?')
    parser.add_argument('--expected-tag', action='append', default=[])
    parser.add_argument('--check-source', action='store_true')
    args = parser.parse_args()
    try:
        if args.check_source and not args.archive:
            check_source()
            print('public-image-source: PASS')
        elif args.archive and args.expected_tag and not args.check_source:
            images, layers = verify_archive(args.archive, args.expected_tag)
            print(f'public-image-archive: PASS images={images} layers={layers}')
        else:
            parser.error('provide --check-source or an archive with --expected-tag')
        return 0
    except Rejected as error:
        print(f'public-image-archive: FAIL category={error}', file=sys.stderr)
    except (OSError, EOFError, ValueError, KeyError, TypeError, AttributeError,
            OverflowError, RecursionError, tarfile.TarError):
        # Parser/OS exceptions can contain paths or contents from the archive.
        print('public-image-archive: FAIL category=invalid-archive', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
