#!/usr/bin/env bash
# Interface fina da engine publicada; não contém decisões de deploy ou rollback.
set -euo pipefail

die() { printf 'deploy-shell: %s\n' "$1" >&2; exit 2; }
usage() {
  printf '%s\n' 'Uso: scripts/ops/deploy-folhea.sh [--stage|--review|--activate] [--execute|--dry-run]
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

PLAN por padrão. --source explícito no plano não consulta Git nem cria processos.
Sem --source, o plano lê HEAD/status com Git; não grava o índice.
--execute --stage prepara e transfere; PARA e NÃO publica a versão.
Depois dos backups e da revisão humana: --execute --review registra o recibo.
Somente --execute --activate pode promover a candidata, por meio da engine.
O shell não cria backups, decide compatibilidade ou lê production.env.
Configuração privada: REMOTE_ROOT/production.env, validada apenas pela engine.
Toolchains/cache: PATH, JAVA_HOME, TRIVY_CACHE_DIR somente neste processo.
Não há modo all, prompt automático, fresh, skip de gates ou recovery implícito.'
}

phase=stage phase_set=0 execute=0 dry_run=0
source_sha= host= remote_root= project= address= output= expected= evidence= app_backup= idp_backup=
reviewed=0
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --execute) execute=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    --stage|--review|--activate)
      ((phase_set == 0)) || die 'escolha somente uma ação.'
      phase=${1#--}; phase_set=1; shift ;;
    --schema-compatible-reviewed) reviewed=1; shift ;;
    --source|--host|--remote-root|--project-name|--server-address|--output|--expected-current|--backup-evidence|--app-backup|--idp-backup)
      (($# >= 2)) && [[ -n $2 ]] || die 'opção exige um valor.'
      case "$1" in
        --source) source_sha=$2 ;; --host) host=$2 ;; --remote-root) remote_root=$2 ;;
        --project-name) project=$2 ;; --server-address) address=$2 ;; --output) output=$2 ;;
        --expected-current) expected=$2 ;; --backup-evidence) evidence=$2 ;;
        --app-backup) app_backup=$2 ;; --idp-backup) idp_backup=$2 ;;
      esac
      shift 2 ;;
    *) die 'opção desconhecida; use --help. Valores não são registrados.' ;;
  esac
done
((execute == 0 || dry_run == 0)) || die '--execute e --dry-run são incompatíveis.'
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
esac

target=(--host "$host" --remote-root "$remote_root" --project-name "$project" --server-address "$address")
print_command() { printf '  '; printf '%q ' "$@"; printf '\n'; }
build_remote_command() {
  local argument escaped
  local -a arguments=(python3 -B "$remote_root/releases/$source_sha/scripts/ops/deploy-folhea.py")
  if [[ $phase == review ]]; then
    arguments+=(--record-backup-review --source "$source_sha" --expected-current "$expected"
      --schema-compatible-reviewed --backup-evidence "$evidence" --app-backup "$app_backup" --idp-backup "$idp_backup")
  else
    arguments+=(--activate --source "$source_sha" --installation upgrade --expected-current "$expected"
      --schema-compatible-reviewed --backup-evidence "$evidence")
  fi
  arguments+=("${target[@]}")
  remote_command=
  for argument in "${arguments[@]}"; do
    # POSIX quoting for the SSH login shell; no eval, Bash-only remote syntax,
    # interpolation of values as commands, or sourcing a remote env file.
    escaped=${argument//\'/\'\\\'\'}
    remote_command+="${remote_command:+ }'$escaped'"
  done
  ssh_command=(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -- "$host" "$remote_command")
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
  [[ $(git -C "$repo" rev-parse --show-toplevel) == "$repo" ]] || die 'script fora da raiz Git esperada.'
  git -C "$repo" ls-files --error-unmatch -- scripts/ops/deploy-folhea.py >/dev/null || die 'engine precisa estar versionada.'
  [[ $(git -C "$repo" rev-parse --verify HEAD) == "$source_sha" ]] || die 'checkout difere do source; selecione a revisão em um checkout próprio.'
  [[ -z $(GIT_OPTIONAL_LOCKS=0 git -C "$repo" status --porcelain) ]] || die 'HEAD precisa estar limpo e commitado, inclusive sem arquivos novos.'
}
ensure_source
if ((execute == 0)); then print_plan; exit 0; fi

# Centralized target validation in the published engine, before expensive work
# or SSH. Its plan does not read production.env or touch the remote host.
python3 -B "$engine" --dry-run --source "$source_sha" "${target[@]}" >/dev/null
ensure_source
if [[ $phase == stage ]]; then
  [[ ! -e $output && ! -L $output ]] || die '--output precisa ser novo; o shell não sobrescreve bundles.'
  python3 -B "$engine" --prepare --source "$source_sha" --output "$output" "${target[@]}"
  ensure_source
  python3 -B "$engine" --transfer --source "$source_sha" --bundle "$output/release" "${target[@]}"
  printf '%s\n' 'Stage encerrado: candidata transferida; versão NÃO publicada. Backups e revisão explícita são as próximas etapas.'
else
  build_remote_command
  "${ssh_command[@]}"
fi
