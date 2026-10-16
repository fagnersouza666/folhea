# Correções do Bug Report — plano de execução

> Execução autorizada pelo pedido “implemente todas correções do docs/bug-report.md”.
> Aplicar TDD, revisão de código e verificação antes de concluir. As frentes independentes podem executar em paralelo, com propriedade de arquivos separada.

**Objetivo:** corrigir os 12 achados abertos BUG-021–BUG-032, preservar as correções históricas e provar o comportamento com regressões.

**Especificação:** [bug-report.md](../../bug-report.md), seção atual de 16/10/2026. O histórico BUG-001–BUG-020 já estava marcado como corrigido; revalidar seus invariantes durante as suítes, sem reaplicar soluções antigas incompatíveis com o produto atual.

**Arquitetura:** preservar o monolito Quarkus e o store Angular. Serializar mutações de domínio antes de ler seus valores, manter a referência opaca OIDC durante refresh com substituição atômica, corrigir ciclos de vida/reconciliação do frontend e tornar operações de Redis/restore atômicas. Normalizar URLs de backup e exigir o contrato correto de saúde.

**Stack:** Java 27 / Quarkus 3.40.1, PostgreSQL, Redis, Angular 22, TypeScript, Bash, Node e Python. Conferir versões estáveis sem reduzir o release para esconder falhas de ambiente.

## Restrições e decisões

- Não executar deploy, backup/restore de produção, exclusão de dados reais ou envio de mensagens.
- Não modificar a migração V010 nem o encoder histórico congelado.
- Manter ownership, CSRF, logout, revogação de conta e contratos públicos.
- Atualizar documentos das áreas alteradas e registrar evidências no relatório ao final.
- Incrementar a versão de produto pelo `scripts/versao.sh corrigir`, uma vez no lote, e sincronizar README/OpenAPI/frontend/backend.
- O relatório inicial é a única alteração anterior. Preservá-lo e seu histórico.
- O ambiente inicial impedia escrita em `.git`; o lote foi mantido no checkout atual, sem criar worktree/branch/commit. A liberação posterior permitiu concluir instalação e validação.
- Grafo MCP indisponível: usar fonte direta, sem alegar cobertura/generation do índice.

## Focos de regressão

- Duas abas alterando campos distintos do mesmo livro/sessão não perdem dados nem causam deadlock.
- Refresh OIDC concorrente com outra requisição ou logout não causa 401 indevido nem recria sessão revogada.
- Navegação/cancelamento e respostas HTTP fora de ordem não deixam registros locais órfãos ou restauram dados excluídos.
- JPEG com orientações espelhadas/rotacionadas mantém pixels corretos e não expõe metadados.
- Falhas no meio do restore, prefixos S3 com barra e respostas HTML/redirecionadas de saúde têm resultados corretos.

## Tarefas e evidências

### 1. Domínio e fotos — BUG-021 / BUG-029

**Arquivos:** `backend/src/main/java/com/folhea/book/`, `backend/src/main/java/com/folhea/reading/`, testes correspondentes, `docs/api/domain-contract.md`.
**Interface:** manter DTOs/rotas; consultas de mutação obtêm lock antes da leitura; normalizador aplica orientação antes de remover metadados.

- [x] Escrever regressões de concorrência e orientação 1–8; observar falhas pertinentes.
- [x] Implementar proteção de mutações com ordem de locks consistente e orientação JPEG.
- [x] Verificar regressões, limites de foto, ownership e testes de recursos.
- [x] Atualizar contrato e registrar comandos/resultados.

### 2. Sessão e Redis — BUG-022 / BUG-030

**Arquivos:** `ServerTokenStateManager`, `TokenStateStore` e implementações; `RedisRateLimitStore`; testes de sessão/store; `docs/security/baseline.md`.
**Interface:** adicionar substituição atômica apenas de referência existente; manter rotação no login e remoção no logout; incrementar contador/TTL em uma operação Redis.

- [x] Regressões de refresh concorrente, revogação/expiração durante refresh e capacidade.
- [x] Implementar ciclo de vida de sessão e testes do contrato Quarkus usado.
- [x] Regressão do contador entre instâncias e implementação atômica.
- [x] Executar testes de stores, HTTP OIDC e atualizar baseline.

### 3. Frontend — BUG-024 a BUG-028

**Arquivos:** `dashboard.store.ts`, componentes de livros, testes unitários/E2E fixtures, `frontend/README.md`.
**Interface:** PATCH autor/edição vazio conforme contrato existente; mutações mantêm o ciclo de vida necessário; reconciliar estado sem snapshots globais e rejeitar respostas obsoletas por entidade.

