#!/usr/bin/env bash
# Interface fina da engine publicada; não contém decisões de deploy ou rollback.
set -euo pipefail

die() { printf 'deploy-shell: %s\n' "$1" >&2; exit 2; }
usage() {
  printf '%s\n' 'Produção em uma chamada:
  scripts/ops/deploy-folhea.sh --production [--config ARQUIVO.json] [--dry-run]
  Config padrão: FOLHEA_DEPLOY_CONFIG ou $HOME/.config/folhea/deploy.json.
  --production executa de verdade; --dry-run apenas planeja, sem acesso remoto.
  Exige terminal e revisão explícita após os backups, antes de registrar/ativar.

Modos avançados preservados:
  scripts/ops/deploy-folhea.sh [--stage|--review|--activate] [--execute|--dry-run]
  --source SHA40          Padrão: HEAD limpo do checkout deste script.
  --host USER@HOST        Alvo SSH explícito, sem senha ou opções SSH.
  --remote-root PATH      Raiz exclusiva remota Folhea.
  --project-name NAME     Namespace Compose explícito.
  --server-address IP     Endereço literal esperado, revisado pelo operador.
  --output PATH          Stage: diretório local novo, absoluto, fora do Git.
  --expected-current SHA Review/activate: SHA40 atual confirmado no servidor.
  --backup-evidence PATH Review: novo recibo remoto; activate: recibo validado.
  --app-backup PATH      Review: dump APP remoto existente, cliente PG16.
  --idp-backup PATH      Review: dump KC remoto existente, cliente PG16.
  --schema-compatible-reviewed  Declaração EXPLÍCITA do operador após revisão.

Nos modos avançados, PLAN por padrão. --source explícito no plano não consulta Git nem cria processos.
Sem --source, o plano lê HEAD/status com Git; não grava o índice.
--execute --stage prepara e transfere; PARA e NÃO publica a versão.
Depois dos backups e da revisão humana: --execute --review registra o recibo.
Somente --execute --activate pode promover a candidata, por meio da engine.
O shell não cria backups, decide compatibilidade ou lê production.env.
Configuração privada: REMOTE_ROOT/production.env, validada apenas pela engine.
Toolchains/cache: PATH, JAVA_HOME, TRIVY_CACHE_DIR somente neste processo.
Não há fresh, skip de gates ou recovery implícito. A produção usa a mesma engine.'
}

phase=stage phase_set=0 execute=0 dry_run=0
source_sha= host= remote_root= project= address= output= expected= evidence= app_backup= idp_backup=
reviewed=0 production=0 config= output_parent=
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --execute) execute=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    --production) production=1; shift ;;
    --stage|--review|--activate)
      ((phase_set == 0)) || die 'escolha somente uma ação.'
      phase=${1#--}; phase_set=1; shift ;;
    --schema-compatible-reviewed) reviewed=1; shift ;;
    --source|--host|--remote-root|--project-name|--server-address|--output|--expected-current|--backup-evidence|--app-backup|--idp-backup|--config)
      (($# >= 2)) && [[ -n $2 ]] || die 'opção exige um valor.'
      case "$1" in
        --source) source_sha=$2 ;; --host) host=$2 ;; --remote-root) remote_root=$2 ;;
        --project-name) project=$2 ;; --server-address) address=$2 ;; --output) output=$2 ;;
        --expected-current) expected=$2 ;; --backup-evidence) evidence=$2 ;;
        --app-backup) app_backup=$2 ;; --idp-backup) idp_backup=$2 ;;
        --config) config=$2 ;;
      esac
      shift 2 ;;
    *) die 'opção desconhecida; use --help. Valores não são registrados.' ;;
  esac
