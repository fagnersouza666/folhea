"""Selective AUTH-01 reconciliation; credentials stay in memory and Docker stdin."""
import argparse
import http.client
import io
import json
import subprocess
import urllib.parse


class OpsFailure(RuntimeError):
    pass


def reconcile(request):
    realm_path = "/admin/realms/folhea"
    realm = request("GET", realm_path)
    clients = []
    for client_id in ("folhea-api", "folhea-registration"):
        matches = request("GET", realm_path + "/clients?clientId=" + client_id)
        if not isinstance(matches, list) or len(matches) != 1 or not matches[0].get("id"):
            raise OpsFailure("expected-existing-client-missing-or-ambiguous")
        clients.append(matches[0])
    # Validate both clients before changing anything. Never create a client,
    # replace a realm, rotate a secret or read/update users and credentials.
    desired_realm = {
        "registrationAllowed": True, "registrationEmailAsUsername": True,
        "loginWithEmailAllowed": True, "loginTheme": "",
        "adminEventsEnabled": True, "adminEventsDetailsEnabled": False,
    }
    bff, service = clients
    desired_service = {
        "standardFlowEnabled": False, "directAccessGrantsEnabled": False,
        "serviceAccountsEnabled": True, "fullScopeAllowed": False,
        "attributes": {**(service.get("attributes") or {}), "access.token.lifespan": "300"},
    }
    changes = 0
    for path, current, desired in (
        (realm_path, realm, desired_realm),
        (realm_path + "/clients/" + bff["id"], bff, {"directAccessGrantsEnabled": False}),
        (realm_path + "/clients/" + service["id"], service, desired_service),
    ):
        patch = {key: value for key, value in desired.items() if current.get(key) != value}
        if patch:
            request("PUT", path, patch)
            changes += 1
        effective = request("GET", path)
        if any(effective.get(key) != value for key, value in desired.items()):
            raise OpsFailure("effective-configuration-verification-failed")
    return changes


class SocketFile:
    def __init__(self, data):
        self.data = data

    def makefile(self, _mode):
        return io.BytesIO(self.data)


class PrivateAdmin:
    def __init__(self, compose):
        env = resolved_admin_credentials(compose)
        result = subprocess.run(compose + ["ps", "-q", "keycloak"], check=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        container = result.stdout.decode().strip()
        if not container or "\n" in container:
            raise OpsFailure("expected-running-keycloak-container-missing")
        self.container = container
        self.token = None
        credentials = urllib.parse.urlencode({
            "grant_type": "password", "client_id": "admin-cli",
            "username": env["KC_BOOTSTRAP_ADMIN_USERNAME"],
            "password": env["KC_BOOTSTRAP_ADMIN_PASSWORD"],
        }).encode()
        issued = self.request("POST", "/realms/master/protocol/openid-connect/token",
                              credentials, "application/x-www-form-urlencoded")
        self.token = issued.get("access_token")
        if not self.token:
            raise OpsFailure("operational-admin-authentication-failed")

    def request(self, method, path, data=None, content_type="application/json"):
        body = data if isinstance(data, bytes) else json.dumps(data).encode() if data is not None else b""
        headers = {"Host": "localhost:8080", "Connection": "close", "Content-Length": str(len(body)),
                   "Content-Type": content_type, "Accept": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = (method + " " + path + " HTTP/1.1\r\n" +
                   "".join(key + ": " + value + "\r\n" for key, value in headers.items()) + "\r\n").encode() + body
        # No secret/password/bearer in argv, env exports, files or terminal.
        process = subprocess.run(["docker", "exec", "-i", self.container, "/bin/bash", "-c",
                                  "exec 3<>/dev/tcp/127.0.0.1/8080; cat >&3; cat <&3"],
                                 input=request, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 timeout=30, check=True)
        response = http.client.HTTPResponse(SocketFile(process.stdout))
        response.begin()
        payload = response.read(1_048_577)
        if len(payload) > 1_048_576:
            raise OpsFailure("administrative-response-size-limit")
        if response.status not in (200, 204):
            raise OpsFailure("administrative-request-http-" + str(response.status))
        return json.loads(payload) if payload else None


def resolved_admin_credentials(compose):
    # Compose owns dotenv syntax/interpolation and shell precedence. Capture its
    # resolved model only in memory; never print config, env, stderr or secrets.
    process = subprocess.run(compose + ["config", "--format", "json"], check=True,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    environment = json.loads(process.stdout)["services"]["keycloak"]["environment"]
    credentials = {key: environment.get(key) for key in
                   ("KC_BOOTSTRAP_ADMIN_USERNAME", "KC_BOOTSTRAP_ADMIN_PASSWORD")}
    if any(not isinstance(value, str) or not value for value in credentials.values()):
        raise OpsFailure("effective-operational-admin-credentials-missing")
    return credentials


def main():
    parser = argparse.ArgumentParser(description="Reconcile existing AUTH-01 realm without replacing users or secrets")
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--compose-file", required=True)
    args = parser.parse_args()
    try:
        admin = PrivateAdmin(["docker", "compose", "--env-file", args.env_file, "-f", args.compose_file])
        changed = reconcile(admin.request)
        print("AUTH-01 reconciled; effective configuration verified; changed resources=" + str(changed))
    except OpsFailure as error:
        print("AUTH-01 reconciliation failed category=" + str(error))
        raise SystemExit(1)
    except (KeyError, OSError, ValueError, subprocess.SubprocessError, http.client.HTTPException):
        print("AUTH-01 reconciliation failed category=configuration-or-private-transport")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
