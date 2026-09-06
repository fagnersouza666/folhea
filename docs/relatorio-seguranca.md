# Revisão de segurança — Folhea (projeto completo)

> Sistema: Folhea (BFF Quarkus + Angular + Keycloak + PostgreSQL + Caddy)
> Data: 06/09/2026 | Versão: backend 1.0.0-SNAPSHOT / frontend 0.1.0
> Stack: Java 25, Quarkus 3.33.3 (LTS), Angular 22.1.5, Keycloak 26.7.3, Caddy 2.11.x, PostgreSQL 18, Redis 7
> Baseado em: OWASP Top 10:2021, LGPD (Lei 13.709/2018), CWE
> Modo: audit (playbook completo + LGPD + threat modeling + superfície)

## Sumário de Segurança

- CRÍTICOS: 0 (SEC-001 mitigado em 06/09/2026)
- ALTOS: 0 (SEC-002 mitigado com Redis compartilhado)
- MÉDIOS/BAIXOS: 0 em aberto (SEC-004–SEC-013 remediados)
- Pontos positivos: BFF OIDC com PKCE/nonce/state; tokens só no servidor; CSRF vinculado ao cookie `__Host-`; predicado de ownership; JPQL parametrizado; headers na borda e no BFF; rate limit fail-closed; paginação/teto de 366 dias; export/exclusão LGPD; correlation ID; allowlist de upload; imagens e Actions pinadas por digest/SHA
- Veredicto: **APROVADO COM RESSALVAS**

**Ressalva operacional:** TLS entre o BFF e o Redis fica documentado para deploy fora do Compose (rede Docker privada + senha obrigatória no stack atual). Provisionar TLS Redis antes de escalar para ambientes multi-host.

Todos os findings SEC-001 a SEC-013 foram endereçados neste ciclo de remediação (06/09/2026).

Metodologia: playbook OWASP PLAY-01 a PLAY-15 no repositório, leitura dos fluxos de auth/CSRF/IDOR/exceções/Compose/Caddy, e consulta ao grafo (`list_projects`, `index_status`, `get_architecture`, `search_graph`, `check_index_coverage`). O índice estava `ready` (1618 nós); `infra/Caddyfile` não é rastreado pelo grafo e alguns `.java` tinham metadata alterada no working tree — nesses pontos a evidência veio do fonte.

---

## CRÍTICO — Bloqueia deploy

### SEC-001: Keycloak 26.3.3 vulnerável a takeover via reset de senha (CVE-2026-18963)

**Localização:** docker-compose.yml:27; infra/keycloak/folhea-realm.json:7; infra/Caddyfile:64
**Descrição:** A stack usa `quay.io/keycloak/keycloak:26.3.3`. Divulgações de agosto/2026 descrevem **CVE-2026-18963** (CWE-640): atacante não autenticado consegue forçar o fluxo `reset-credentials` sem a verificação de e-mail e assumir a conta. O patch público está em Keycloak **26.7.2** (19/08/2026); versões abaixo disso, incluindo 26.3.3, são dadas como afetadas. O realm importado habilita reset de senha, e a borda publica `login-actions/*`, que é o caminho do fluxo de reset.
**Referência:** OWASP A07:2021 — Identification and Authentication Failures | CWE-640 | CVE-2026-18963

**Evidência:**

**docker-compose.yml:27** — imagem abaixo do patch:
```yaml
image: quay.io/keycloak/keycloak:26.3.3
```

**infra/keycloak/folhea-realm.json:7** — reset de senha ligado no realm que a produção importa:
```json
"resetPasswordAllowed": true,
```

**infra/Caddyfile:64** — ações de login (incluindo reset) acessíveis na internet:
```caddy
@oidc-public path /realms/folhea/protocol/openid-connect/auth /realms/folhea/protocol/openid-connect/logout /realms/folhea/login-actions/* /resources/*
```

**Impacto:** Comprometimento de qualquer conta que exista no realm Folhea, com sessão OIDC válida no BFF e acesso aos livros/sessões da vítima.

**Se não corrigido:** Um atacante externo redefine a senha de `oi@folhea.com.br` ou de um usuário real, entra por `/auth/login` e lê/apaga o histórico de leitura. Incidente LGPD (acesso não autorizado a e-mail e dados de uso).

**Correção:**

