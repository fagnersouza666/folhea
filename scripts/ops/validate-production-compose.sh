#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT/.env}"
BASE="${COMPOSE_FILE:-$ROOT/docker-compose.yml}"
PROD="${COMPOSE_PROD_FILE:-$ROOT/docker-compose.prod.yml}"
# Parse Compose JSON without displaying its secret-bearing contents.
docker compose --env-file "$ENV_FILE" -f "$BASE" -f "$PROD" config --format json | python3 -c '
import json,sys,urllib.parse
config=json.load(sys.stdin)
services=config["services"]
kc=services["keycloak"]; backend=services["backend"]; caddy=services["caddy"]
assert "start-dev" not in kc["command"], "Production cannot use start-dev"
assert "--optimized" in kc["command"] and kc.get("build",{}).get("target")=="keycloak-runtime", "Production Keycloak requires the prebuilt target"
assert kc["environment"]["KC_HOSTNAME_STRICT"]=="true", "Production hostname must be strict"
for service in ["postgres","keycloak","redis","backend"]:
 assert not services[service].get("ports"), service+" must not publish ports"
origin=backend["environment"]["SECURITY_CANONICAL_ORIGIN"]
url=urllib.parse.urlsplit(origin)
assert url.scheme=="https" and not url.path and not url.query and not url.fragment, "Production origin must use HTTPS without a path"
assert kc["environment"]["KC_HOSTNAME"]==origin==caddy["environment"]["OIDC_PUBLIC_ORIGIN"], "Browser and IdP origins must match"
assert backend["environment"]["OIDC_TOKEN_ISSUER"]==origin+"/realms/folhea", "OIDC issuer must use canonical origin"
for service,fields in [("postgres",["POSTGRES_PASSWORD","KEYCLOAK_DB_PASSWORD"]),("backend",["OIDC_CLIENT_SECRET","OIDC_TOKEN_STATE_SECRET","KEYCLOAK_ADMIN_CLIENT_SECRET"]),("keycloak",["KC_BOOTSTRAP_ADMIN_PASSWORD"])]:
 for field in fields:
  value=services[service]["environment"][field]
  assert len(value)>=32 and not value.startswith("replace-with-"), field+" must be a configured secret with at least 32 characters"
assert not config["networks"]["edge"].get("internal",False), "Edge must support ACME and host publishing"
print("Production compose guard: OK (configuration only; no deployment performed)")
'