done
((execute == 0 || dry_run == 0)) || die '--execute e --dry-run são incompatíveis.'
if ((production)); then
  ((phase_set == 0 && execute == 0 && reviewed == 0)) || die 'não combine produção com ações avançadas ou aprovação antecipada.'
  [[ -z $host$remote_root$project$address$evidence$app_backup$idp_backup ]] || die 'produção usa o alvo do JSON e produz seus próprios backups/recibo.'
  config=${config:-${FOLHEA_DEPLOY_CONFIG:-$HOME/.config/folhea/deploy.json}}
  configuration=$(python3 -B - "$config" <<'CONFIG_PY'
import json, os, stat, sys
from pathlib import Path
try:
    path = Path(sys.argv[1])
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError()
    data = json.loads(path.read_text())
    keys = ('host', 'remote_root', 'project_name', 'server_address', 'output_parent')
    if not isinstance(data, dict) or set(data) != set(keys):
        raise ValueError()
    if any(not isinstance(data[k], str) or not data[k] or any(c in data[k] for c in '\r\n\0') for k in keys):
        raise ValueError()
    if not Path(data['output_parent']).is_absolute():
        raise ValueError()
    for key in keys:
        print(data[key])
except (OSError, ValueError, TypeError):
    print('deploy-shell: configuração JSON inválida; use somente os cinco metadados não secretos, arquivo próprio 0600.', file=sys.stderr)
    sys.exit(2)
CONFIG_PY
  ) || die 'configuração de produção recusada.'
  mapfile -t fields <<< "$configuration"
  ((${#fields[@]} == 5)) || die 'configuração incompleta.'
  host=${fields[0]} remote_root=${fields[1]} project=${fields[2]} address=${fields[3]} output_parent=${fields[4]}
  phase=production
  execute=$((1 - dry_run))
else
  [[ -z $config ]] || die '--config pertence ao modo --production.'
fi
[[ -n $host && -n $remote_root && -n $project && -n $address ]] || die 'informe host, remote-root, project-name e server-address explicitamente.'
if [[ -n $source_sha ]]; then
  [[ $source_sha =~ ^[0-9a-f]{40}$ ]] || die '--source exige SHA completo de 40 caracteres hexadecimais minúsculos.'
fi
case "$phase" in
  stage)
    [[ $output == /* ]] || die 'stage exige --output absoluto, novo e fora do Git.' ;;
  review|activate)
    [[ $expected =~ ^[0-9a-f]{40}$ ]] || die 'informe --expected-current completo e confirmado.'
    [[ $evidence == /* ]] || die 'informe --backup-evidence remoto absoluto.'
    ((reviewed == 1)) || die 'a revisão humana de compatibilidade precisa ser declarada explicitamente.'
    if [[ $phase == review ]]; then
      [[ $app_backup == /* && $idp_backup == /* ]] || die 'review exige os dois dumps remotos reais APP e KC.'
    fi ;;
  production)
    [[ -z $expected || $expected =~ ^[0-9a-f]{40}$ ]] || die '--expected-current exige SHA completo.'
    ;;
esac

target=(--host "$host" --remote-root "$remote_root" --project-name "$project" --server-address "$address")
print_command() { printf '  '; printf '%q ' "$@"; printf '\n'; }
quote_remote() {
  local argument escaped
  remote_command=
  for argument in "$@"; do
    escaped=${argument//\'/\'\\\'\'}
    remote_command+="${remote_command:+ }'$escaped'"
  done
  ssh_command=(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -- "$host" "$remote_command")
}
build_remote_command() {
  local -a arguments=(python3 -B "$remote_root/releases/$source_sha/scripts/ops/deploy-folhea.py")
  if [[ $phase == review ]]; then
    arguments+=(--record-backup-review --source "$source_sha" --expected-current "$expected"
      --schema-compatible-reviewed --backup-evidence "$evidence" --app-backup "$app_backup" --idp-backup "$idp_backup")
  else
    arguments+=(--activate --source "$source_sha" --installation upgrade --expected-current "$expected"
      --schema-compatible-reviewed --backup-evidence "$evidence")
  fi
  arguments+=("${target[@]}")
  quote_remote "${arguments[@]}"
}
print_plan() {
  printf 'PLANO: ação=%s fonte=%s; nenhuma execução autorizada.\n' "$phase" "$source_sha"
  case "$phase" in
    stage)
      print_command python3 -B scripts/ops/deploy-folhea.py --prepare --source "$source_sha" --output "$output" "${target[@]}"
      print_command python3 -B scripts/ops/deploy-folhea.py --transfer --source "$source_sha" --bundle "$output/release" "${target[@]}"
      printf '%s\n' '  PARA após transferir; stage NÃO publica. Crie os backups e revise a compatibilidade antes de review/activate.' ;;
    review|activate)
      build_remote_command
      print_command "${ssh_command[@]}" ;;
    production)
      printf '%s\n' '  Validar HEAD/configuração/terminal; observar current e manter CAS.'
      printf '%s\n' '  Mesma engine: prepare → transfer → backups APP+KC PG16 → revisão explícita → record → activate.'
      printf '%s\n' '  Sem SSH, Docker, build ou escrita neste plano; não é prova de disponibilidade/compatibilidade.' ;;
  esac
}

# Deliberadamente antes de resolver paths/Git ou invocar qualquer executável.
if ((execute == 0)) && [[ -n $source_sha ]]; then print_plan; exit 0; fi

[[ ! -L ${BASH_SOURCE[0]} ]] || die 'execute o script real do checkout, sem symlink.'
script_directory=${BASH_SOURCE[0]%/*}
repo=$(cd -- "$script_directory/../.." && pwd -P) || die 'checkout indisponível.'
engine=$repo/scripts/ops/deploy-folhea.py
[[ -f $engine && ! -L $engine ]] || die 'engine confiável deve ser arquivo regular do checkout.'
head=$(git -C "$repo" rev-parse --verify HEAD) || die 'HEAD commitado é obrigatório.'
source_sha=${source_sha:-$head}
ensure_source() {
  local checkout_status
  [[ $(git -C "$repo" rev-parse --show-toplevel) == "$repo" ]] || die 'script fora da raiz Git esperada.'
  git -C "$repo" ls-files --error-unmatch -- scripts/ops/deploy-folhea.py >/dev/null || die 'engine precisa estar versionada.'
  [[ $(git -C "$repo" rev-parse --verify HEAD) == "$source_sha" ]] || die 'checkout difere do source; selecione a revisão em um checkout próprio.'
  checkout_status=$(GIT_OPTIONAL_LOCKS=0 git -C "$repo" status --porcelain) || die 'não foi possível verificar o estado do checkout; nenhuma ação será executada.'
  [[ -z $checkout_status ]] || die 'HEAD precisa estar limpo e commitado, inclusive sem arquivos novos.'
}
ensure_source
if ((production && execute)); then
  [[ -t 0 ]] || die 'produção exige terminal para a revisão explícita antes de qualquer build ou acesso remoto.'
fi
if ((execute == 0)); then print_plan; exit 0; fi

production_bridge() {
  quote_remote python3 -B - "$1" "$remote_root" "$host" "$project" "$address" "$source_sha" "${expected:-}"
  "${ssh_command[@]}" <<'PRODUCTION_PY'
# Orchestration only: guards belong to the published engine; backups and
# recovery assertions use its existing scripts, never another deploy engine.
import importlib.util, json, os, re, stat, sys, tempfile
from pathlib import Path
os.umask(0o077)
mode, root, host, project, address, source, previous = sys.argv[1:]
try:
    base = Path(root)
    if mode not in ('inspect', 'backup') or not re.fullmatch('[0-9a-f]{40}', source):
        raise ValueError()
    active = (base / 'current').resolve(strict=True)
    if active.parent != base / 'releases' or not re.fullmatch('[0-9a-f]{40}', active.name):
        raise ValueError()
    release = active if mode == 'inspect' else base / 'releases' / source
    spec = importlib.util.spec_from_file_location('production_engine', release / 'scripts/ops/deploy-folhea.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.configure_target(host, root, project, address)
    _, _, env_file = module.activation_paths(release.name)
    module.require(not module.pending_recovery(base), 'pending-recovery-requires-explicit-recover')
    manifest = module.read_manifest(release, release.name)
    images = module.runtime_images(base, release.name, manifest)
    model = json.loads(module.compose(release, env_file, images, 'config', '--format', 'json'))
    guard = module.load_guard(release)
    guard.validate_model(model)
    guard.validate_peer(model, module.inspected_peer(model))
    module.external_preflight(release, model)
    if mode == 'inspect':
        module.require(module.snapshot(active, env_file, images) == images, 'previous-images-differ-from-attestation')
        module.require(module.current_is(base, active.name), 'previous-release-changed')
        module.public_preflight()
        print(active.name)
    else:
        with module.own_lock(base):
            module.require(previous == active.name and module.current_is(base, previous), 'previous-release-changed')
            old = module.read_manifest(active, previous)
            old_images = module.runtime_images(base, previous, old)
            module.require(module.snapshot(active, env_file, old_images) == old_images, 'previous-images-differ-from-attestation')
            database = module.inspected_database(model)
            guard.validate_external_peer(model, database)
            meta = model['x-folhea-external-postgres']
            backups = base / 'backups'
            if not backups.exists():
                backups.mkdir(mode=0o700)
            info = backups.lstat()
            module.require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and
                           stat.S_IMODE(info.st_mode) == 0o700, 'private-own-backup-directory-required')
            output = Path(tempfile.mkdtemp(prefix=source + '-', dir=backups))
            copy = Path(tempfile.mkdtemp(prefix=source + '-copy-', dir=backups))
            paths = []
            for name, db, role, sql in [('app', 'folhea', 'folhea_app', 'verify-recovery.sql'),
                                       ('idp', 'folhea_keycloak', 'folhea_keycloak', 'verify-recovery-keycloak.sql')]:
                destination, copied_to = output / name, copy / name
                destination.mkdir(mode=0o700)
                copied_to.mkdir(mode=0o700)
                # The observed PG identity was validated above. No password or
                # third-party env value is exported to the operations scripts.
                env = module.safe_environment({
                    'COMPOSE_PROJECT_NAME': project,
                    'COMPOSE_FILE': str(release / 'docker-compose.external-pg.yml'),
                    'COMPOSE_ENV_FILE': str(env_file),
                    'OPS_EXTERNAL_POSTGRES_CONTAINER': meta['container'],
                    'OPS_EXTERNAL_POSTGRES_CONTAINER_ID': database['id'],
                    'OPS_EXTERNAL_POSTGRES_IMAGE_ID': database['image'],
                    'DB_NAME': db, 'DB_USERNAME': role,
                })
                module.run(['bash', str(release / 'scripts/ops/backup-postgres.sh'),
                            '--output-dir', str(destination), '--external-destination', 'file://' + str(copied_to),
                            '--database', db, '--username', role], env=env, timeout=600)
                module.run(['bash', str(release / 'scripts/ops/verify-recovery.sh'), '--skip-backend',
                            '--sql', (release / 'scripts/ops' / sql).read_text(),
                            '--database', db, '--username', role], env=env, timeout=120)
                matches = list(destination.glob('folhea-' + db + '-*.dump'))
                module.require(len(matches) == 1, 'one-real-own-backup-required')
                path = module.private_dump(matches[0], base)
                copied = module.private_dump(copied_to / path.name, base)
                digest = module.sha(path)
                module.require(digest == module.sha(copied), 'backup-copy-checksum-mismatch')
                checksums = [Path(str(path) + '.sha256'), Path(str(copied) + '.sha256')]
                for checksum in checksums:
                    info = checksum.lstat()
                    module.require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and
                                   stat.S_IMODE(info.st_mode) == 0o600, 'private-backup-checksum-required')
                    module.require(checksum.read_text().split() == [digest, str(path)], 'backup-sidecar-mismatch')
                paths.append(path)
            module.require(module.current_is(base, previous), 'previous-release-changed')
            for path in paths:
                print(path)
            for path in paths:
                print(module.sha(path))
            # Only a NEW pathname; no receipt or review is generated here.
            print(base / 'receipts' / (output.name + '.backup-review.json'))
except Exception:
    print('production-bridge: preflight/backup recusado; evidências próprias preservadas, sem ativação.', file=sys.stderr)
    sys.exit(1)
PRODUCTION_PY
}

run_production() {
  local observed backup_result confirmation stamp
  local -a backup_fields
  printf '%s\n' 'Produção: verificando release atual, identidade e saúde próprias.'
  observed=$(production_bridge inspect)
  [[ $observed =~ ^[0-9a-f]{40}$ ]] || die 'current remoto inválido.'
  [[ -z $expected || $expected == "$observed" ]] || die 'current difere do esperado pelo operador.'
  expected=$observed
  if [[ -z $output ]]; then
    printf -v stamp '%(%Y%m%dT%H%M%SZ)T' -1
    output="${output_parent%/}/$source_sha-$stamp-$BASHPID"
  fi
  [[ $output == /* && ! -e $output && ! -L $output ]] || die 'output precisa ser absoluto e novo.'
  printf '%s\n' 'Produção: gates/builds locais e transferência pela engine.'
  python3 -B "$engine" --prepare --source "$source_sha" --output "$output" "${target[@]}"
  ensure_source
  python3 -B "$engine" --transfer --source "$source_sha" --bundle "$output/release" "${target[@]}"
  ensure_source
  printf '%s\n' 'Produção: backups reais separados APP+KC PG16 e guardas próprios.'
  backup_result=$(production_bridge backup)
  mapfile -t backup_fields <<< "$backup_result"
  ((${#backup_fields[@]} == 5)) || die 'metadados dos dois backups incompletos.'
  app_backup=${backup_fields[0]} idp_backup=${backup_fields[1]} evidence=${backup_fields[4]}
  [[ $app_backup == "$remote_root/backups/"* && $idp_backup == "$remote_root/backups/"* &&
     $evidence == "$remote_root/receipts/"* && ${backup_fields[2]} =~ ^[0-9a-f]{64}$ &&
     ${backup_fields[3]} =~ ^[0-9a-f]{64}$ ]] || die 'evidências de backup inválidas.'
  printf 'Previous: %s\nCandidata: %s\nAPP: %s\nSHA256: %s\nKC: %s\nSHA256: %s\n' \
    "$expected" "$source_sha" "$app_backup" "${backup_fields[2]}" "$idp_backup" "${backup_fields[3]}"
  printf '%s\n' 'Os backups/cópias não provam restore, consistência global ou compatibilidade de schema.'
  printf '%s\n' 'Revise as alterações de código/migrations/Keycloak e o plano de recuperação antes de continuar.'
  printf '%s\n' 'Digite PUBLICAR para declarar que você fez essa revisão e aceita o upgrade desta candidata:'
  IFS= read -r confirmation || die 'revisão não recebida; candidata e backups preservados, sem ativação.'
  [[ $confirmation == PUBLICAR ]] || die 'revisão cancelada; candidata e backups preservados, sem ativação.'
  ensure_source
  phase=review
  build_remote_command
  "${ssh_command[@]}"
  phase=activate
  build_remote_command
  "${ssh_command[@]}"
}

# Centralized target validation in the published engine, before expensive work
# or SSH. Its plan does not read production.env or touch the remote host.
python3 -B "$engine" --dry-run --source "$source_sha" "${target[@]}" >/dev/null
ensure_source
if ((production)); then
  run_production
elif [[ $phase == stage ]]; then
  [[ ! -e $output && ! -L $output ]] || die '--output precisa ser novo; o shell não sobrescreve bundles.'
  python3 -B "$engine" --prepare --source "$source_sha" --output "$output" "${target[@]}"
  ensure_source
  python3 -B "$engine" --transfer --source "$source_sha" --bundle "$output/release" "${target[@]}"
  printf '%s\n' 'Stage encerrado: candidata transferida; versão NÃO publicada. Backups e revisão explícita são as próximas etapas.'
else
  build_remote_command
  "${ssh_command[@]}"
fi