1. Subir Keycloak para **26.7.2 ou superior** (26.7.3 já existe) e revalidar o realm.
2. Mitigação imediata, se o patch atrasar: `"resetPasswordAllowed": false` e desligar o fluxo `reset-credentials` no realm até o upgrade.
3. Confirmar em produção que `/realms/folhea/login-actions/reset-credentials` responde 404 ou exige o fluxo seguro pós-patch.

---

## ALTO — Corrigir antes da próxima release

### SEC-002: Sessão OIDC, CSRF e rate limit só em memória do processo

**Localização:** backend/src/main/java/com/folhea/security/ServerTokenStateManager.java:27-44; backend/src/main/java/com/folhea/security/CsrfTokenService.java:24-25; backend/src/main/java/com/folhea/security/RateLimiter.java:11-12
**Descrição:** Access/refresh tokens, tickets CSRF e janelas de rate limit ficam em `ConcurrentHashMap` local. Há teto de 100_000 entradas e falha fechada, o que é correto para **uma** instância. Com duas réplicas, a sessão some, o CSRF de um nó é rejeitado no outro e o limite por IP/usuário pode ser contornado. Já estava registrado em `docs/security/findings.md` como SEC-001 operacional.
**Referência:** OWASP A07:2021 — Identification and Authentication Failures | CWE-613

**Evidência:**

**ServerTokenStateManager.java:27-44** — tokens OIDC no heap:
```java
private final Map<String, StoredTokens> tokens = new ConcurrentHashMap<>();
...
if (tokens.size() >= maxEntries) return Uni.createFrom().nullItem();
```

**CsrfTokenService.java:24-25** e **RateLimiter.java:11-12** — o mesmo padrão para CSRF e abuso.

**Impacto:** Em escala horizontal, logout efetivo aleatório, 403 CSRF e janelas de login/mutação mais frouxas que o baseline.

**Se não corrigido:** Publicar duas réplicas do backend quebra o modelo de sessão e enfraquece o controle de brute force documentado.

**Correção:** Redis (ou store equivalente) com TTL, TLS e autenticação, compartilhando `ServerTokenStateManager`, `CsrfTokenService` e `RateLimiter`. Até lá, **uma** instância de backend em produção.

### SEC-003: Compose padrão sobe Keycloak em `start-dev`

**Localização:** docker-compose.yml:29; docker-compose.prod.yml:6-10
**Descrição:** O arquivo principal usa `start-dev`. O overlay de produção troca para `start --optimized`, mas um `docker compose up` sem o overlay (o comando mais visível no README) deixa o IdP em modo desenvolvimento: hostname frouxo, páginas de erro verbosas e superfície extra.
**Referência:** OWASP A05:2021 — Security Misconfiguration | CWE-489

**Evidência:**

**docker-compose.yml:29:**
```yaml
command: ["start-dev", "--http-port=8080", "--http-management-port=9000", "--import-realm"]
```

**Impacto:** IdP de produção com perfil de desenvolvimento se o overlay for esquecido.

**Se não corrigido:** Console, headers e políticas de hostname incompatíveis com o threat model (T-14 / TB-03).

**Correção:** Tornar `start --optimized` o padrão do compose usado em servidores, ou falhar o boot se `start-dev` aparecer com `PUBLIC_BIND_ADDRESS=0.0.0.0`. Manter `start-dev` só em profile `dev`.

### SEC-004: Documento OpenAPI na origem pública `/api/openapi`

**Estado:** corrigido (06/09/2026)

**Localização:** backend/src/main/resources/application.properties; infra/Caddyfile; backend/src/test/java/com/folhea/security/OpenApiConfigurationTest.java
**Descrição:** O spec ficava em `/api/openapi`. O Caddy encaminhava todo `/api/*` para o Quarkus. O filtro JAX-RS `SecurityBoundaryFilter` exige sessão em paths `api/`, mas o SmallRye OpenAPI é rota Vert.x: `ContainerRequestFilter` **não é garantia** de cobertura. Swagger UI não entra no JAR de prod (`always-include=false`), porém o JSON do contrato ainda era servido sem `%prod.quarkus.smallrye-openapi.enable=false`.
**Referência:** OWASP A05:2021 — Security Misconfiguration | CWE-200

**Remediação entregue:**

