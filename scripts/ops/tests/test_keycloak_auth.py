import copy
import importlib.util
import json
import os
import pathlib
import secrets
import subprocess
import tempfile
import unittest
from unittest.mock import patch

module_file = pathlib.Path(__file__).parents[1] / "keycloak-auth.py"
spec = importlib.util.spec_from_file_location("keycloak_auth", module_file)
auth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auth)


class ExistingRealm:
    def __init__(self):
        self.realm = {
            "registrationAllowed": False,
            "registrationEmailAsUsername": False,
            "loginWithEmailAllowed": True,
            "loginTheme": "old-theme",
            "adminEventsEnabled": False,
            "adminEventsDetailsEnabled": True,
            "smtpServer": {"host": "existing.example"},
        }
        self.clients = {
            "folhea-api": {"id": "bff", "directAccessGrantsEnabled": True,
                           "secret": "unchanged-bff-fixture", "redirectUris": ["https://existing.example/auth/callback"]},
            "folhea-registration": {"id": "service", "standardFlowEnabled": True,
                "directAccessGrantsEnabled": True, "serviceAccountsEnabled": True,
                "fullScopeAllowed": True, "secret": "unchanged-service-fixture",
                "attributes": {"access.token.lifespan": "3600", "existing.attribute": "retain"}},
        }
        self.users = [{"enabled": True, "credential": "unchanged-fixture"}]
        self.writes = []

    def request(self, method, path, data=None):
        if method == "GET":
            if path.endswith("/clients/bff"):
                return copy.deepcopy(self.clients["folhea-api"])
            if path.endswith("/clients/service"):
                return copy.deepcopy(self.clients["folhea-registration"])
            if path.endswith("/clients?clientId=folhea-api"):
                return [copy.deepcopy(self.clients["folhea-api"])]
            if path.endswith("/clients?clientId=folhea-registration"):
                return [copy.deepcopy(self.clients["folhea-registration"])]
            return copy.deepcopy(self.realm)
        self.writes.append((method, path, copy.deepcopy(data)))
        if path.endswith("/clients/bff"):
            self.clients["folhea-api"].update(data)
        elif path.endswith("/clients/service"):
            self.clients["folhea-registration"].update(data)
        else:
            self.realm.update(data)


class ReconcileAuthTest(unittest.TestCase):
    def test_existing_realm_selective_and_idempotent(self):
        transport = ExistingRealm()
        users = copy.deepcopy(transport.users)
        secrets = [client["secret"] for client in transport.clients.values()]
        self.assertEqual(auth.reconcile(transport.request), 3)
        self.assertTrue(transport.realm["registrationAllowed"])
        self.assertTrue(transport.realm["registrationEmailAsUsername"])
        self.assertEqual(transport.realm["loginTheme"], "")
        self.assertTrue(transport.realm["adminEventsEnabled"])
        self.assertFalse(transport.realm["adminEventsDetailsEnabled"])
        self.assertEqual(transport.realm["smtpServer"], {"host": "existing.example"})
        service = transport.clients["folhea-registration"]
        self.assertEqual(service["attributes"], {"access.token.lifespan": "300", "existing.attribute": "retain"})
        self.assertFalse(service["standardFlowEnabled"])
        self.assertFalse(service["directAccessGrantsEnabled"])
        self.assertFalse(service["fullScopeAllowed"])
        self.assertFalse(transport.clients["folhea-api"]["directAccessGrantsEnabled"])
        self.assertEqual(transport.clients["folhea-api"]["redirectUris"], ["https://existing.example/auth/callback"])
        self.assertEqual(transport.users, users)
        self.assertEqual([client["secret"] for client in transport.clients.values()], secrets)
        self.assertTrue(all("secret" not in data for _, _, data in transport.writes))
        self.assertEqual(auth.reconcile(transport.request), 0)
        self.assertEqual(len(transport.writes), 3)

    def test_missing_service_client_fails_before_any_write(self):
        transport = ExistingRealm()
        def request(method, path, data=None):
            if path.endswith("clients?clientId=folhea-registration"):
                return []
            return transport.request(method, path, data)
        with self.assertRaises(auth.OpsFailure):
            auth.reconcile(request)
        self.assertEqual(transport.writes, [])

    def test_ambiguous_bff_client_fails_before_any_write(self):
        transport = ExistingRealm()
        def request(method, path, data=None):
            if path.endswith("clients?clientId=folhea-api"):
                return [{"id": "one"}, {"id": "two"}]
            return transport.request(method, path, data)
        with self.assertRaises(auth.OpsFailure):
            auth.reconcile(request)
        self.assertEqual(transport.writes, [])


class ComposeCredentialsTest(unittest.TestCase):
    def compare_effective(self, value, expected, environment=None):
        with tempfile.TemporaryDirectory(prefix="folhea-auth-env-") as temporary:
            root = pathlib.Path(temporary)
            env_file = root / "fixture.env"
            env_file.write_text("KEYCLOAK_ADMIN_USERNAME=admin-fixture\n" + value)
            env_file.chmod(0o600)
            compose_file = root / "compose.json"
            compose_file.write_text(json.dumps({"name": "folhea-auth-env-test", "services": {"keycloak": {
                "image": "unused-fixture", "environment": {
                    "KC_BOOTSTRAP_ADMIN_USERNAME": "${KEYCLOAK_ADMIN_USERNAME}",
                    "KC_BOOTSTRAP_ADMIN_PASSWORD": "${KEYCLOAK_ADMIN_PASSWORD}",
                }}}}))
            compose_file.chmod(0o600)
            compose = ["docker", "compose", "--env-file", str(env_file), "-f", str(compose_file)]
            fixture_environment = {key: value for key, value in os.environ.items()
                                   if key not in ("KEYCLOAK_ADMIN_USERNAME", "KEYCLOAK_ADMIN_PASSWORD", "ADMIN_SECRET")}
            fixture_environment.update(environment or {})
            with patch.dict(os.environ, fixture_environment, clear=True):
                # Real Compose resolution; no container or secret output.
                result = subprocess.run(compose + ["config", "--format", "json"], check=True,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                effective = json.loads(result.stdout)["services"]["keycloak"]["environment"]
                self.assertTrue(effective["KC_BOOTSTRAP_ADMIN_PASSWORD"] == expected,
                                "Compose must resolve the private fixture correctly")
                self.assertTrue(auth.resolved_admin_credentials(compose) == effective,
                                "Operational credentials must match effective Compose values")

    def test_literal_hash_matches_real_compose(self):
        value = secrets.token_urlsafe(12) + "#" + secrets.token_urlsafe(12)
        self.compare_effective("KEYCLOAK_ADMIN_PASSWORD=" + value + "\n", value)

    def test_env_file_interpolation_matches_real_compose(self):
        value = secrets.token_urlsafe(24)
        self.compare_effective("ADMIN_SECRET=" + value + "\nKEYCLOAK_ADMIN_PASSWORD=${ADMIN_SECRET}\n", value)

    def test_shell_precedence_matches_real_compose(self):
        file_value, shell_value = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
        self.compare_effective("KEYCLOAK_ADMIN_PASSWORD=" + file_value + "\n", shell_value,
                               {"KEYCLOAK_ADMIN_PASSWORD": shell_value})


if __name__ == "__main__":
    unittest.main()
