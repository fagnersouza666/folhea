#!/usr/bin/env bash
# Configures only explicitly supplied external providers; preserves users.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$ROOT"
ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT/.env}"
set -a
source "$ENV_FILE"
set +a
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml)
ACTION="${1:-diagnose}"
if [[ "$ACTION" == diagnose ]]; then
  for name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SMTP_HOST SMTP_FROM SMTP_USER SMTP_PASSWORD; do
    if [[ -n "${!name:-}" ]]; then printf '%s: configurado\n' "$name"; else printf '%s: ausente\n' "$name"; fi
  done
  echo "Callback Google: ${OIDC_PUBLIC_ORIGIN}/realms/folhea/broker/google/endpoint"
  exit 0
fi
if [[ "$ACTION" != apply && "$ACTION" != profile ]]; then echo 'Uso: configure-keycloak.sh [diagnose|profile|apply]' >&2; exit 1; fi

apply_json() {
  local operation="$1" resource="$2"
  "${COMPOSE[@]}" exec -T keycloak /bin/bash -c '
    set -euo pipefail
    umask 077
    config=$(mktemp)
    payload=$(mktemp)
    trap '\''rm -f "$config" "$payload"'\'' EXIT
    cat > "$payload"
    /opt/keycloak/bin/kcadm.sh config credentials --config "$config" \
      --server http://localhost:8080 --realm master \
      --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null 2>&1
    if [[ "$2" == realms/* ]]; then
      /opt/keycloak/bin/kcadm.sh "$1" "$2" --config "$config" -f "$payload" >/dev/null
    else
      /opt/keycloak/bin/kcadm.sh "$1" "$2" --config "$config" -r folhea -f "$payload" >/dev/null
    fi
  ' bash "$operation" "$resource"
}
if [[ "$ACTION" == profile ]]; then
  # Existing realms are not overwritten by startup import. Apply the v1
  # email/password profile explicitly, preserving all users and credentials.
  apply_json update users/profile < "$ROOT/infra/keycloak/user-profile.json"
  apply_json update realms/folhea <<'JSON'
{"internationalizationEnabled":true,"supportedLocales":["pt-BR"],"defaultLocale":"pt-BR"}
JSON
  echo 'Perfil v1 aplicado: nomes opcionais e login em português; usuários preservados.'
  exit 0
fi
if [[ -n "${GOOGLE_CLIENT_ID:-}" || -n "${GOOGLE_CLIENT_SECRET:-}" ]]; then
  [[ -n "${GOOGLE_CLIENT_ID:-}" && -n "${GOOGLE_CLIENT_SECRET:-}" ]] || { echo 'Google exige ID e secret juntos.' >&2; exit 1; }
  # The alias may already exist; update then create only on a 404.
  google_json=$(python3 - <<'PY'
import json,os
print(json.dumps({'alias':'google','providerId':'google','enabled':True,'trustEmail':False,'storeToken':False,'firstBrokerLoginFlowAlias':'first broker login','config':{'clientId':os.environ['GOOGLE_CLIENT_ID'],'clientSecret':os.environ['GOOGLE_CLIENT_SECRET'],'defaultScope':'openid email profile'}}))
PY
)
  if ! printf '%s' "$google_json" | apply_json update identity-provider/instances/google; then
    printf '%s' "$google_json" | apply_json create identity-provider/instances
  fi
  echo 'Google configurado. Cadastre o callback exibido por diagnose no console OAuth.'
fi
if [[ -n "${SMTP_HOST:-}" ]]; then
  [[ -n "${SMTP_FROM:-}" ]] || { echo 'SMTP exige remetente SMTP_FROM.' >&2; exit 1; }
  python3 - <<'PY' | apply_json update realms/folhea
import json,os
smtp={'host':os.environ['SMTP_HOST'],'port':os.environ.get('SMTP_PORT','587'),'from':os.environ['SMTP_FROM'],'starttls':os.environ.get('SMTP_STARTTLS','true'),'ssl':os.environ.get('SMTP_SSL','false'),'auth':str(bool(os.environ.get('SMTP_USER'))).lower()}
for field,env in [('user','SMTP_USER'),('password','SMTP_PASSWORD')]:
 if os.environ.get(env): smtp[field]=os.environ[env]
print(json.dumps({'smtpServer':smtp,'resetPasswordAllowed':True}))
PY
  echo 'SMTP configurado. Valide a entrega pelo console Keycloak antes do uso público.'
fi