- `%prod.quarkus.smallrye-openapi.enable=false` em `application.properties`
- Caddy responde `404` em `/api/openapi` antes do `reverse_proxy` de `/api/*`
- Teste de propriedades `OpenApiConfigurationTest` garante o perfil `%prod`

**Impacto (antes da correção):** Mapeamento anônimo da API (recursos, schemas, nomes de problemas).

**Se o spec for necessário internamente:** sirva só na rede privada ou atrás de auth; o CI usa `OPENAPI_FILE` de build dev/test, não URL pública de produção.

---

## MÉDIO/BAIXO — Backlog de segurança

### SEC-005: Listagens e intervalo de datas sem teto

**Status:** Corrigido (Bloco D)

**Localização:** `ReadingSessionResource`, `BookResource`, `StatisticsService`, `QueryLimits`
**Descrição:** `GET /api/v1/sessions` sem `from`/`to` devolvia `allOwned`. Livros listavam o acervo inteiro. `from`/`to` customizado em stats não tinha duração máxima.

**Correção aplicada:**
- `QueryLimits`: teto de 366 dias, paginação com `limit`/`offset` (padrão e máximo 100).
- `GET /sessions`: exige `from`/`to` ou usa os últimos 366 dias; rejeita intervalos maiores.
- `GET /books`: paginação com `limit`/`offset` (padrão e máximo 100).
- `GET /stats`: teto de 366 dias em intervalos customizados; `period=all` inalterado.
- Frontend: janela inicial de 90 dias + `loadMoreSessions`; streak e `period=all` via `/dashboard` e `/stats?period=all`.

**Evidência anterior:**

**ReadingSessionResource.java:48-50:**
```java
if (from == null && to == null) return sessions.allOwned(userId).stream().map(SessionResponse::from).toList();
```

**Impacto:** Resposta gigante e pressão de heap para um usuário com muitos anos de sessões, ou com `from`/`to` extremo.

**Se não corrigido:** Abuso autenticado contra o próprio tenant e degradação do nó único (SEC-002).

**Correção:** Paginação obrigatória (cursor ou `limit`/`offset` com máximo server-side, ex.: 100) e teto de intervalo (ex.: 366 dias) em listagens e stats.

### SEC-006: Realm de produção importa redirect URIs de localhost

**Localização:** infra/keycloak/folhea-realm.json:28-37
**Descrição:** O mesmo JSON de importação lista `http://localhost:8080/auth/callback` e `https://localhost:8443/auth/callback` junto com `https://folhea.com.br/auth/callback`. O BFF fixa o callback, então o impacto prático é menor com PKCE; ainda assim mistura ambiente e viola a regra de redirect URI exata do baseline.
**Referência:** OWASP A07:2021 | CWE-601

**Evidência:**

**folhea-realm.json:28-32:**
```json
"redirectUris": [
  "https://folhea.com.br/auth/callback",
  "http://localhost:8080/auth/callback",
  "https://localhost:8443/auth/callback"
]
```

**Impacto:** Superfície OIDC desnecessária em produção; risco se no futuro o `redirect_uri` passar a ser influenciável.

**Se não corrigido:** Drift de configuração e falha em auditoria de OAuth.

**Correção:** Realm de produção só com `https://folhea.com.br/auth/callback`. Localhost em arquivo/overlay de desenvolvimento.

### SEC-007: Cliente OIDC público no BFF

**Localização:** infra/keycloak/folhea-realm.json:21; .env.example:22-24; docker-compose.yml:76
**Descrição:** `folhea-api` é `publicClient: true` com PKCE. O token endpoint não está na borda, o que reduz o risco. Um BFF que guarda tokens no servidor deveria ser cliente confidencial com secret injetado.
**Referência:** OWASP A07:2021 | CWE-287

**Evidência:** `"publicClient": true` no realm; `OIDC_CLIENT_SECRET=` vazio no exemplo e no Compose.

**Impacto:** Defesa em profundidade menor se o token endpoint interno vazar ou se um segundo cliente reutilizar o `client_id`.

**Se não corrigido:** Qualquer processo na rede Docker que alcance Keycloak troca código com o mesmo cliente sem secret.

**Correção:** Cliente confidencial, secret só em variável/secret manager, PKCE mantido.

### SEC-008: Direitos LGPD de exclusão e exportação só por e-mail

