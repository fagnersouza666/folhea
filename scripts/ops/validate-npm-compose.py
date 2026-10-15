#!/usr/bin/env python3
"""Read-only NPM deployment guard; never prints resolved secrets or writes Docker."""
import argparse
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = "https://folhea.app"


class GuardFailure(RuntimeError):
    pass


def require(condition, category):
    if not condition:
        raise GuardFailure(category)


def validate_model(config):
    services = config["services"]
    external = "x-folhea-external-postgres" in config
    require(external, "external-pg-profile-required")
    validate_external_model(config)
    caddy = services["caddy"]; backend = services["backend"]; kc = services["keycloak"]
    edge = caddy["environment"]; bff = backend["environment"]
    for name in services:
        require(not services[name].get("ports"), "host-port-forbidden")
    require(edge["PUBLIC_DOMAIN"] == "folhea.app", "canonical-host-required")
    require(edge["OIDC_PUBLIC_ORIGIN"] == bff["SECURITY_CANONICAL_ORIGIN"] ==
            bff["SECURITY_ALLOWED_ORIGINS"] == kc["environment"]["KC_HOSTNAME"] == ORIGIN,
            "canonical-origin-required")
    require(bff["OIDC_TOKEN_ISSUER"] == ORIGIN + "/realms/folhea", "canonical-issuer-required")
    require(bff["OIDC_PUBLIC_AUTHORIZATION_URL"] == ORIGIN + "/realms/folhea/protocol/openid-connect/auth",
            "canonical-provider-endpoint-required")
    require(bff["OIDC_PUBLIC_LOGOUT_URL"] == ORIGIN + "/realms/folhea/protocol/openid-connect/logout",
            "canonical-provider-endpoint-required")
    require(bff["CORS_ENABLED"] == "false", "same-origin-cors-required")
    try:
        peer = ipaddress.ip_address(edge["NPM_PROXY_IP"])
    except ValueError:
        raise GuardFailure("single-peer-ip-required") from None
    require(peer.version == 4 and not peer.is_unspecified and not peer.is_multicast,
            "single-peer-ip-required")
    require(re.fullmatch(r"[0-9a-f]{64}", edge["NPM_PROXY_CONTAINER_ID"]) is not None,
            "observed-peer-container-id-required")
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", edge["NPM_PROXY_CONTAINER"]) is not None,
            "peer-container-name-required")
    require(config["networks"]["npm-proxy"].get("external") is True and
            config["networks"]["npm-proxy"]["name"] == edge["NPM_PROXY_NETWORK"] and
            re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", edge["NPM_PROXY_NETWORK"]), "existing-proxy-network-required")
    require(config["networks"]["edge"].get("internal") is True, "private-edge-required")
    subnets = config["networks"]["edge"]["ipam"]["config"]
    require(len(subnets) == 1, "single-exclusive-edge-subnet-required")
    subnet = ipaddress.ip_network(subnets[0]["subnet"])
    require(subnet.version == 4, "ipv4-edge-subnet-required")
    gateway = ipaddress.ip_address(subnets[0].get("gateway", str(subnet.network_address + 1)))
    require(gateway in subnet and gateway not in (subnet.network_address, subnet.broadcast_address),
            "usable-edge-gateway-required")
    for service in ("backend", "caddy"):
        address = services[service]["networks"]["edge"].get("ipv4_address")
        require(isinstance(address, str) and bool(address), "explicit-edge-ip-required-" + service)
    assigned = set()
    for service in services.values():
        address = service["networks"].get("edge", {}).get("ipv4_address")
        if address:
            ip = ipaddress.ip_address(address)
            require(ip in subnet and ip not in (subnet.network_address, subnet.broadcast_address, gateway),
                    "static-edge-ip-outside-usable-subnet")
            require(ip not in assigned, "duplicate-static-edge-ip")
            assigned.add(ip)
    require("backend-edge" in backend["networks"]["edge"].get("aliases", []), "backend-edge-alias-required")
    require("folhea-caddy" in caddy["networks"]["npm-proxy"].get("aliases", []), "unique-proxy-alias-required")
    for name in services.keys() - {"caddy"}:
        require("npm-proxy" not in services[name]["networks"], "shared-network-service-forbidden")
    caddy_ip = caddy["networks"]["edge"]["ipv4_address"]
    require(bff["TRUSTED_PROXIES"] == caddy_ip, "bff-single-caddy-trust-required")
    mounts = [item for item in caddy.get("volumes", []) if item["target"] == "/etc/caddy/Caddyfile"]
    require(len(mounts) == 1 and mounts[0].get("read_only") is True and
            mounts[0]["source"] == str(ROOT / "infra/Caddyfile.npm"), "private-http-profile-required")
    require("start-dev" not in kc["command"] and "--optimized" in kc["command"] and
            kc["environment"]["KC_HOSTNAME_STRICT"] == "true", "optimized-strict-provider-required")
    secrets = [("redis", ["REDIS_PASSWORD"]),
               ("keycloak", ["KC_BOOTSTRAP_ADMIN_PASSWORD", "KC_DB_PASSWORD"]),
               ("backend", ["DB_PASSWORD", "OIDC_CLIENT_SECRET", "OIDC_TOKEN_STATE_SECRET", "KEYCLOAK_ADMIN_CLIENT_SECRET"])]
    if not external:
        secrets.append(("postgres", ["POSTGRES_PASSWORD", "KEYCLOAK_DB_PASSWORD"]))
    for service, fields in secrets:
        for field in fields:
            value = services[service]["environment"][field]
            require(isinstance(value, str) and len(value) >= 32 and not value.startswith("replace-with-"),
                    "secret-not-configured-" + field)


def validate_external_model(config):
    services = config["services"]
    require(set(services) == {"backend", "caddy", "keycloak", "redis"}, "four-own-services-no-managed-pg-required")
    meta = config["x-folhea-external-postgres"]
    require(all(isinstance(meta[k], str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", meta[k])
                for k in ("container", "host", "network")) and meta["port"] == 5432 and meta["version"] == "16.13",
            "reviewed-shared-pg-required")
    require(re.fullmatch(r"[0-9a-f]{64}", meta["container_id"]) is not None and
            re.fullmatch(r"sha256:[0-9a-f]{64}", meta["image_id"]) is not None, "observed-shared-pg-identity-required")
    require(config["networks"]["postgres-external"].get("external") is True and
            config["networks"]["postgres-external"]["name"] == meta["network"], "existing-private-pg-network-required")
    require("folhea-postgres" not in config.get("volumes", {}), "shared-pg-volume-forbidden")
    bff = services["backend"]["environment"]; kc = services["keycloak"]["environment"]
    require(bff["DB_USERNAME"] == "folhea_app" and kc["KC_DB_USERNAME"] == "folhea_keycloak",
            "dedicated-db-roles-required")
    require(bff["DB_JDBC_URL"] == "jdbc:postgresql://" + meta["host"] + ":5432/folhea" and
            kc["KC_DB_URL"] == "jdbc:postgresql://" + meta["host"] + ":5432/folhea_keycloak", "dedicated-private-databases-required")
    require(bff["QUARKUS_DATASOURCE_JDBC_MAX_SIZE"] == kc["KC_DB_POOL_MAX_SIZE"] == "10", "bounded-db-pools-required")
    require(bff["QUARKUS_DATASOURCE_JDBC_INITIAL_SIZE"] == bff["QUARKUS_DATASOURCE_JDBC_MIN_SIZE"] == "0" and kc["KC_DB_POOL_MIN_SIZE"] == kc["KC_DB_POOL_INITIAL_SIZE"] == "1", "bounded-initial-db-pools-required")
    for name, service in services.items():
        require("postgres" not in service.get("depends_on", {}), "shared-pg-dependency-lifecycle-forbidden")
        require(("postgres-external" in service["networks"]) == (name in ("backend", "keycloak")),
                "only-db-clients-on-pg-network-required")


def validate_external_peer(config, peer):
    meta = config["x-folhea-external-postgres"]
    require(peer["running"] is True and peer["health"] == "healthy", "shared-pg-not-healthy")
    require(peer["id"] == meta["container_id"] and peer["image"] == meta["image_id"], "shared-pg-identity-changed")
    network = peer["networks"].get(meta["network"])
    require(network is not None and meta["host"] in network.get("Aliases", []), "shared-pg-private-dns-changed")
    require(config["networks"]["npm-proxy"]["name"] not in peer["networks"], "shared-pg-on-npm-network-forbidden")


def validate_peer(config, peer):
    expected = config["services"]["caddy"]["environment"]
    require(peer["running"] is True, "existing-proxy-not-running")
    require(peer["id"] == expected["NPM_PROXY_CONTAINER_ID"], "existing-proxy-container-changed")
    network = peer["networks"].get(expected["NPM_PROXY_NETWORK"])
    require(network is not None and network["IPAddress"] == expected["NPM_PROXY_IP"],
            "existing-proxy-ip-or-network-changed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--env-file")
    source.add_argument("--config-stdin", action="store_true", help="Read a resolved Compose model without echoing it")
    parser.add_argument("--external-postgres", action="store_true", help="Use the four-service existing-PG profile")
    parser.add_argument("--verify-peer", action="store_true", help="Also verify the existing running NPM metadata; mandatory before applying")
    args = parser.parse_args()
    try:
        if args.config_stdin:
            config = json.load(sys.stdin)
        else:
            command = ["docker", "compose", "--env-file", args.env_file]
            paths = ["docker-compose.external-pg.yml"]
            for path in paths:
                command += ["-f", str(ROOT / path)]
            resolved = subprocess.run(command + ["config", "--format", "json"],
                                      capture_output=True, check=True, timeout=30)
            config = json.loads(resolved.stdout)
        validate_model(config)
        if args.verify_peer:
            name = config["services"]["caddy"]["environment"]["NPM_PROXY_CONTAINER"]
            inspect = subprocess.run(["docker", "inspect", "--format",
                                      "{{json .Id}}|{{json .State.Running}}|{{json .NetworkSettings.Networks}}", name],
                                     capture_output=True, check=True, text=True, timeout=15)
            container_id, running, networks = [json.loads(x) for x in inspect.stdout.strip().split("|")]
            validate_peer(config, {"id": container_id, "running": running, "networks": networks})
        print("NPM compose guard: OK; " + ("existing peer verified; no changes applied" if args.verify_peer else "configuration only; live peer NOT checked"))
    except GuardFailure as error:
        print("NPM compose guard failed category=" + str(error)); return 1
    except (KeyError, TypeError, ValueError, OSError, subprocess.SubprocessError):
        print("NPM compose guard failed category=configuration-or-metadata-unavailable"); return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
