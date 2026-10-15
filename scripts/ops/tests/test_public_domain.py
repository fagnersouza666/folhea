"""Resolve the real Compose model without starting services or printing secrets."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]


class PublicDomainComposeTest(unittest.TestCase):
    def model(self, variables=None, production=False, env_file=None):
        environment = {key: value for key, value in os.environ.items()
                       if key in {"PATH", "HOME", "DOCKER_CONFIG"}}
        environment.update(variables or {})
        command = ["docker", "compose", "--env-file", str(env_file or ROOT / ".env.example"),
                   "-f", str(ROOT / "docker-compose.yml")]
        if production:
            command += ["-f", str(ROOT / "docker-compose.prod.yml")]
        result = subprocess.run(command + ["config", "--format", "json"],
                                env=environment, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, "Compose must resolve without starting services")
        return json.loads(result.stdout)["services"]

    def assert_origin(self, services, domain, origin):
        backend = services["backend"]["environment"]
        self.assertEqual(backend.get("PUBLIC_DOMAIN"), domain)
        self.assertEqual(backend.get("PUBLIC_ORIGIN"), origin)
        self.assertEqual(backend.get("OIDC_PUBLIC_ORIGIN"), origin)
        self.assertEqual(backend["SECURITY_CANONICAL_ORIGIN"], origin)
        self.assertEqual(backend["SECURITY_ALLOWED_ORIGINS"], origin)
        self.assertEqual(backend["OIDC_TOKEN_ISSUER"], origin + "/realms/folhea")
        self.assertEqual(backend["OIDC_PUBLIC_AUTHORIZATION_URL"],
                         origin + "/realms/folhea/protocol/openid-connect/auth")
        self.assertEqual(backend["OIDC_PUBLIC_LOGOUT_URL"],
                         origin + "/realms/folhea/protocol/openid-connect/logout")
        self.assertEqual(backend["OIDC_AUTH_SERVER_URL"], "http://keycloak:8080/realms/folhea")
        self.assertEqual(backend["CORS_ENABLED"], "false")
        self.assertEqual(services["keycloak"]["environment"]["KC_HOSTNAME"], origin)
        self.assertEqual(services["caddy"]["environment"]["OIDC_PUBLIC_ORIGIN"], origin)

    def test_local_compose_uses_its_explicit_tls_port(self):
        self.assert_origin(self.model(), "localhost", "https://localhost:9443")

    def test_domain_and_port_changes_reach_all_browser_endpoints(self):
        services = self.model({"PUBLIC_DOMAIN": "preview.example", "HTTPS_PORT": "9447"})
        self.assert_origin(services, "preview.example", "https://preview.example:9447")

    def test_production_origin_without_local_port(self):
        services = self.model({"PUBLIC_DOMAIN": "folhea.app", "PUBLIC_ORIGIN": "https://folhea.app"},
                              production=True)
        self.assert_origin(services, "folhea.app", "https://folhea.app")
        self.assertIn("--optimized", services["keycloak"]["command"])

    def test_explicit_token_issuer_override_is_preserved(self):
        issuer = "https://preview.example/realms/folhea"
        services = self.model({"OIDC_TOKEN_ISSUER": issuer})
        self.assertEqual(services["backend"]["environment"]["OIDC_TOKEN_ISSUER"], issuer)

    def test_explicit_cors_origins_override_is_preserved(self):
        origins = "https://preview.example"
        services = self.model({"CORS_ORIGINS": origins})
        self.assertEqual(services["backend"]["environment"].get("CORS_ORIGINS"), origins)

    def test_local_frontend_and_idp_can_use_distinct_origins(self):
        services = self.model({"PUBLIC_ORIGIN": "http://localhost:4200",
                               "OIDC_PUBLIC_ORIGIN": "http://localhost:8180"})
        backend = services["backend"]["environment"]
        self.assertEqual(backend["PUBLIC_ORIGIN"], "http://localhost:4200")
        self.assertEqual(backend["SECURITY_CANONICAL_ORIGIN"], "http://localhost:4200")
        self.assertEqual(backend["SECURITY_ALLOWED_ORIGINS"], "http://localhost:4200")
        self.assertEqual(backend["OIDC_PUBLIC_ORIGIN"], "http://localhost:8180")
        self.assertEqual(backend["OIDC_TOKEN_ISSUER"], "http://localhost:8180/realms/folhea")
        self.assertEqual(services["keycloak"]["environment"]["KC_HOSTNAME"],
                         "http://localhost:8180")

    def test_legacy_env_without_public_origin_keeps_its_explicit_oidc_origin(self):
        origin = "https://localhost:9443"
        with tempfile.TemporaryDirectory(prefix="folhea-domain-config-") as directory:
            fixture = Path(directory) / "legacy.env"
            lines = []
            for line in (ROOT / ".env.example").read_text().splitlines():
                name = line.partition("=")[0]
                if name == "PUBLIC_ORIGIN":
                    continue
                if name in {"OIDC_PUBLIC_ORIGIN", "SECURITY_CANONICAL_ORIGIN",
                            "SECURITY_ALLOWED_ORIGINS", "CORS_ORIGINS"}:
                    line = name + "=" + origin
                lines.append(line)
            fixture.write_text("\n".join(lines) + "\n")
            fixture.chmod(0o600)
            self.assert_origin(self.model(env_file=fixture), "localhost", origin)


if __name__ == "__main__":
    unittest.main()