**Status:** Corrigido em 2026-09-06.

**Localização:** frontend/src/app/features/settings/settings.component.ts; frontend/src/app/public/public-page.component.ts; backend/src/main/java/com/folhea/user/UserResource.java
**Descrição:** A UI oferece export JSON self-service e exclusão de conta com confirmação. A política de privacidade descreve os fluxos em Configurações. `GET /api/v1/me/export` retorna `{ user, books, sessions }`; `DELETE /api/v1/me` com `{"confirm": true}` faz cascade, revoga CSRF/token state, limpa cookie e encerra a sessão OIDC via redirect do cliente.
**Referência:** LGPD Art. 18 | OWASP A01:2021 (falta de capacidade de exclusão)

**Evidência:** `SettingsComponent` com download e diálogo acessível de exclusão; `UserResource` com export e delete; testes em `BackendResourceTest` e `settings.component.spec.ts`.

**Impacto residual:** Cópias de backup operacionais podem reter dados por prazo limitado — documentado na política pública.

**Correção aplicada:** Endpoints autenticados de export JSON e exclusão (cascade em livros/sessões + invalidação OIDC), com confirmação e auditoria sem payload (`Account deleted userId=...`).

### SEC-009: Actions de CI sem pin de commit SHA

**Localização:** .github/workflows/security.yml:18-33; .github/workflows/ci.yml:26; .github/workflows/cd.yml:20
**Descrição:** `actions/checkout@v4`, `gitleaks/gitleaks-action@v2`, `aquasecurity/trivy-action@v0.36.0` e `actions/dependency-review-action@v4` usam tags móveis. Tags podem ser movidas; o job de segurança é exatamente o que não deveria confiar em tag flutuante.
**Referência:** OWASP A08:2021 — Software and Data Integrity Failures | CWE-494

**Evidência:** `uses: actions/checkout@v4` (vários workflows); `uses: gitleaks/gitleaks-action@v2`.

**Impacto:** Comprometimento da supply chain do pipeline (exfiltração de secrets do GitHub).

**Se não corrigido:** Um tag poisonado no Action roda no checkout completo (Gitleaks usa `fetch-depth: 0`).

**Correção:** Pin `owner/repo@<sha>` e revisar o SHA em PRs de dependabot.

### SEC-010: Imagens Docker por tag, sem digest

**Localização:** docker-compose.yml:5,27; infra/Dockerfile:5,13,21,30
**Descrição:** `postgres:18`, `node:22-alpine`, `eclipse-temurin:25-jdk` / `25-jre-alpine`, `caddy:2.10.0-alpine` e Keycloak 26.3.3 não usam `image@sha256:...`. Caddy 2.10.0 está atrás da linha 2.11.x (2.11.4 em junho/2026).
**Referência:** OWASP A08:2021 | CWE-494

**Evidência:** `FROM caddy:2.10.0-alpine AS caddy-runtime`; `image: postgres:18`.

**Impacto:** Rebuild pode puxar camada diferente da auditada; Caddy desatualizado na borda TLS.

**Se não corrigido:** Substituição de tag ou CVE de borda sem rastreio.

**Correção:** Digest fixo, bump de Caddy para a última 2.11.x estável e scan Trivy da imagem resultante.

### SEC-011: `KC_HOSTNAME_STRICT=false` e hostname público só por env

**Localização:** docker-compose.yml:40-41
**Descrição:** `KC_HOSTNAME_STRICT: "false"` relaxa a checagem de hostname do Keycloak. Combinado com `KC_PROXY_HEADERS: xforwarded` e Caddy definindo `X-Forwarded-Host`, o risco é baixo **depois** do strip de headers; ainda é configuração frouxa para produção.
**Referência:** OWASP A05:2021 | CWE-20

**Evidência:** `KC_HOSTNAME_STRICT: "false"` no serviço `keycloak`.

**Impacto:** URLs de IdP inesperadas se o proxy confiável for mal configurado.

**Se não corrigido:** Open redirect / host header no tema de login em cenário de proxy errado.

**Correção:** `KC_HOSTNAME_STRICT=true` em produção com `KC_HOSTNAME` igual ao origin público.

### SEC-012: Logs de segurança incompletos (sem correlation ID, access log off)

