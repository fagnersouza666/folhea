#!/usr/bin/env bash
#
# Lê e incrementa a versão do produto — frontend Angular e backend Quarkus juntos.
#
# Por que este script existe
# --------------------------
# A versão vive em frontend/package.json (e o lockfile) e em backend/pom.xml
# e precisa ser a mesma nos dois: o PWA e a API sobem juntos. Bumpar à mão é
# como o repositório chegou a ter frontend 0.1.0, backend 1.0.0-SNAPSHOT e
# OpenAPI 1.0 ao mesmo tempo.
#
# Uso
# ---
#   versao.sh atual                 mostra as versões e avisa se divergirem
#   versao.sh verificar             falha se divergirem
#   versao.sh corrigir              1.0.3 -> 1.0.4   (correção)
#   versao.sh funcionalidade        1.0.3 -> 1.1.0   (funcionalidade nova)
#   versao.sh grande                1.4.2 -> 2.0.0   (só quando o usuário pedir)

set -euo pipefail

raiz="${FOLHEA_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
package_json="$raiz/frontend/package.json"
lockfile="$raiz/frontend/package-lock.json"
pom="$raiz/backend/pom.xml"
openapi_props="$raiz/backend/src/main/resources/application.properties"

for arquivo in "$package_json" "$lockfile" "$pom" "$openapi_props"; do
    if [[ ! -f "$arquivo" ]]; then
        echo "ERRO: arquivo não encontrado: $arquivo" >&2
        exit 1
    fi
done

versao_do_frontend() {
    local versao
    versao="$(node -e 'const p=require(process.argv[1]); if (typeof p.version !== "string" || !p.version) { process.exit(2); } process.stdout.write(p.version);' "$package_json")" \
        || { echo "ERRO: não foi possível ler version em $package_json" >&2; return 1; }
    printf '%s' "$versao"
}

# Primeiro <version> do pom — o do projeto, antes de qualquer dependência.
versao_do_backend() {
    local versao
    versao="$(grep -m1 -oP '(?<=<version>)[^<]+' "$pom" || true)"
    if [[ -z "$versao" ]]; then
        echo "ERRO: não foi possível ler <version> do projeto em $pom" >&2
        return 1
    fi
    printf '%s' "$versao"
}

versao_do_openapi() {
    local versao
    versao="$(grep -m1 -E '^quarkus\.smallrye-openapi\.info-version=' "$openapi_props" | cut -d= -f2- || true)"
    if [[ -z "$versao" ]]; then
        echo "ERRO: quarkus.smallrye-openapi.info-version ausente em $openapi_props" >&2
        return 1
    fi
    printf '%s' "$versao"
}

escape_sed() {
    printf '%s' "$1" | sed -e 's/[.[\*^$()+?{|]/\\&/g'
}

exigir_semver() {
    if [[ ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "ERRO: versão '$1' não está no formato maior.menor.correção (sem -SNAPSHOT)" >&2
        exit 1
    fi
}

carregar_versoes() {
    FRONTEND_VERSION="$(versao_do_frontend)"
    BACKEND_VERSION="$(versao_do_backend)"
    OPENAPI_VERSION="$(versao_do_openapi)"
}

versoes_iguais() {
    [[ "$FRONTEND_VERSION" == "$BACKEND_VERSION" && "$FRONTEND_VERSION" == "$OPENAPI_VERSION" ]]
}

mostrar() {
    printf '  %-44s %s\n' "frontend (frontend/package.json)" "$FRONTEND_VERSION"
    printf '  %-44s %s\n' "backend (backend/pom.xml)" "$BACKEND_VERSION"
    printf '  %-44s %s\n' "OpenAPI (application.properties)" "$OPENAPI_VERSION"
}

aplicar_frontend() {
    local nova="$1"
    (cd "$raiz/frontend" && npm version "$nova" --no-git-tag-version --allow-same-version >/dev/null)
}

aplicar_backend() {
    local atual_regex nova
    atual_regex="$(escape_sed "$1")"
    nova="$2"
    sed -i -E "0,/<version>${atual_regex}<\/version>/s//<version>${nova}<\/version>/" "$pom"
}

aplicar_openapi() {
    local nova="$1"
    sed -i -E "s/^quarkus\\.smallrye-openapi\\.info-version=.*/quarkus.smallrye-openapi.info-version=${nova}/" "$openapi_props"
}

comando="${1:-atual}"
case "$comando" in
    atual | verificar | corrigir | funcionalidade | grande) ;;
    *)
        echo "Uso: versao.sh [atual|verificar|corrigir|funcionalidade|grande]" >&2
        exit 1
        ;;
esac

carregar_versoes

case "$comando" in
    atual)
        echo "Versão do produto:"
        mostrar
        if versoes_iguais; then
            echo
            echo "==> Frontend, backend e OpenAPI estão na mesma versão."
        else
            echo
            echo "AVISO: frontend, backend e OpenAPI estão em versões diferentes." >&2
        fi
        ;;

    verificar)
        if versoes_iguais; then
            echo "==> Versão coerente entre frontend, backend e OpenAPI: $FRONTEND_VERSION"
        else
            echo "FALHA: as versões do produto divergem." >&2
            mostrar >&2
            echo "       Os três sobem juntos — alinhe e use ./scripts/versao.sh para incrementar." >&2
            exit 1
        fi
        ;;

    corrigir | funcionalidade | grande)
        exigir_semver "$FRONTEND_VERSION"
        exigir_semver "$BACKEND_VERSION"
        exigir_semver "$OPENAPI_VERSION"

        if ! versoes_iguais; then
            echo "ERRO: as versões já estão divergentes:" >&2
            mostrar >&2
            echo "      Alinhe as três à mão antes de incrementar, para não escolher por você." >&2
            exit 1
        fi

        anterior="$FRONTEND_VERSION"
        IFS='.' read -r maior menor correcao <<< "$FRONTEND_VERSION"
        case "$comando" in
            corrigir)       correcao=$((correcao + 1)) ;;
            funcionalidade) menor=$((menor + 1)); correcao=0 ;;
            grande)         maior=$((maior + 1)); menor=0; correcao=0 ;;
        esac
        nova="$maior.$menor.$correcao"

        aplicar_frontend "$nova"
        aplicar_backend "$BACKEND_VERSION" "$nova"
        aplicar_openapi "$nova"
        carregar_versoes

        echo "$anterior -> $nova"
        echo
        mostrar
        if ! versoes_iguais; then
            echo "ERRO: a substituição deixou os arquivos divergentes — revise o diff." >&2
            exit 1
        fi
        echo
        echo "Lembre de incluir a mudança de versão NO MESMO commit da alteração"
        echo "que a motivou: versão em commit separado desgarra do que ela descreve."
        echo "Atualize README.md §Versão do produto."
        ;;
esac
