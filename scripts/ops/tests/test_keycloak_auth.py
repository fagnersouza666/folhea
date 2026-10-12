import copy
import importlib.util
import pathlib
import unittest

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


if __name__ == "__main__":
    unittest.main()