**Localização:** backend/src/main/java/com/folhea/shared/RequestCorrelationFilter.java; backend/src/main/resources/application.properties:11,21-22
**Descrição:** Access log HTTP permanece desligado de propósito (não vazar cookie). JSON logging redige chaves sensíveis. `RequestCorrelationFilter` lê ou gera `X-Request-ID`, propaga o header na resposta e preenche MDC com `requestId`, `userId` interno (UUID, nunca e-mail), `route` e `httpStatus`.
**Referência:** OWASP A09:2021 | CWE-778

**Estado:** mitigado (06/09/2026).

**Impacto residual:** forense ainda depende do log de aplicação (sem access log HTTP).

### SEC-013: Upload de foto do card sem allowlist de tipo (só no browser)

**Localização:** frontend/src/app/core/services/card-generator.service.ts; frontend/src/app/features/cards/cards.component.ts
**Descrição:** `validateBackground` restringe a `image/jpeg`, `image/png` e `image/webp`, rejeita SVG/AVIF e limita a 8 MiB antes de `createObjectURL`. O input `accept` do componente foi alinhado.
**Referência:** OWASP A04:2021 | CWE-434

**Estado:** mitigado (06/09/2026).

**Impacto residual:** validação permanece no cliente; nada é enviado ao servidor.

---

## Verificação de Componentes Vulneráveis (A06)

Executado nesta revisão:

| Ecossistema | Comando | Resultado |
| --- | --- | --- |
| npm (frontend, `--omit=dev`) | `npm audit --omit=dev` | 0 vulnerabilidades (critical/high/moderate/low) |
| Maven | não executado aqui | Rodar no CI/agente com Docker: `./mvnw -B org.owasp:dependency-check-maven:check -DfailBuildOnCVSS=7` |
| Genérico | Trivy no workflow `security.yml` | Gate existente: falha em CRITICAL/HIGH no filesystem |

Versões observadas:

| Componente | No repo | Situação em 06/09/2026 |
| --- | --- | --- |
| Quarkus | 3.33.3 | LTS recomendada para produção. 3.33.3 inclui correções (ex.: Jackson CVE-2026-59889; path-auth CVE-2026-50559 citado como corrigido em 3.33.3). Linha 3.37/3.39 existe para quem não está em LTS. |
| Angular | 22.1.5 | Alinhado ao lockfile; audit de produção limpo |
| Keycloak | 26.3.3 | **Atrasado.** Patch de CVE-2026-18963 em 26.7.2+ |
| Caddy | 2.10.0 | Linha 2.11.x já disponível (2.11.4 em jun/2026) |
| PostgreSQL | 18 (tag flutuante) | Preferir tag menor + digest |
| Node (build) | 22-alpine | Tag flutuante |

Comandos para a equipe completar o A06:

```bash
# Java
cd backend && ./mvnw -B org.owasp:dependency-check-maven:check -DfailBuildOnCVSS=7
# ou
trivy fs --scanners vuln backend frontend infra

# Node (já executado para produção)
cd frontend && npm audit
```

---

## Conformidade LGPD

| Requisito LGPD | Status | Detalhes |
|----------------|--------|----------|
| Base legal documentada (Art. 7) | PARCIAL | Política em `/privacidade` descreve finalidade; não há registro interno versionado por dado (e-mail, livros, sessões, analytics) |
| Minimização de dados (Art. 6, III) | CONFORME | Sem CPF/saúde/pagamento; analytics com allowlist; tokens fora do browser |
| Mascaramento de CPF em exibição | NÃO APLICÁVEL | CPF não é coletado |
| Mascaramento de CPF em logs | NÃO APLICÁVEL | — |
| Log de acesso a dados pessoais | PARCIAL | Sem access log; JSON redige cookie/token; e-mail pode aparecer em exceções de persistência |
| Direito de acesso/exportação (Art. 18) | ATENDIDO | `GET /api/v1/me/export` + download em Configurações |
| Direito de eliminação (Art. 18) | ATENDIDO | `DELETE /api/v1/me` + diálogo de confirmação em Configurações |
| Direito de portabilidade (Art. 18) | PARCIAL | Depende de atendimento manual |
| Criptografia em repouso | PARCIAL | Volume Docker do Postgres; sem criptografia de campo; backups documentados como criptografados em `docs/backup-restore.md` — conferir operação |
| Criptografia em trânsito | CONFORME | HTTPS na borda; HSTS; OIDC público em HTTPS |
| Plano de resposta a incidentes | PARCIAL | `docs/backup-restore.md` cobre recuperação; notificação ANPD/titulares não está operacionalizada |