- [x] Adicionar regressões para os cinco cenários e observar RED.
- [x] Corrigir serialização, cancelamento, rollback e invalidação por entidade.
- [x] Executar testes completos, typecheck, lint e verificar contrato dos mocks.
- [x] Documentar comportamento e limites de validação.

### 4. Infraestrutura — BUG-023 / BUG-031 / BUG-032

**Arquivos:** scripts de restore/backup/health, testes correspondentes, `docs/backup-restore.md`, seções relacionadas de `docs/operations.md`.
**Interface:** restore em transação; chave S3 única para upload/verificação; saúde rejeita redirect/HTML e limita timeout, preservando `/healthz` vazio.

- [x] Regressões executando scripts reais sobre fixtures ou serviços isolados.
- [x] Corrigir os três scripts e observar GREEN.
- [x] Executar suítes de operações/CI pertinentes e atualizar runbook.

### 5. Integração e conclusão

- [x] Conferir/provisionar toolchain e dependências declaradas disponíveis.
- [x] Incrementar versão pelo script e atualizar README.
- [x] Revisão independente do diff e resolver achados relevantes.
- [x] Executar gates adequados; registrar bloqueios concretos sem convertê-los em sucesso.
- [x] Atualizar `docs/bug-report.md` com matriz BUG → implementação → regressão → resultado.
- [x] Conferir histórico preservado, `git diff --check` e escopo final.
- [x] Concluir validação integrada com Java 27, PostgreSQL/Redis/Docker/E2E e atualização estável compatível.

## Registro de execução

- Início: relatório aberto, árvore de produto sem mudanças; revisão base `6b5405717ae5b93fa0b6bf0186c0ef86c84d7560`.
- Ambiente inicial: JDK 25 disponível, POM exige 27; Docker socket inacessível; `node_modules` anterior diverge do lock e não contém `@angular/build`. Há cache Maven/npm local a inspecionar. Essas limitações serão reavaliadas durante a execução.
- Propriedade: frontend, domínio e infraestrutura em frentes separadas; controlador cuida de sessão/Redis, toolchain, versão, plano e relatório final.

- Implementação: 12 achados aplicados; frontend 169 testes + lint/typecheck/build8rotas aprovados, segurança23 testes isolados aprovados, orientação12 casos e harness de concorrência domínio aprovados. Infra96 testes (uma classe PostgreSQL ignorada), health8 e shell10 aprovados. CI registra o teste de health.
- Toolchain: dependências npm exatas extraídas do cache; postinstall esbuild bloqueado por EPERM, mas build e testes executaram. Downloads de Java27/Node26.12/CLI22.2.3 bloqueados por DNS; manter requisito de atualização pendente. Java27/Quarkus/PostgreSQL/Redis/E2E e Gitleaks ainda precisam dos recursos indisponíveis.
- Versão incrementada uma vez, pelo script:0.6.0→0.6.1; README/OpenAPI/frontend/backend coerentes.
- Verificação adicional: build de produção e SSG/SEO aprovados; contratos estáticos atuais aprovados. Suítes de mutação de contratos Node inconclusivas por spawnSync EPERM ao executar subprocesso com saída não zero; reprodução mínima confirmou stdout/stderr descartados. Histórico anterior do relatório preservado byte a byte (SHA-256 af62e9177241bdd5817eaa3cf93ce3b181da781c9055d4239e4a67b02e5d704a).
- Revisões independentes concluídas. Dois ajustes incorporados e revalidados: guarda escalar de conta excluída retorna401 mesmo com entidade managed; falha de refresh remove referência pendente/cookie atual, inclusive na API sem challenge, com IO em worker. Contrato executável Quarkus3.40.1:5casos passaram com provider/identity controlados e mecanismo real, sem injetar marcador de refresh.

