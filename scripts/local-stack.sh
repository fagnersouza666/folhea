#!/usr/bin/env bash
# Isolated, persistent local stack. Never removes volumes or rewrites secrets.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
ENV_FILE="${FOLHEA_ENV_FILE:-$ROOT/.env}"
COMMAND="${1:-up}"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ "$COMMAND" != up && "$COMMAND" != init ]]; then
    echo 'Ambiente ainda não existe. Execute scripts/local-stack.sh init.' >&2
    exit 1
  fi
  umask 077
  python3 - "$ROOT/.env.example" "$ENV_FILE" <<'PY'
import os,re,secrets,sys
from pathlib import Path
text=Path(sys.argv[1]).read_text()
text=re.sub(r'replace-with-[^\n]+',lambda _:secrets.token_hex(32),text)
text=text.replace('AO_SESSION_ID=manual','AO_SESSION_ID='+os.environ.get('AO_SESSION_ID','manual'))
with open(sys.argv[2],'x') as output: output.write(text)
os.chmod(sys.argv[2],0o600)
PY
  echo 'Ambiente local criado com segredos aleatórios (arquivo .env protegido).'
fi
# Local operator-owned configuration, never print the rendered environment.
set -a
source "$ENV_FILE"
set +a
case "${PUBLIC_BIND_ADDRESS:-127.0.0.1}" in
  127.0.0.1|::1) ;;
  *) echo 'Este launcher aceita somente bind loopback. Use o runbook de produção.' >&2; exit 1 ;;
esac
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml)
case "$COMMAND" in
  init) echo 'Configuração pronta. Execute scripts/local-stack.sh up.' ;;
  up)
    "${COMPOSE[@]}" config --quiet
    "${COMPOSE[@]}" up -d --build --wait --wait-timeout 300
    echo "Folhea disponível em $OIDC_PUBLIC_ORIGIN — crie sua conta na tela de cadastro."
    echo 'Certificado local: importe a CA com scripts/local-stack.sh certificate.'
    ;;
  status) "${COMPOSE[@]}" ps ;;
  stop) "${COMPOSE[@]}" stop ;;
  start) "${COMPOSE[@]}" start --wait ;;
  certificate)
    destination="${2:-$ROOT/.local/caddy-root.crt}"
    mkdir -p "$(dirname "$destination")"
    "${COMPOSE[@]}" cp caddy:/data/caddy/pki/authorities/local/root.crt "$destination"
    echo "CA pública do Caddy salva em $destination. Importe-a no navegador/sistema local."
    ;;
  *) echo 'Uso: scripts/local-stack.sh [init|up|status|stop|start|certificate [arquivo]]' >&2; exit 1 ;;
esac