**Se não corrigido:** O produto trata e-mail e hábitos de leitura (dados pessoais). Sem exclusão/exportação automatizada e com IdP vulnerável (SEC-001), o risco LGPD deixa de ser teórico.

---

## Threat Modeling — Superfície de Ataque

### Atores de Ameaça

| Ator | Motivação | Vetores de Ataque | Consequência se bem-sucedido |
|------|-----------|-------------------|------------------------------|
| Atacante externo | Conta Folhea / dados de leitura | Reset de senha Keycloak (SEC-001), brute force em `/auth/login`, CSRF se Origin falhar, OpenAPI (SEC-004) | Takeover, alteração/exclusão de registros |
| Usuário autenticado malicioso / script | DoS da própria conta ou enumeração | Listagem sem paginação (SEC-005), 100k janelas de rate limit, CSRF flooding até o teto | Degradação do nó único |
| Usuário interno (ops) | Acesso a Postgres/Keycloak admin | Volume Docker, senha de admin do realm | Leitura de e-mails e hábitos; alteração de IdP |
| Supply chain | Inserir código no CI/imagem | Actions sem SHA (SEC-009), tags Docker (SEC-010) | Segredos do GitHub ou runtime trocado |

### Mapa de Superfície

```
Ponto de Entrada                                      | Auth      | Rate Limit | Input Validation | CSRF
------------------------------------------------------|-----------|------------|------------------|------
GET  /auth/login, /auth/callback                      | OIDC      | 10/min/IP  | state/nonce/PKCE | N/A (GET)
GET  /auth/logout                                     | OIDC      | não        | —                | cookie clear
GET  /api/v1/csrf                                     | sessão    | leitura    | ticket           | N/A (GET)
GET  /api/v1/me, /books, /sessions, /stats, /dashboard| sessão    | 120/usuário| UUID/datas       | N/A
POST/PATCH/DELETE /api/v1/books, /sessions, /analytics| sessão    | 20 IP / 60 user | Bean Validation + unknown props | Origin + X-CSRF-Token
GET  /api/openapi                                     | incerto (Vert.x) | se passar no filtro | —     | N/A
GET  /q/health/*                                      | rede interna     | n/a        | —                | N/A
GET  /healthz                                         | público   | não        | —                | N/A
/realms/folhea/protocol/openid-connect/auth, logout   | público   | Keycloak BF| —                | N/A
/realms/folhea/login-actions/*                        | público   | Keycloak   | —                | N/A — **SEC-001**
/resources/* (tema Keycloak)                          | público   | não        | —                | N/A
POST /admin, token, userinfo, certs, introspection    | não roteado na borda | —     | —                | —
```

Rotas `/api/v1/*` autenticadas usam `CurrentUser` a partir do `sub` do token, nunca de `userId` no body. `BookRepository.findOwned` / `ReadingSessionRepository.findOwned` aplicam `userId` na query; recurso de outro usuário retorna 404.

### Cenários de ataque combinados

**Cenário 1 — Takeover pelo IdP:**
SEC-001 (reset Keycloak) → sessão OIDC no BFF → SEC-002 irrelevante (instância única) → leitura/apagamento de livros e sessões.

**Cenário 2 — Reconhecimento + abuso autenticado:**
SEC-004 (OpenAPI) → conta legítima ou tomada → SEC-005 (listagem ilimitada) → esgotamento de memória do backend único.

**Cenário 3 — Escala prematura:**
Duas réplicas sem Redis (SEC-002) → CSRF 403 intercalado e rate limit por nó → atacante distribui tentativas de `/auth/login`.

---

## Playbook — cobertura e falsos positivos