- Continuação: etapa anterior classificada como progresso (implementação e evidências novas). Segunda verificação consecutiva confirmou o mesmo impedimento externo: Java25, download sem DNS, Docker negado e criação de sockets EPERM. A conclusão permanece não comprovada.
- Ajuste do gate BUG-023: CI define FOLHEA_REQUIRE_POSTGRES_TESTS=1; indisponibilidade de PostgreSQL é erro, sem aprovação por skip. Verificação antes: modo obrigatório com binários ausentes retornava0/skipped; depois: retorna5/erro. Modo local opcional mantém0/skipped. Com binários presentes e socket bloqueado, modo obrigatório também retornou5/erro. Documentação atualizada; regressão transacional real continua pendente.
- Auditoria de bloqueio: a etapa anterior foi progresso (gate de restore reforçado). Nesta terceira verificação consecutiva, sem avanço adicional de produto, Java permanece25, Gitleaks ausente, download Adoptium falha por DNS, Docker nega acesso e criação de socket recebe EPERM. Os quatro itens pendentes acima dependem desses recursos externos; não há processo de validação confirmado em andamento nem outra ação local que comprove esses gates. Objetivo bloqueado até mudança do ambiente; não concluído.

## Retomada da validação

O usuário reativou o objetivo e autorizou explicitamente instalar o Java 27.
Após o download pela sessão falhar por DNS, forneceu o arquivo
`~/Downloads/OpenJDK27U-jdk_x64_linux_hotspot_27_35.tar.gz`.
O pacote foi extraído em `/tmp/folhea-jdk-27/jdk-27+35`; `java -version` confirmou
Temurin 27+35 e `javac -version` confirmou 27. SHA-256 calculado localmente:
`1cf69a4848ffb728b3b260dfd45206a51566ab571a02a30092271d4c580bccbc`
(identificação do arquivo utilizado, sem comparação com checksum remoto).

O padrão existente é SDKMAN, com o Java 25 local apontando para
`~/.local/share/acerto/jdks/jdk-25.0.4.1+1`. A pedido do usuário, tentou-se criar
`~/.local/share/acerto/jdks/jdk-27+35`; o comando falhou com
`Read-only file system`. A instalação permanente e o registro no SDKMAN
permanecem pendentes. O JDK temporário permite continuar os comandos desta
sessão com `JAVA_HOME`/`PATH` explícitos, sem alterar o padrão global.

Com esse JDK, `./mvnw -o -B -Daether.syncContext.named.factory=noop clean verify`
compilou 84 fontes de produção e 53 fontes de teste no release 27. Terminou com
erro antes de executar testes: Testcontainers não conseguiu abrir o socket
Docker (`Operation not permitted`) e Quarkus não iniciou o datasource dos Dev
Services. Evidência em `/tmp/folhea-java27-maven.log`; zero testes executados.
O erro de versão Java foi superado, mas a suíte integrada continua pendente.

Na sequência, Maven com o mesmo JDK e as mesmas opções de cache executou
`-Dtest=BookPhotoOrientationTest,ServerTokenStateManagerTest,OidcRefreshRuntimeContractTest,RedisRateLimitStoreTest,RateLimiterTest,SessionCookiePolicyTest test`:
**35 testes, zero falhas, erros e skips; BUILD SUCCESS**.
Log: `/tmp/folhea-java27-unit-tests.log`. São seis classes sem serviços externos;
esse resultado não substitui a execução integrada impedida por Docker/sockets.

### Ambiente liberado e instalação definitiva

Após a liberação de filesystem/rede/Docker nesta sessão, o pacote fornecido foi
instalado em `~/.local/share/acerto/jdks/jdk-27+35` e registrado pelo comando
`sdk install java 27-local ...`, seguindo o padrão dos JDKs existentes.
`sdk use java 27-local`, `java -version` e `javac -version` confirmaram Temurin
27+35. O alias padrão global foi preservado; os comandos deste lote selecionam
`~/.sdkman/candidates/java/27-local` em `JAVA_HOME` e `PATH`.

`./mvnw -B clean verify` terminou com **BUILD SUCCESS: 275 testes em 50 classes,
zero falhas, erros e skips**, com PostgreSQL e Redis reais. Inclui cinco casos
de concorrência de domínio, 21 testes HTTP de fotos, 18 de logout HTTP e sete
de stores Redis. Evidência: `/tmp/folhea-java27-full-verify.log` e XMLs Surefire.
O build Docker `backend-runtime` também passou, imagem local
`folhea:backend-bugfix-final` (SHA-256
`95adb11ac081d3b029962590c3effabddaf078fd1f8f7f32301009fe78e300ef`).

Infraestrutura revalidada: 98 testes ops sem skips, incluindo atomicidade real
PostgreSQL 18.6; dez cenários shell; 66 testes Python CI com Gitleaks 8.30.1;
dez testes Node de contratos; 19 cenários de health com HTTP real. Os detalhes
estão em `/tmp/folhea-infra-audit/final-validation.md`.

