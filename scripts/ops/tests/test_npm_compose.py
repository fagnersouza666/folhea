"""Real Compose rendering + negative NPM isolation/peer policy regressions."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[3]
GUARD = ROOT / "scripts/ops/validate-npm-compose.py"


class NpmComposeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory(prefix="folhea-npm-config-") as scratch:
            env_file = Path(scratch) / "model.env"
            replacements = {
                "PUBLIC_DOMAIN": "folhea.app", "PUBLIC_ORIGIN": "https://folhea.app", "OIDC_PUBLIC_ORIGIN": "https://folhea.app",
                "OIDC_PUBLIC_ISSUER": "https://folhea.app/realms/folhea",
                "OIDC_PUBLIC_AUTHORIZATION_URL": "https://folhea.app/realms/folhea/protocol/openid-connect/auth",
                "OIDC_PUBLIC_LOGOUT_URL": "https://folhea.app/realms/folhea/protocol/openid-connect/logout",
                "SECURITY_CANONICAL_ORIGIN": "https://folhea.app",
                "SECURITY_ALLOWED_ORIGINS": "https://folhea.app",
                "BACKEND_IPV4": "192.0.2.3",
            }
            lines = []
            for line in (ROOT / ".env.example").read_text().splitlines():
                key, _, value = line.partition("=")
                if key in replacements:
                    line = key + "=" + replacements[key]
                elif value.startswith("replace-with-"):
                    line = key + "=" + "synthetic-config-test-only-" + "x" * 32
                lines.append(line)
            lines += ["NPM_PROXY_IP=198.51.100.2", "NPM_PROXY_CONTAINER=edge-proxy", "NPM_PROXY_NETWORK=edge-proxy-net",
                      "NPM_PROXY_CONTAINER_ID=" + "a" * 64,
                      "EXTERNAL_PG_CONTAINER=shared-pg", "EXTERNAL_PG_HOST=shared-pg", "EXTERNAL_PG_NETWORK=database-private",
                      "EXTERNAL_PG_CONTAINER_ID=" + "9" * 64, "EXTERNAL_PG_IMAGE_ID=sha256:" + "2" * 64,
                      "CADDY_EDGE_IP=192.0.2.2", "EDGE_SUBNET=192.0.2.0/24", "DB_USERNAME=folhea_app",
                      "KEYCLOAK_DB_USER=folhea_keycloak", "KEYCLOAK_DB_NAME=folhea_keycloak",
                      "FOLHEA_BACKEND_IMAGE=sha256:" + "d" * 64, "FOLHEA_CADDY_IMAGE=sha256:" + "d" * 64,
                      "FOLHEA_KEYCLOAK_IMAGE=sha256:" + "d" * 64, "FOLHEA_REDIS_IMAGE=sha256:" + "d" * 64]
            env_file.write_text("\n".join(lines) + "\n"); env_file.chmod(0o600)
            environment = {key: os.environ[key] for key in ["PATH", "HOME", "LANG"] if key in os.environ}
            command = ["docker", "compose", "--env-file", str(env_file), "-f", str(ROOT / "docker-compose.external-pg.yml"),
                       "-f", str(ROOT / "docker-compose.external-pg.runtime.yml"),
                       "config", "--format", "json"]
            rendered = subprocess.run(command, capture_output=True, check=True, env=environment)
            cls.model = json.loads(rendered.stdout)

    def invoke(self, model):
        return subprocess.run([sys.executable, str(GUARD), "--config-stdin"],
                              input=json.dumps(model), capture_output=True, text=True)

    def test_rendered_profile_has_no_public_ports_and_is_accepted(self):
        self.assertEqual(set(self.model["services"]), {"backend", "caddy", "keycloak", "redis"})
        self.assertNotIn("postgres", self.model["services"])
        self.assertEqual(self.model["services"]["backend"]["environment"]["DB_JDBC_URL"], "jdbc:postgresql://shared-pg:5432/folhea")
        self.assertEqual(self.model["services"]["caddy"].get("ports", []), [])
        result = self.invoke(self.model)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_backend_and_caddy_have_distinct_explicit_addresses_inside_subnet(self):
        import ipaddress
        edge = self.model['services']['backend']['networks']['edge']
        self.assertEqual(edge.get('ipv4_address'), '192.0.2.3', 'Dynamic backend can claim the dedicated Caddy IP first')
        self.assertIn('backend-edge', edge['aliases'])
        subnet = ipaddress.ip_network(self.model['networks']['edge']['ipam']['config'][0]['subnet'])
        caddy = self.model['services']['caddy']['networks']['edge']['ipv4_address']
        self.assertEqual(caddy, '192.0.2.2')
        self.assertNotEqual(edge['ipv4_address'], caddy)
        for address in (edge['ipv4_address'], caddy): self.assertIn(ipaddress.ip_address(address), subnet)

    def test_guard_rejects_static_edge_addresses_outside_subnet(self):
        for service in ('backend', 'caddy'):
            changed = copy.deepcopy(self.model)
            changed['services'][service]['networks']['edge']['ipv4_address'] = '203.0.113.3'
            if service == 'caddy': changed['services']['backend']['environment']['TRUSTED_PROXIES'] = '203.0.113.3'
            self.assertEqual(self.invoke(changed).returncode, 1, service)

    def test_guard_rejects_missing_empty_and_reserved_edge_addresses(self):
        for service in ("backend", "caddy"):
            cases = [
                ("missing", None), ("empty", ""), ("gateway", "192.0.2.1"),
                ("network", "192.0.2.0"), ("broadcast", "192.0.2.255"),
            ]
            for name, address in cases:
                with self.subTest(service=service, address=name):
                    model = copy.deepcopy(self.model)
                    edge = model["services"][service]["networks"]["edge"]
                    if address is None:
                        edge.pop("ipv4_address", None)
                    else:
                        edge["ipv4_address"] = address
                    if service == "caddy":
                        model["services"]["backend"]["environment"]["TRUSTED_PROXIES"] = address
                    result = self.invoke(model)
                    self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            with self.subTest(service=service, address="explicit-gateway"):
                model = copy.deepcopy(self.model)
                model["networks"]["edge"]["ipam"]["config"][0]["gateway"] = "192.0.2.9"
                model["services"][service]["networks"]["edge"]["ipv4_address"] = "192.0.2.9"
                if service == "caddy":
                    model["services"]["backend"]["environment"]["TRUSTED_PROXIES"] = "192.0.2.9"
                result = self.invoke(model)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

    def test_unsafe_models_fail_closed(self):
        mutations = [
            ("dynamic-backend-edge", lambda m: m["services"]["backend"]["networks"]["edge"].pop("ipv4_address", None)),
            ("duplicate-edge-ip", lambda m: m["services"]["backend"]["networks"]["edge"].update(ipv4_address="192.0.2.2")),
            ("host-port", lambda m: m["services"]["caddy"].update(ports=[{"target": 80, "published": "80"}])),
            ("backend-shared-network", lambda m: m["services"]["backend"]["networks"].update({"npm-proxy": {}})),
            ("wide-trust", lambda m: m["services"]["caddy"]["environment"].update(NPM_PROXY_IP="198.51.100.0/24")),
            ("changed-peer-id", lambda m: m["services"]["caddy"]["environment"].update(NPM_PROXY_CONTAINER_ID="")),
            ("wrong-host", lambda m: m["services"]["caddy"]["environment"].update(PUBLIC_DOMAIN="other.example")),
            ("wrong-origin", lambda m: m["services"]["backend"]["environment"].update(SECURITY_ALLOWED_ORIGINS="*")),
            ("wrong-issuer", lambda m: m["services"]["backend"]["environment"].update(OIDC_TOKEN_ISSUER="http://keycloak:8080/realms/folhea")),
            ("wrong-authorization-endpoint", lambda m: m["services"]["backend"]["environment"].update(OIDC_PUBLIC_AUTHORIZATION_URL="https://other.example/auth")),
            ("wrong-logout-endpoint", lambda m: m["services"]["backend"]["environment"].update(OIDC_PUBLIC_LOGOUT_URL="https://other.example/logout")),
            ("broad-bff-trust", lambda m: m["services"]["backend"]["environment"].update(TRUSTED_PROXIES="172.31.44.0/24")),
            ("public-edge", lambda m: m["networks"]["edge"].update(internal=False)),
            ("nonexternal-proxy", lambda m: m["networks"]["npm-proxy"].update(external=False)),
            ("wrong-shared-network", lambda m: m["networks"]["npm-proxy"].update(name="another-network")),
            ("missing-alias", lambda m: m["services"]["caddy"]["networks"]["npm-proxy"].update(aliases=[])),
            ("start-dev", lambda m: m["services"]["keycloak"].update(command=["start-dev"])),
            ("standalone-profile", lambda m: next(v for v in m["services"]["caddy"]["volumes"] if v["target"] == "/etc/caddy/Caddyfile").update(source=str(ROOT / "infra/Caddyfile"))),
            ("placeholder-secret", lambda m: m["services"]["backend"]["environment"].update(OIDC_CLIENT_SECRET="replace-with-a-long-but-unconfigured-secret")),
        ]
        for name, mutate in mutations:
            with self.subTest(name=name):
                model = copy.deepcopy(self.model); mutate(model)
                result = self.invoke(model)
                self.assertEqual(result.returncode, 1, name)
                self.assertIn("category=", result.stdout)

    def test_live_peer_metadata_requires_same_running_container_ip_and_network(self):
        self.assertTrue(GUARD.exists(), "NPM peer guard is missing")
        spec = importlib.util.spec_from_file_location("npm_guard", GUARD)
        guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)
        peer = {"id": "a" * 64, "running": True, "networks": {"edge-proxy-net": {"IPAddress": "198.51.100.2"}}}
        guard.validate_peer(self.model, peer)
        for field in ["id", "running", "networks"]:
            with self.subTest(field=field):
                changed = copy.deepcopy(peer)
                changed[field] = {"id": "b" * 64, "running": False, "networks": {"edge-proxy-net": {"IPAddress": "198.51.100.3"}}}[field]
                with self.assertRaises(guard.GuardFailure): guard.validate_peer(self.model, changed)
        with self.assertRaises(guard.GuardFailure):
            guard.validate_peer(self.model, {**peer, "networks": {"other-network": {"IPAddress": "198.51.100.2"}}})


def verify_edge_allocation(image):
    """Start backend before Caddy using the real rendered profile's edge IPs."""
    NpmComposeTest.setUpClass()
    model = NpmComposeTest.model
    prefix = "folhea-ipam-" + uuid.uuid4().hex[:12]
    created = []
    network_id = None

    def docker(*args):
        result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=20)
        if result.returncode:
            raise RuntimeError("edge IPAM Docker command failed: " + args[0] + ": " + result.stderr.strip())
        return result.stdout.strip()

    try:
        network_id = docker("network", "create", "--internal", "--subnet", "192.0.2.0/24",
                            "--gateway", "192.0.2.1", "--label",
                            "ao.session=" + os.environ.get("AO_SESSION_ID", "manual"), prefix)
        for service in ("backend", "caddy"):
            name = prefix + "-" + service
            edge = model["services"][service]["networks"]["edge"]
            command = ["create", "--pull=never", "--name", name, "--network", network_id,
                       "--label", "ao.session=" + os.environ.get("AO_SESSION_ID", "manual"),
                       "--memory=16m", "--cpus=0.1", "--cap-drop=ALL",
                       "--security-opt=no-new-privileges", "--entrypoint", "/bin/sleep"]
            if edge.get("ipv4_address"):
                command += ["--ip", edge["ipv4_address"]]
            docker(*command, image, "60")
            created.append(name)
            docker("start", name)
        for service, expected in (("backend", "192.0.2.3"), ("caddy", "192.0.2.2")):
            state = json.loads(docker("inspect", prefix + "-" + service))[0]
            assert state["State"]["Running"], service + " must remain running"
            assert state["NetworkSettings"]["Networks"][prefix]["IPAddress"] == expected, service + " edge IP"
        print("ok - real Docker IPAM: backend first, then dedicated Caddy; distinct profile IPs")
    finally:
        failures = []
        for name in reversed(created):
            result = subprocess.run(["docker", "rm", "--force", name], capture_output=True, timeout=20)
            if result.returncode:
                failures.append(name)
        if network_id:
            result = subprocess.run(["docker", "network", "rm", network_id], capture_output=True, timeout=20)
            if result.returncode:
                failures.append(prefix)
        if failures:
            raise RuntimeError("edge IPAM OWN cleanup failed: " + ", ".join(failures))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--edge-ipam":
        verify_edge_allocation(sys.argv[2])
    else:
        unittest.main()