| Play | Resultado |
| --- | --- |
| PLAY-01 SQLi | Sem concatenação. `createQuery` em `ReadingSessionRepository` usa `:userId` / `:today`. Panache `?1` parametrizado |
| PLAY-02 BAC | Sem `@PermitAll`. Resources de API com `@Authenticated`. IDOR mitigado por `findOwned`. Guard Angular é só UX |
| PLAY-03 Crypto | Sem secret hardcoded. Senhas via `${...}`. Sem MD5/SHA-1 de senha. OIDC valida issuer, aud, azp, sub |
| PLAY-04 Misc | CORS default `false`. Sem `printStackTrace`. Health não está no Caddy público. OpenAPI: SEC-004 |
| PLAY-05 XSS | Sem `innerHTML`, `bypassSecurityTrust*`, `eval`, `document.write` |
| PLAY-06 CMDi | Sem `ProcessBuilder` / `Runtime.exec` |
| PLAY-07 Path | Sem upload server-side |
| PLAY-08 Auth | Sem token em `localStorage`. Cookie `__Host-` HttpOnly Secure SameSite=Lax |
| PLAY-09 Deser | Sem `ObjectInputStream`. `fail-on-unknown-properties=true` |
| PLAY-10 Logs | JSON redige secrets; MDC com `requestId`, `userId`, `route`, `httpStatus` via `RequestCorrelationFilter` |
| PLAY-11 SSRF | `fetch` só em scripts de CI com URL de build, não de input de usuário da API |
| PLAY-12 Upload | Canvas no cliente com allowlist JPEG/PNG/WebP e limite 8 MiB (SEC-013 mitigado) |
| PLAY-13 CSRF | Token server-side + Origin/Referer + SameSite. Não é double-submit cookie |
| PLAY-14 LGPD | Sem CPF. E-mail e hábitos de leitura (SEC-008) |
| PLAY-15 Deps | npm produção limpo; Keycloak/Caddy atrasados; Maven/Trivy local não reexecutados nesta sessão |

Falsos positivos descartados: `SecurityPolicyTest` aceita `preview.folhea.com.br` só no fixture do teste, não no default de produção (`https://folhea.com.br`). `start-dev` no compose local é intencional se o overlay de prod for usado. Express em `frontend/src/server.ts` não entra na imagem de runtime (Caddy serve estático).

---

## Pontos positivos (não são achados)

- Authorization Code + PKCE + nonce + state; `restore-path` após login cai em `/app/inicio` hardcoded no resource.
- `ServerTokenStateManager` guarda tokens no servidor; o browser só vê referência opaca.
- Caddy remove `Forwarded` / `X-Forwarded-*` do cliente antes de gravar valores canônicos.
- Backend em `%prod` exige `TRUSTED_PROXIES`; porta 8080 só `expose`, não `ports`.
- Redes Compose `internal: true`; Postgres e Keycloak admin sem publicação.
- Cookie CSRF `__Host-folhea_session` (Secure, HttpOnly, Path=/, sem Domain).
- Rotação do ticket CSRF no callback e revogação no logout.
- `jackson.fail-on-unknown-properties=true`; DTOs em vez de entidade JPA na resposta.
- Realm com `bruteForceProtected`, `directAccessGrantsEnabled: false`, `registrationAllowed: false`.
- Exception mappers devolvem `problem+json` genérico; 500 não vaza stack ao cliente.
- Headers CSP/`frame-ancestors`/`nosniff`/HSTS na borda e no `SecurityHeadersFilter`.
- CI `security.yml` sem `continue-on-error`; Gitleaks com histórico completo.

---

## Ordem sugerida de remediação (concluída em 06/09/2026)

1. ~~Keycloak ≥ 26.7.2 (SEC-001)~~ — **feito** (26.7.3 + realm prod/dev).
2. ~~Redis compartilhado (SEC-002)~~ — **feito**.
3. ~~Overlay prod / guard start-dev (SEC-003)~~ — **feito**.
4. ~~OpenAPI desligado em prod (SEC-004)~~ — **feito**.
5. ~~Paginação e teto 366 dias (SEC-005)~~ — **feito**.
6. ~~Realm/endpoints canônicos + cliente confidencial (SEC-006/007)~~ — **feito**.
7. ~~Export/exclusão LGPD (SEC-008)~~ — **feito**.
8. ~~Pin SHA Actions + digest imagens (SEC-009/010)~~ — **feito**.
9. ~~Correlation ID + allowlist upload (SEC-012/013)~~ — **feito**.

**Verificação:** `./mvnw -B test`, `npm test`, `npm run lint`,
`node scripts/ci/validate-api-contract.mjs`,
`node scripts/ci/validate-oidc-surface.mjs`.