Node 26.12.0 foi instalado pelo nvm; CLI/build/SSR foram alinhados em 22.2.3.
`npm ci` normal passou com scripts nativos e os 169 testes do frontend passaram
com o lock atualizado. Playwright 1.64.1, Vitest/coverage 5.0.5, ESLint 10.13.0
e jsdom 30.1.3 foram atualizados; TypeScript 6.0.3 permanece na faixa suportada
`>=6.0 <6.1` do Angular, pois 7.0.2 é incompatível. npm 11.20.0 é o fornecido
pelo Node 26.12.0 usado nos builds. Lint, typecheck, quatro testes SEO e build
de produção/SSG de oito rotas passaram. Os builds pesados foram serializados
devido à memória do host.

O build `caddy-runtime` passou com o lock final: `folhea:caddy-infra-final`,
SHA-256 `ae33b6f5fd6eeb1ffbd5a65973c0ddb64f0ddbb939866ea9b35111325081f0b1`.
Prova binária Caddy/Go/módulos/checksums e gates NPM/health passaram usando essa
imagem, incluindo IPAM real, 12 limites de corpo e sete cenários de cache.

O E2E crítico terminou **24/24, zero skips**. A primeira rodada teve uma falha
de rede `ERR_NETWORK_CHANGED` durante criação de interfaces Docker; a repetição
passou sem modificar testes, timeouts ou retries. Evidências e JUnit estão em
`/tmp/folhea-frontend-audit/`.

Somente a nova stack `folhea-bugfix-20261016`, em `https://127.0.0.5:9448`, foi
usada na aceitação, com volumes próprios e conta sintética. A prova OIDC com
Keycloak real passou: cadastro, expiração de token de 30 segundos, reemissão da
mesma referência opaca com validade estendida, quatro requisições concorrentes
com o cookie anterior, logout via UI/callback, replay rejeitado e novo login
exigido. A intercalação exata durante refresh é coberta pelo contrato Quarkus.

`npm run e2e:integrated -- --reporter=list,junit` passou: **um teste, zero
falhas/erros/skips**, em 10,1 segundos. Inclui a regressão BUG-024 adicionada à
jornada: limpar autor/edição, salvar e recarregar com os campos vazios no backend
real. Também exercita livro/foto, leituras, métricas, card, finalização/reabertura
e exclusão. Logs e JUnit estão em `/tmp/folhea-bugfix-integration-20261016/`;
credenciais foram fornecidas somente pelo ambiente, sem trace/screenshots.
Os recursos da stack temporária foram removidos após os testes. As stacks
anteriores e os dados de produção foram preservados.

Para executar os comandos abaixo, o ambiente precisa de Java 27 selecionado em
`JAVA_HOME`/`PATH`, Node 26.12.0, Gitleaks no `PATH`, Docker acessível, rede para
dependências e permissão para criar sockets. O teste de restore também precisa
dos binários PostgreSQL e de usuário não root; `PG_TEST_BIN` permite selecionar
seu diretório. A seleção de versões deve ser conferida novamente ao provisionar.

Comandos de reprodução dos principais gates aprovados, a partir da raiz do projeto:

```bash
(cd backend && ./mvnw -B clean verify)
(cd frontend && npm ci)
(cd frontend && npx playwright install --with-deps chromium)
(cd frontend && npm run e2e:critical)
FOLHEA_REQUIRE_POSTGRES_TESTS=1 python3 -B -m unittest discover -s scripts/ops/tests -p 'test_restore_atomicity.py'
python3 -B -m unittest discover -s scripts/ci/tests -p 'test_*.py'
node --test scripts/ci/tests/public-contract.test.mjs scripts/ci/tests/seo-validator.test.mjs scripts/ci/tests/domain-surface.test.mjs
```

Executar cada etapa com sucesso antes de considerar seu gate aprovado.
`e2e:critical` cobre o navegador com fixtures HTTP; não comprova integração com
Keycloak/PostgreSQL reais. A suíte `e2e:integrated` exige a stack local preparada,
conforme o [README do frontend](../../../frontend/README.md). Os demais gates
Docker/HTTP estão definidos no [workflow CI](../../../.github/workflows/ci.yml).
CLI/build/SSR foram atualizados e validados com instalação normal pelo npm.
Todos os itens deste plano foram concluídos; a matriz final de resultados está
no [relatório de bugs](../../bug-report.md). O histórico anterior de bloqueios
é mantido como registro e foi superado pelas evidências desta última etapa.
