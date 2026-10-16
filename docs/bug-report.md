# Bug Report — Folhea

> Data da auditoria: 16/10/2026 | Produto auditado: **0.6.0** | Correções: **0.6.1** | Modo: **full**
> Revisão auditada: `6b5405717ae5b93fa0b6bf0186c0ef86c84d7560` (árvore inicialmente limpa).
> Stack declarada: Java 27, Quarkus 3.40.1, Hibernate ORM/Panache, Flyway 13.10.0, PostgreSQL, Redis, Keycloak, Angular 22.2.3, TypeScript 6.0.3, Python, Bash e Caddy/Go.
> Arquivos consultados/analisados: **294** (código, configuração, contratos e testes; parte dos testes e scripts por trechos). Inventário versionado: **387** arquivos. O inventário da revisão está no fim desta seção.

## Sumário da auditoria

| Severidade | Quantidade |
|------------|------------|
| CRITICO | 0 |
| ALTO | 3 |
| MEDIO | 9 |
| BAIXO | 0 |
| **Total** | **12** |

**Situação final: os 12 achados foram corrigidos e os gates de validação passaram, incluindo Java 27, PostgreSQL, Redis, Docker e E2E com Keycloak real.** A tabela de severidade registra a auditoria anterior às correções. Os cenários, trechos problemáticos e propostas abaixo preservam o diagnóstico daquela revisão; a implementação efetiva e suas evidências estão na matriz seguinte. Testes com transporte simulado permanecem identificados como tal.

A numeração continua em **BUG-021–BUG-032** para preservar os IDs anteriores. O relatório de setembro e suas revisões pontuais foram preservados integralmente na seção histórica recolhível ao final; seus números/status não entram no sumário atual.

| ID | Severidade | Problema |
|----|------------|----------|
| BUG-021 | ALTO | Atualizações concorrentes desfazem finalizações e sobrescrevem leituras |
| BUG-022 | ALTO | Renovação OIDC invalida requisições legítimas já em voo |
| BUG-023 | ALTO | Restore pode deixar o banco parcialmente apagado após erro |
| BUG-024 | MEDIO | Limpar autor ou edição mostra sucesso sem remover os valores |
| BUG-025 | MEDIO | Navegar durante o cadastro deixa um livro temporário órfão |
| BUG-026 | MEDIO | Rollback de uma exclusão restaura outras operações já confirmadas |
| BUG-027 | MEDIO | Salvar uma leitura descarta métricas válidas de outros livros |
| BUG-028 | MEDIO | Resposta atrasada de sessão repõe cache de livro excluído |
| BUG-029 | MEDIO | Normalização JPEG remove orientação EXIF sem girar os pixels |
| BUG-030 | MEDIO | Inicialização do limitador Redis perde incrementos entre instâncias |
| BUG-031 | MEDIO | Barra final no destino S3 faz a verificação procurar outra chave |
| BUG-032 | MEDIO | Health check aprova redirecionamento para uma página HTML |

## Execução das correções — 16/10/2026

Pedido autorizado: implementar os achados abertos deste relatório. Plano em
[correcao-bug-report](superpowers/plans/2026-10-16-correcao-bug-report.md).
Produto incrementado pelo `scripts/versao.sh corrigir`: frontend, backend e
OpenAPI **0.6.1**. Sem deploy ou manipulação de dados de produção.

| ID | Implementação aplicada | Regressão e evidência |
|----|------------------------|----------------------|
| BUG-021 | `BookRepository.lockOwnerForMutation` serializa mutações por conta antes de carregar livro/sessão; recursos seguem a mesma ordem de locks. | Cinco casos de `BookMutationConcurrencyTest` e `ReadingMutationConcurrencyTest` passaram na suíte Maven Java 27/Quarkus/PostgreSQL real, incluindo concorrência e conta excluída. |
| BUG-022 | Refresh mantém referência opaca; stores substituem somente entrada existente e não expirada, atomicamente. Login rotaciona; logout/falha revogam; mapper de erro limpa referência atual/pendente antes do 401. | Maven completo passou, incluindo 14 casos do manager, cinco do contrato Quarkus, 18 de logout HTTP e sete de stores Redis. Keycloak real: após expiração, refresh reemitiu a mesma referência com validade estendida; quatro chamadas concorrentes com o cookie anterior retornaram 200. Logout pela UI completou o callback; replay retornou 401 e novo acesso exigiu login. |
| BUG-023 | `pg_restore --single-transaction` nos dois formatos suportados. | Dez cenários shell e os dois testes de atomicidade passaram, estes com PostgreSQL 18.6 próprio e ambos os formatos. Erro de COPY preservou os dados anteriores; restore válido os substituiu. CI exige execução real com `FOLHEA_REQUIRE_POSTGRES_TESTS=1` e falha sem PostgreSQL. |
| BUG-024 | Formulário envia string vazia ao limpar autor/edição; fixture E2E segue o PATCH do backend. | Regressão formulário/HttpClient, E2E crítico e jornada integrada com backend real passaram. Autor e edição permaneceram vazios após salvar e recarregar o detalhe. |
| BUG-025 | Store mantém criação e upload já submetidos até reconciliar sucesso/erro após navegação. | Três regressões de destruição do formulário/observador passaram. Foto cujo upload ainda não começou não é iniciada após sair; limite documentado no README frontend. |
| BUG-026 | Exclusões e edições de sessão reconciliam somente após confirmação; snapshots globais removidos. | Regressões de delete×delete e edição/exclusão×edição confirmada passaram. |
| BUG-027 | Métricas paginadas verificam revisão por livro. | Página de outro livro recebida após leitura salva mantém métricas; regressão passou. |
| BUG-028 | Cache rejeita respostas de detalhe/edição de sessão e metadados para livro com exclusão confirmada. | Três regressões de respostas atrasadas após cascata passaram. |
| BUG-029 | JPEG aplica orientação EXIF 1–8 antes de remover metadados/redimensionar. Migração V010 preservada. | Doze casos de orientação/endian/offset inválido/resize e 21 testes HTTP de fotos passaram no Maven Java 27, além dos três testes de migração com PostgreSQL. |
| BUG-030 | Um script Lua executa INCR e EXPIRE atomicamente. | Regressão de intercalação passou; sete testes de `RedisSecurityStoreTest` passaram com Redis/Quarkus reais, incluindo 48 chamadas concorrentes, limite e TTL. |
| BUG-031 | Upload e HEAD derivam da mesma chave S3, com normalização das barras finais. | Seis destinos S3 passaram com chave e conteúdo exatos em transporte simulado. |
| BUG-032 | Health check rejeita redirects, HTML, JSON sem UP, status inesperado, timeout e lista vazia; exige healthz vazio. | Oito testes versionados da CLI passaram e foram incluídos no CI. Além deles, 19 cenários com HTTP real em loopback passaram, incluindo timeout de cabeçalhos/corpo e redirect não seguido. |

### Verificação após as correções

- Backend: `./mvnw -B clean verify` com Java **27+35** passou: **275 testes em
  50 classes, zero falhas, erros e skips**. PostgreSQL e Redis reais, migrations,
  HTTP, ownership, concorrência de domínio, fotos e logout foram exercitados.
- Frontend atualizado: `npm ci` normal passou, incluindo os scripts nativos;
  **169 testes / 30 arquivos**, lint, typecheck e quatro testes SEO passaram.
  Build de produção/SSG passou, com **oito rotas**; validação SEO/CSP/PWA passou.
- Navegador: **24 E2E críticos e uma jornada integrada aprovados, sem skips**.
  A jornada integrada executou login, livro com foto, leitura/edição, métricas,
  download do card, limpeza de autor/edição persistida após recarga, remoção de
  foto, finalização/reabertura e exclusão do livro, com BFF/Keycloak/banco reais.
- Aceitação OIDC adicional com Keycloak real passou: cadastro, expiração de
  token de 30 segundos, refresh estável, quatro requisições concorrentes,
  logout/callback, rejeição de replay e exigência de novo login. O teste de
  intercalação exata durante refresh permanece no contrato executável Quarkus;
  a prova pelo navegador verifica o cookie emitido antes do refresh.
- Antes do commit, o Gitleaks do diff staged sinalizou o cabeçalho literal do
  JWT sintético de `OidcRefreshRuntimeContractTest`. A fixture passou a montar
  cabeçalho e claims por Base64, mantendo os mesmos bytes e a assinatura inválida
  `.fixture`, sem ampliar allowlists. O contrato foi reexecutado após o ajuste.
- Ops Python: **98 testes, sem skips**, incluindo atomicidade real do restore
  em PostgreSQL 18.6. Backup/restore shell: **dez cenários aprovados**.
- Python CI: **66 testes aprovados**, com Gitleaks 8.30.1 instalado e checksum
  oficial conferido. Contratos Node: **dez testes aprovados**. A restrição
  anterior de `spawnSync` deixou de impedir a execução.
- Health CLI: testes versionados aprovados e **19 cenários HTTP reais** passaram,
  incluindo redirects, payload inválido e timeout de cabeçalhos/corpo.
  Gates Caddy de saúde, limites de corpo/cache e métricas SQL também passaram.
- Imagens Docker `backend-runtime` e `caddy-runtime` construídas com sucesso a
  partir do Dockerfile do projeto e usadas na aceitação. Prova binária do Caddy
  2.11.7/Go 1.27.2, módulos/checksums e gates NPM/health da imagem passaram,
  incluindo IPAM real, 12 limites de corpo e sete cenários de cache.

### Ambiente e encerramento

Os bloqueios anteriores de filesystem, rede, Docker e sockets foram superados
após a mudança de permissões da sessão. Temurin **27+35**, fornecido pelo usuário
em Downloads, foi instalado em `~/.local/share/acerto/jdks/jdk-27+35` e registrado
no SDKMAN como **27-local**. `java` e `javac` foram verificados. O alias padrão
global foi preservado; a validação seleciona esse JDK em `JAVA_HOME`/`PATH`.

Node **26.12.0** foi instalado pelo nvm. CLI/build/SSR foram alinhados em
**22.2.3**; Playwright **1.64.1**, Vitest/coverage **5.0.5**, ESLint **10.13.0** e
jsdom **30.1.3** foram atualizados com resolução normal do lock. TypeScript
**6.0.3** foi mantido porque o compiler-cli atual exige `>=6.0 <6.1`; a versão
7.0.2 não satisfaz esse contrato. As fontes e resultados estão no
[README frontend](../frontend/README.md) e no
[plano de execução](superpowers/plans/2026-10-16-correcao-bug-report.md).

A primeira rodada crítica aprovou 23 de 24 casos; o caso de limpar metadados
encontrou `ERR_NETWORK_CHANGED` durante a criação de interfaces Docker. A
repetição completa passou **24/24**, sem alterações nos testes/timeouts/retries
e com a rede estável. A stack de aceitação usou projeto e volumes próprios em
`https://127.0.0.5:9448`; seus recursos foram removidos após os testes, sem
alterar stacks existentes. Nenhum dado de produção foi usado.

Evidências locais: `/tmp/folhea-java27-full-verify.log`, XMLs em
`backend/target/surefire-reports/`, relatórios
`/tmp/folhea-frontend-audit/final-validation.md` e
`/tmp/folhea-infra-audit/final-validation.md`, e logs `oidc-probe.log`,
`integrated.log`/`integrated-junit.xml` na pasta privada
`/tmp/folhea-bugfix-integration-20261016/`. As credenciais sintéticas não são
versionadas nem exibidas nos relatórios. Esses arquivos em `/tmp` são efêmeros;
a matriz acima registra os resultados e os testes de regressão ficam no projeto.

Revisões independentes de domínio, frontend, infraestrutura e sessão/Redis
concluídas. A revisão identificou dois ajustes necessários na implementação:
conta já carregada e excluída antes do lock poderia produzir 500; cleanup de
refresh poderia perder a referência após o cookie ser esvaziado, inclusive no
caminho API sem challenge. Ambos foram corrigidos e revalidados. A conta retorna
401; as falhas de refresh revogam o estado em worker. Não restou achado
confirmado aberto nesses diffs, dentro dos limites de execução descritos.

## Escopo, método e limites

A revisão abrangeu todos os módulos de produção: autenticação/sessão, usuários e exclusão de conta, exportação, livros/fotos, leituras/estatísticas, frontend/SSR/SSG/PWA, migrations, infraestrutura, CI/CD, deploy, backup e restore. Foram lidos os **84 arquivos Java de produção**, as **9 migrations SQL** e os fontes do frontend; as listagens abaixo incluem também arquivos de apoio e testes consultados.

Aplicou-se varredura de padrões (nulidade, erros, concorrência, recursos, desempenho, lógica/datas, SQL/transações, configuração, ciclos de vida do frontend e integrações), seguida de leitura dos fluxos e confronto com contratos/testes. Matches de padrões não foram tratados como defeitos automaticamente. As reproduções ficaram em `/tmp`, sem executar operações reais de produção.

O nível pretendido foi **Auditor**, com verificação direta de fontes. As ferramentas `list_projects`, `search_graph`, `trace_path` e `check_index_coverage` do codebase-memory não estavam disponíveis nesta sessão. Portanto, geração, atualização e cobertura do grafo são **desconhecidas**; nenhuma consulta MCP foi realizada. Usou-se o fallback de leitura e `rg`. A revisão não comprova ausência de outros bugs.

As evidências da auditoria inicial variavam por achado: frontend com HTTP controlado; concorrência ORM com entidades atuais/Hibernate real e H2; imagem e stores executando fontes atuais compilados; scripts com comandos externos simulados; restore por leitura e semântica documentada. Naquela etapa inicial não houve E2E com Keycloak/PostgreSQL reais, execução de migrations ou restauração real. Cada achado especifica esse limite; os resultados posteriores às correções constam na matriz e na verificação acima.

## CRITICO

Nenhum achado confirmado foi classificado como CRÍTICO nesta revisão.

## ALTO

### BUG-021: Atualizações concorrentes desfazem finalizações e sobrescrevem leituras

**Locais:** `backend/src/main/java/com/folhea/book/BookResource.java:98–121, 134–143, 155–158, 211–215`; `backend/src/main/java/com/folhea/book/BookEntity.java:20–40`; `backend/src/main/java/com/folhea/reading/ReadingSessionResource.java:100–117`; `backend/src/main/java/com/folhea/reading/ReadingSessionEntity.java:17–33`. Os repositórios retornam entidades sem lock (`backend/src/main/java/com/folhea/book/BookRepository.java:15`, `backend/src/main/java/com/folhea/reading/ReadingSessionRepository.java:27`); as entidades não têm `@Version`.

**Cenário concreto:** duas requisições simultâneas da mesma conta carregam o mesmo livro READING. Uma finaliza o livro e confirma o commit; a outra faz PATCH apenas do título, usando a entidade carregada antes. O Hibernate envia também o estado antigo de `status` e `finished_on`, reabrindo o livro silenciosamente. Analogamente, duas edições parciais de sessão, uma de páginas e outra de minutos, devolvem sucesso, mas a segunda restaura o valor antigo das páginas. Duas abas/dispositivos são suficientes; não é necessário editar simultaneamente o mesmo campo. O efeito muda progresso, totais e contagem de livros finalizados.

**Trechos reais:**

```java
// BookResource.java:109–122
private BookResponse updateBook(BookEntity book, UpdateBookRequest request, BookCoverService.Normalized image) {
    if (request == null || (request.title() == null && request.author() == null && request.edition() == null && !request.hasTotalPages() && image == null)) invalid("Informe ao menos um campo para alterar.");
    if (request.title() != null) {
        if (request.title().isBlank()) invalid("O título não pode ficar vazio.");
        book.title = request.title().trim();
    }
    validateTextLength(request.title(), request.author());
    if (request.author() != null) book.author = blankToNull(request.author());
    validateMetadata(request.edition(), request.totalPages());
    if (request.edition() != null) book.edition = blankToNull(request.edition());
    if (request.hasTotalPages()) book.totalPages = request.totalPages();
    covers.save(book.id, image);
    books.flush();
    return reads.response(book, currentUser.get());
}
```

```java
// ReadingSessionResource.java:104–117
UUID nextBookId = request.bookId() == null ? session.bookId : request.bookId();
LocalDate nextDate = request.readingDate() == null ? session.readingDate : request.readingDate();
int nextPages = request.pages() == null ? session.pages : request.pages();
int nextMinutes = request.minutes() == null ? session.minutes : request.minutes();
if (request.bookId() != null) ensureBookOwned(user.id, nextBookId);
if (request.readingDate() != null) {
    validateDate(nextDate, time.today(user.timezone));
}
validateProgress(nextPages, nextMinutes);
session.bookId = nextBookId;
session.readingDate = nextDate;
session.pages = nextPages;
session.minutes = nextMinutes;
sessions.flush();
```

**Evidência executada:** `/tmp/folhea-domain-audit/LostUpdate.java` compila as entidades atuais sem modificações. Hibernate **7.4.9.Final**, exatamente a versão gerenciada pelo BOM Quarkus 3.40.1 (`~/.m2/.../quarkus-bom-3.40.1.pom:9806–9807`), com banco **H2 2.4.240 em memória**, JDK 25.0.4.1. São dois persistence contexts/transações sobrepostos, com commits ordenados para reproduzir a corrida. Isso comprova o SQL do ORM e a perda; não é execução HTTP/Quarkus/PostgreSQL. Log em `/tmp/folhea-domain-audit/lost-update.log`:

```text
Hibernate: update book set author=?,created_at=?,edition=?,finished_on=?,status=?,title=?,total_pages=?,updated_at=?,user_id=? where id=?
BOOK_AFTER_FINISH_THEN_STALE_TITLE_PATCH title=Renamed status=READING finishedOn=null
Hibernate: update reading_session set book_id=?,created_at=?,minutes=?,pages=?,reading_date=?,updated_at=?,user_id=? where id=?
SESSION_AFTER_PAGES_THEN_STALE_MINUTES_PATCH pages=10 minutes=15
```

**Correção funcional sugerida:** serializar cada alteração com lock pessimista obtido na própria consulta de ownership, **antes de carregar o estado usado no PATCH**. Reutilizar o padrão já existente em BookPhotoService. Não basta bloquear a entidade depois de carregar e calcular os campos.

```java
// BookRepository — adicionar:
public BookEntity findOwnedForUpdate(UUID userId, UUID bookId) {
    return find("id = ?1 and userId = ?2", bookId, userId)
            .withLock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
            .firstResult();
}

// ReadingSessionRepository — adicionar:
public ReadingSessionEntity findOwnedForUpdate(UUID userId, UUID id) {
    return find("id = ?1 and userId = ?2", id, userId)
            .withLock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
            .firstResult();
}

// BookResource — adicionar o helper e usá-lo nas mutações:
private BookEntity findOwnedForUpdate(UUID id) {
    if (id == null) invalid("Identificador de livro inválido.");
    BookEntity book = books.findOwnedForUpdate(currentUser.get().id, id);
    if (book == null) throw new ProblemException(404, ProblemTypes.BOOK_NOT_FOUND,
            "Livro não encontrado", "Livro inexistente ou não pertencente ao usuário.");
    return book;
}

// ReadingSessionResource — adicionar e usar no PATCH/DELETE:
private ReadingSessionEntity findOwnedForUpdate(UUID userId, UUID id) {
    if (id == null) invalid("Identificador de sessão inválido.");
    ReadingSessionEntity session = sessions.findOwnedForUpdate(userId, id);
    if (session == null) throw new ProblemException(404, ProblemTypes.SESSION_NOT_FOUND,
            "Sessão não encontrada", "Sessão inexistente ou não pertencente ao usuário.");
    return session;
}
```

Nos métodos transacionais de BookResource, trocar a leitura inicial por `findOwnedForUpdate(id)` em PATCH JSON/multipart, finish, reopen, DELETE do livro e nas mutações de foto/capa. Em ReadingSessionResource, PATCH/DELETE usam o novo helper. GETs continuam com consultas normais. Assim a segunda transação só lê depois do commit da primeira e preserva os campos omitidos. Alternativa: `@Version` nas duas entidades, migration de versão e conflito HTTP 409, sem retry cego do PATCH.

**Regressão a adicionar:** duas transações PostgreSQL sincronizadas carregam/mutam o mesmo livro ou sessão; assegurar que título+finalização e páginas+minutos sobrevivem, ou que a segunda gravação recebe 409 caso adotado optimistic locking. Os testes atuais cobrem edições sequenciais e concorrência de provisionamento de usuário, mas não esse conflito de domínio.

---

### BUG-022: Renovação OIDC invalida requisições legítimas já em voo

**Severidade:** ALTO
**Arquivo:** `backend/src/main/java/com/folhea/security/ServerTokenStateManager.java`
**Linha(s):** 70–84, 94–104
**Fluxo relacionado:** `backend/src/main/resources/application.properties:102–104`; `backend/src/main/java/com/folhea/shared/NotAuthorizedExceptionMapper.java:28–36`; `frontend/src/app/core/api/csrf.interceptor.ts:38–42`.

**O que acontece e impacto:** na renovação automática, a referência OIDC anterior é removida antes que o navegador receba o novo cookie. Uma segunda requisição enviada com o cookie anterior, enquanto a primeira ainda está em processamento, já não encontra seus tokens. A API devolve 401 e o interceptor chama `sessionExpired()`, redirecionando o leitor para entrar novamente. `DashboardStore.load()` dispara quatro consultas independentes, e o problema também pode ocorrer entre abas. Não depende de a sessão ter realmente expirado no Keycloak.

**Código problemático:**

```java
if (previousReference != null && !previousReference.equals(reference)) {
    store.remove(previousReference);
}
```

```java
return blocking(requestContext, () -> { store.remove(tokenState); return null; });
```

**Evidência:** o probe compilou o `ServerTokenStateManager` atual e simulou uma renovação seguida pela leitura com o cookie de uma requisição já em voo: `in_flight_old_cookie=null refreshed_cookie=valid`. A inspeção do bytecode do Quarkus **3.40.1** instalado confirmou dois pontos: `reAuthenticate()` transforma `getTokens()==null` em falha de autenticação; `processSuccessfulAuthentication()` chama `deleteTokens()` antes de `createTokenState()`, também no refresh. Portanto, corrigir apenas o `store.remove(previousReference)` não resolve o intervalo. Reprodução em `/tmp/folhea-security-audit/SessionRace.java`; não foi executado E2E com Keycloak.

**Solução proposta:** manter a referência opaca durante a renovação de tokens, substituindo seu conteúdo atomicamente; rotacioná-la no login e removê-la imediatamente no logout. No Quarkus fixado no projeto, o contexto identifica o refresh com `refresh_token_grant_response` (atributo interno, exige teste de integração em upgrades). Guardar a referência antes de o framework limpar o cookie:

```java
private static final String RENEWING_REFERENCE =
        ServerTokenStateManager.class.getName() + ".renewingReference";

@Override
public Uni<Void> deleteTokens(RoutingContext context, OidcTenantConfig tenantConfig,
        String tokenState, OidcRequestContext<Void> requestContext) {
    if (context != null && context.get("refresh_token_grant_response") != null
            && SessionCookiePolicy.isValidTicket(tokenState)) {
        context.put(RENEWING_REFERENCE, tokenState);
        return Uni.createFrom().voidItem();
    }
    return blocking(requestContext, () -> { store.remove(tokenState); return null; });
}
```

No início de `saveTokenState()`, antes da verificação de capacidade, usar:

```java
String renewing = context == null ? null : context.get(RENEWING_REFERENCE);
if (renewing != null) {
    if (!store.replaceIfPresent(renewing, authorizationCodeTokens,
            SessionCookiePolicy.MAX_AGE)) {
        throw new io.quarkus.security.AuthenticationFailedException();
    }
    return renewing;
}
```

Adicionar `boolean replaceIfPresent(String reference, AuthorizationCodeTokens tokens, Duration ttl)` ao `TokenStateStore`. A substituição precisa ser atômica para não recriar uma sessão revogada durante o refresh. No `InMemoryTokenStateStore`, implementar com `computeIfPresent` e verificar validade dentro da operação:

```java
@Override
public boolean replaceIfPresent(String reference, AuthorizationCodeTokens value,
        Duration ttl) {
    Instant now = clock.instant();
    return tokens.computeIfPresent(reference, (key, old) ->
            now.isBefore(old.expiresAt())
                    ? new StoredTokens(copy(value), now.plus(ttl)) : null) != null;
}
```

No Redis, guardar o `RedisDataSource` no construtor e implementar a mesma operação sobre o JSON já usado por `save()`:

```java
@Override
public boolean replaceIfPresent(String reference, AuthorizationCodeTokens tokens,
        Duration ttl) {
    try {
        String payload = mapper.writeValueAsString(SerializedAuthorizationTokens.from(tokens));
        return redis.execute("SET", key(reference), payload, "XX", "EX",
                Long.toString(ttl.toSeconds())) != null;
    } catch (JsonProcessingException exception) {
        return false;
    }
}
```

**Explicação e validação necessária:** a referência continua válida durante o refresh, mas `SET XX`/`computeIfPresent` não ressuscitam referências removidas. Preservar a rotação do login e a revogação do logout/exclusão. Acrescentar teste HTTP com duas requisições concorrentes na janela de renovação e um teste de logout concorrente; a sugestão acima não foi aplicada nem validada como correção integrada.

---

### BUG-023: Restore pode deixar o banco parcialmente apagado após erro

**Severidade:** ALTO.

**Arquivo:** `scripts/ops/restore-postgres.sh`.

**Linhas:** 147–156 e 159–168; validação prévia limitada a TOC em 127–141.

**Trecho real:**

```bash
cat -- "$BACKUP_FILE" |
  ops_postgres_exec pg_restore \
    --exit-on-error \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --no-password \
    --username "$DB_USERNAME" \
    --dbname "$DB_NAME"
```

**Cenário e impacto:** o operador restaura sobre uma base existente. O dump passa em `pg_restore --list`, mas ocorre falha posteriormente, por exemplo bloco de dados comprimido corrompido em um dump legado sem checksum, falta de disco ou erro de criação/carga. `--clean` já executou DROP de objetos; `--exit-on-error` apenas interrompe o restante e não desfaz instruções anteriores. A base fica parcialmente removida/restaurada, agravando o incidente e exigindo recuperação adicional. O mesmo problema existe nos caminhos `.dump` e `.gz`.

**Evidência:** leitura de ambos os comandos reais; o teste shell existente usa pg_restore falso que somente consome stdin e não testa atomicidade. `pg_restore --help` local diferencia `--exit-on-error` de `--single-transaction`. A [documentação oficial do PostgreSQL](https://www.postgresql.org/docs/current/app-pgrestore.html) confirma que `--single-transaction` é a opção que aplica todas as instruções ou nenhuma, e que `--list` lista o TOC. Não houve reprodução destrutiva em banco real.

**Solução funcional sugerida:** consolidar os dois caminhos de restauração com transação única (o script atual não usa `--jobs` nem `--create`, portanto não introduz essas incompatibilidades):

```bash
restore_stream() {
  ops_postgres_exec pg_restore \
    --single-transaction \
    --exit-on-error \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --no-password \
    --username "$DB_USERNAME" \
    --dbname "$DB_NAME"
}

case "$BACKUP_FILE" in
  *.gz) gzip -dc -- "$BACKUP_FILE" | restore_stream ;;
  *) cat -- "$BACKUP_FILE" | restore_stream ;;
esac
```

Manter checksum, validação gzip/TOC e writers parados conforme runbook. Verificar a correção com PostgreSQL isolado e erro injetado depois dos primeiros objetos; a base anterior deve permanecer intacta. Ajustar `docs/backup-restore.md` ao corrigir.

---


## MEDIO

### BUG-024: Limpar autor ou edição mostra sucesso sem remover os valores

**Severidade:** MÉDIO.

**Arquivo:** `frontend/src/app/features/books/book-detail.component.ts`, linha 84. Contrato confirmado em `backend/src/main/java/com/folhea/book/BookResource.java`, linhas 116, 118, 218 e 237–252.

**Cenário:** abrir um livro com autor/edição, apagar esses campos e salvar. O frontend envia `null`. O backend interpreta `null` como campo não alterado; somente uma string vazia chega a `blankToNull`. A tela mostra “Alterações salvas.”, mas os dados antigos reaparecem ao reabrir o livro. `totalPages` não sofre desse problema: o DTO possui controle explícito de presença desse campo.

**Trecho real:**

```ts
this.run(this.store.updateBook(this.id, { title, author: this.form.controls.author.value.trim() || null, edition: this.form.controls.edition.value.trim() || null, totalPages: this.totalPages.value }), 'Alterações salvas.', false);
```

```java
if (request.author() != null) book.author = blankToNull(request.author());
// ...
if (request.edition() != null) book.edition = blankToNull(request.edition());
```

**Correção compatível com o contrato atual:** preservar a string vazia no PATCH do formulário de edição. O POST pode manter o comportamento atual.

```ts
this.run(this.store.updateBook(this.id, {
  title,
  author: this.form.controls.author.value.trim(),
  edition: this.form.controls.edition.value.trim(),
  totalPages: this.totalPages.value
}), 'Alterações salvas.', false);
```

**Evidência:** reprodução temporária com formulário/store/cliente reais capturou `author: null` e `edition: null` ao limpar os campos. Com resposta equivalente às condições do método Java, o componente publicou sucesso e o store permaneceu com `Autora`/`2a`. A fronteira HTTP foi simulada; a semântica Java foi verificada por leitura direta, sem executar integração real. Testes E2E existentes usam `Object.assign(book, metadata)` no mock (`frontend/e2e/fixtures.ts`), que apaga campos com null e não reproduz a semântica real do PATCH.

---

### BUG-025: Navegar durante o cadastro deixa um livro temporário órfão

**Severidade:** MÉDIO.

**Arquivos:** `frontend/src/app/features/books/new-book.component.ts`, linha 47; `frontend/src/app/core/state/dashboard.store.ts`, linhas 311–328 e 73–79.

**Cenário:** clicar em Adicionar livro e usar a navegação do shell antes da resposta HTTP. `takeUntilDestroyed` cancela a inscrição/requisição. O store já inseriu um livro `local-book-*`, mas só remove esse registro em `next` ou `catchError`; unsubscribe não chama nenhum deles. O livro continua na estante com “Atualizando progresso…” e sem ações. `load()` não recarrega o store já inicializado, de modo que navegar entre telas não corrige o estado.

**Trechos reais:**

```ts
this.store.addBook({ title, author: this.form.controls.author.value.trim() || null, edition: this.form.controls.edition.value.trim() || null, totalPages: this.totalPages.value }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
```

```ts
const optimisticId = `local-book-${Date.now()}`;
const optimistic: Book = { id: optimisticId, ...draft, status: 'READING', createdAt: now, updatedAt: now };
this.booksState.update((books) => [optimistic, ...books]);
// ...
catchError((error: unknown) => {
  this.booksState.update((books) => books.filter((item) => item.id !== optimisticId));
  this.syncCurrentBook();
  this.setMutationError(error, 'Não foi possível cadastrar o livro.');
  return throwError(() => error);
})
```

**Correção funcional:** se mantida a criação otimista, tratar também o cancelamento. Adicionar `finalize` aos imports RxJS; declarar `let settled = false` antes de montar o pipeline; marcar `settled = true` no início de `tap.next` e de `catchError`; acrescentar o operador abaixo após o `catchError` existente:

```ts
finalize(() => {
  if (settled) return;
  this.booksState.update(books => books.filter(book => book.id !== optimisticId));
  this.syncCurrentBook();
  this.loadBooks();
})
```

O GET reconcilia eventual persistência que o servidor tenha concluído antes do cancelamento. Se a operação precisar continuar mesmo após sair da tela, outra solução é fazer o store possuir o ciclo de vida da mutação, mantendo a inscrição do componente apenas para a apresentação.

**Evidência:** reprodução inicializou o store, submeteu o componente e destruiu a fixture antes da resposta. `request.cancelled === true`; `books().length === 1` com ID local; `selectableBooks().length === 0`; novo `load()` não emitiu GET. O teste não afirma se um servidor real já teria persistido o livro: o defeito confirmado é o estado temporário órfão no cliente.

---

### BUG-026: Rollback de uma exclusão restaura outras operações já confirmadas

**Severidade:** MÉDIO.

**Arquivo:** `frontend/src/app/core/state/dashboard.store.ts`, linhas 398–408. O mesmo padrão aparece em `updateSession` (441–454) e `deleteSession` (463–475).

**Cenário:** iniciar exclusão de A; antes da resposta, navegar e excluir B. B responde 204 e o refresh confirma somente A na biblioteca. Quando a exclusão de A falha depois, o código restaura a lista inteira capturada antes das duas operações: B reaparece, embora tenha sido apagado no servidor. O erro também pode sumir com novas sessões confirmadas porque o rollback restaura `previousSessions` integralmente. A proteção `busy` pertence a cada componente, não ao store, e o shell permite navegação durante a requisição.

**Trecho real:**

```ts
const previousBooks = this.booksState();
const previousSessions = this.sessionsState();
this.booksState.update((books) => books.filter((book) => book.id !== id));
this.sessionsState.update((sessions) => sessions.filter((session) => session.bookId !== id));
// ...
catchError((error: unknown) => {
  this.booksState.set(previousBooks);
  this.sessionsState.set(previousSessions);
  this.syncCurrentBook();
  this.setMutationError(error, 'Não foi possível excluir o livro.');
  return throwError(() => error);
})
```

**Correção funcional:** substituir restaurações de snapshots globais por recarga autoritativa. Por exemplo, o ramo de falha de `deleteBook` pode ser:

```ts
catchError((error: unknown) => {
  this.loadBooks();
  this.loadSessions();
  this.loadDashboard();
  this.setMutationError(error, 'Não foi possível excluir o livro.');
  return throwError(() => error);
})
```

Remover as capturas `previousBooks`/`previousSessions` que deixam de ser usadas. Em `updateSession` e `deleteSession`, substituir `this.sessionsState.set(previous)` por `this.loadSessions()` e remover a captura `previous`. Isso preserva as mutações confirmadas e mostra os estados de erro já existentes se a reconciliação também falhar. Outra implementação válida é aplicar as mudanças de lista somente após confirmação, eliminando o rollback otimista nesses métodos.

**Evidência:** reprodução com duas chamadas reais do store e respostas HTTP controladas: B foi excluído com 204, GET `/books` retornou `[A]`, depois DELETE A retornou 503. O resultado foi `books().map(id) === ['book', 'other']`, restaurando B. A base de dados não foi alterada pela reprodução e o bug não ressuscita registros no servidor; a inconsistência está no cliente.

---

### BUG-027: Salvar uma leitura descarta métricas válidas de outros livros

**Severidade:** MÉDIO.

**Arquivo:** `frontend/src/app/core/state/dashboard.store.ts`, linhas 119–130 e 206–208.

**Cenário:** com 100 livros carregados, o leitor clica em Carregar mais livros no formulário de leitura e registra uma sessão enquanto a segunda página ainda chega. O refresh dessa sessão incrementa uma revisão global. Quando a página de livros retorna, os dados dos novos livros entram em `booksState`, mas suas métricas são descartadas porque a revisão global mudou — mesmo para livros que não sofreram mutação. Eles aparecem com “Progresso indisponível” apesar de a API ter retornado métricas válidas. Não há recarga automática desses livros.

**Trecho real:**

```ts
const revision = this.bookStatsRevision;
const metricsRequests = new Map(this.bookStatsRequests);
// ...
for (const book of books) {
  if (revision === this.bookStatsRevision && (metricsRequests.get(book.id) ?? 0) === (this.bookStatsRequests.get(book.id) ?? 0)) this.acceptBookStats(book);
}
```

```ts
private refreshBookMetrics(...ids: (string | undefined)[]): void {
  this.bookStatsRevision++;
  for (const id of new Set(ids.filter((id): id is string => !!id))) this.loadBookStats(id);
}
```

**Correção funcional:** a versão por ID já existe e deve decidir se as métricas daquele livro ficaram obsoletas. Remover a guarda global e a captura `revision` deste método:

```ts
for (const book of books) {
  const before = metricsRequests.get(book.id) ?? 0;
  const current = this.bookStatsRequests.get(book.id) ?? 0;
  if (before === current) this.acceptBookStats(book);
}
```

O livro alterado continua protegido pela versão individual, e os demais recebem os dados válidos da página. Se a revisão global ficar sem usos depois disso, remover também sua propriedade e incrementos.

**Evidência:** reprodução sem acessos a campos privados: carregou 100 livros, iniciou `loadMoreBooks()`, persistiu sessão de A e concluiu o GET de métricas de A; então entregou a segunda página com B, sem sessões. `getBook('other')` retornou B, mas `bookStats('other') === null` e `bookStatsError('other') === null`, apesar de o payload possuir `pagesRead: 0`, média null e percentual null válidos.

---

### BUG-028: Resposta atrasada de sessão repõe cache de livro excluído

**Severidade:** MÉDIO.

**Arquivo:** `frontend/src/app/core/state/dashboard.store.ts`, linhas 233–237 e 405. Contrato de exclusão confirmado em `backend/src/main/java/com/folhea/book/BookResource.java:126` e na FK de `backend/src/main/resources/db/migration/V001__initial_schema.sql:28` (`ON DELETE CASCADE`).

**Cenário:** abrir uma sessão por link direto, sair antes da resposta e excluir seu livro. O DELETE 204 remove os caches e a cascata remove a sessão no banco, mas não invalida o GET de detalhe da sessão que ainda está em voo. Se esse GET retornar depois, adiciona novamente a sessão ao cache. Ao retornar pelo histórico do navegador, o editor usa o cache sem consultar GET `/sessions/{id}`, mostra a sessão já excluída e tenta carregar um livro inexistente. Salvar termina em 404.

**Trecho real:**

```ts
next: (session) => {
  if (request !== this.sessionDetailRequests.get(id)) return;
  this.sessionDetails.update((sessions) => this.mergeById(sessions, [session]));
  this.completeSessionDetail(id); this.loadBook(session.bookId);
},
```

O `tap` de `deleteBook` filtra `sessionDetails`, mas não altera `sessionDetailRequests` nem verifica se a sessão recebida pertence a um livro já excluído. As proteções presentes em `deleteSession` cobrem apenas o DELETE direto da própria sessão.

**Correção funcional:** manter uma marca por livro cuja exclusão foi confirmada e recusar respostas anteriores de sessões desse livro. Adicionar ao store:

```ts
private readonly deletedBookIds = new Set<string>();
```

No início do `tap` bem-sucedido de `deleteBook`:

```ts
this.deletedBookIds.add(id);
```

Antes de inserir no cache em `loadSession`:

```ts
if (request !== this.sessionDetailRequests.get(id)) return;
if (this.deletedBookIds.has(session.bookId)) {
  this.completeSessionDetail(id);
  return;
}
this.sessionDetails.update(sessions => this.mergeById(sessions, [session]));
this.completeSessionDetail(id);
this.loadBook(session.bookId);
```

Essa marca deve permanecer pelo tempo de vida do cache e ser limpa junto dele se futuramente houver troca de conta sem navegação completa. Também é possível cancelar todas as consultas de detalhe afetadas, desde que o vínculo com o livro seja conhecido antes da resposta.

**Evidência:** GET de sessão iniciado antes do DELETE; DELETE do livro respondeu 204; listagens novas retornaram vazias; o GET antigo foi liberado; GET posterior do livro respondeu 404. Ainda assim `getSession('session')` retornou a sessão apagada. Reprodução em memória/HTTP simulado, sem executar deleção real.

---

### BUG-029: Normalização JPEG remove orientação EXIF sem girar os pixels

**Local:** `backend/src/main/java/com/folhea/book/BookPhotoNormalizer.java:48–67`; chamadas públicas em `BookResource.java:164–167` e `BookCoverService.java:35–38`.

**Cenário concreto:** um cliente envia diretamente JPEG RAW ou multipart de câmera com pixels 40×20 e EXIF Orientation=6 (visualização correta 20×40). O normalizador ignora metadados, lê os pixels brutos e os recodifica mantendo 40×20. Como o EXIF é removido, a foto fica permanentemente deitada. Orientações espelhadas sofrem o mesmo problema.

**Limite de impacto:** o frontend atual usa `createImageBitmap(file, { imageOrientation: 'from-image' })` em `frontend/src/app/features/books/cover-image.ts:65`, portanto **o fluxo atual dessa UI já compensa a orientação**. O problema confirmado está no normalizador e nos caminhos HTTP RAW/multipart aceitos, quando o cliente não pré-normaliza. Não foi demonstrada falha na UI atual. Não alterar o encoder histórico V010, que deve continuar congelado.

**Trecho real:**

```java
reader.setInput(input, true, true);
int width = reader.getWidth(0), height = reader.getHeight(0);
// ... limite de dimensões ...
BufferedImage decoded = reader.read(0);
// ...
double scale = Math.min(1d, (double)MAX_SIDE / Math.max(width, height));
int targetWidth = Math.max(1, (int)Math.round(width * scale));
int targetHeight = Math.max(1, (int)Math.round(height * scale));
// ...
graphics.drawImage(decoded, 0, 0, targetWidth, targetHeight, null);
```

**Evidência executada:** `/tmp/folhea-domain-audit/Orientation.java` cria JPEG sintético com APP1/Exif TIFF válido e Orientation=6, passa pelo **BookPhotoNormalizer atual compilado da fonte**, e verifica:

```text
ORIENTATION_6 expected=20x40 actual=40x20 exif_retained=false
```

O exemplo de correção em `/tmp/folhea-domain-audit/OrientationCorrection.java` usa o parser TwelveMonkeys **3.15.3 já presente nas dependências transitivas**, foi compilado/executado com a mesma fixture, e valida também as cores após a rotação:

```text
CORRECTION orientation=6 output=20x40 top=red bottom=blue
```

**Correção funcional para JPEG:** ler somente a orientação EXIF antes de descartar os metadados; calcular o tamanho orientado e aplicar a transformação durante o desenho na imagem RGB de saída. Dessa forma, não precisa manter outro bitmap do tamanho da entrada. Usar os helpers abaixo (imports presentes no arquivo temporário). O parser lê os segmentos limitados pelos bytes de entrada; IOException de metadados inválidos deve cair no tratamento existente de imagem inválida.

```java
// Depois de validar assinatura/tamanho; dentro do try que trata IOException:
int orientation = type.equals("image/jpeg") ? jpegOrientation(source) : 1;
// Depois da leitura e validação das dimensões de entrada:
int orientedWidth = orientation >= 5 ? height : width;
int orientedHeight = orientation >= 5 ? width : height;
double scale = Math.min(1d, (double) MAX_SIDE / Math.max(orientedWidth, orientedHeight));
int targetWidth = Math.max(1, (int) Math.round(orientedWidth * scale));
int targetHeight = Math.max(1, (int) Math.round(orientedHeight * scale));
// Dentro do bloco graphics, após fundo branco/hints; substituir drawImage:
graphics.scale((double) targetWidth / orientedWidth, (double) targetHeight / orientedHeight);
graphics.drawImage(decoded, orientationTransform(orientation, width, height), null);
```

O loop de qualidade/redução de dimensões e a gravação JPEG sem metadados permanecem. Adicionar fixtures 1–8; este achado/reprodução/correção está limitado a JPEG. PNG/WebP com EXIF precisam de casos próprios antes de afirmar cobertura da orientação nesses formatos.

```java
import java.awt.geom.AffineTransform;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import javax.imageio.stream.MemoryCacheImageInputStream;
import com.twelvemonkeys.imageio.metadata.jpeg.JPEGSegmentUtil;
import com.twelvemonkeys.imageio.metadata.tiff.TIFFReader;

// Helpers a inserir no normalizador:
  static int jpegOrientation(byte[] bytes) throws IOException {
    try (var in = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
      for (var segment : JPEGSegmentUtil.readSegments(in, 0xffe1, "Exif")) {
        try (var data = segment.data()) {
          // data() already skipped Exif plus its first NUL; TIFF follows the second NUL.
          if (data.read() != 0) continue;
          try (var tiff = new MemoryCacheImageInputStream(data)) {
            var entry = new TIFFReader().read(tiff).getEntryById(0x112);
            if (entry != null && entry.getValue() instanceof Number number) {
              int orientation = number.intValue();
              if (orientation >= 1 && orientation <= 8) return orientation;
            }
          }
        }
      }
    }
    return 1;
  }
  static AffineTransform orientationTransform(int orientation, int w, int h) {
    return switch (orientation) {
      case 2 -> new AffineTransform(-1, 0, 0, 1, w, 0);
      case 3 -> new AffineTransform(-1, 0, 0, -1, w, h);
      case 4 -> new AffineTransform(1, 0, 0, -1, 0, h);
      case 5 -> new AffineTransform(0, 1, 1, 0, 0, 0);
      case 6 -> new AffineTransform(0, 1, -1, 0, h, 0);
      case 7 -> new AffineTransform(0, -1, -1, 0, h, w);
      case 8 -> new AffineTransform(0, -1, 1, 0, 0, w);
      default -> new AffineTransform();
    };
  }
```

---

### BUG-030: Inicialização do limitador Redis perde incrementos entre instâncias

**Severidade:** MÉDIO
**Arquivo:** `backend/src/main/java/com/folhea/security/store/RedisRateLimitStore.java`
**Linha(s):** 27–35

**O que acontece e impacto:** `INCR` e `SETEX(..., "1")` são operações separadas. Com duas instâncias compartilhando Redis, A obtém 1, B incrementa para 2 e A sobrescreve o contador com 1. A próxima chamada é aceita novamente. O `synchronized` de `RateLimiter.check()` protege apenas uma JVM. No Compose com uma única instância esse intercalamento é impedido pelo lock local; o achado se aplica a réplicas ou processos simultâneos, inclusive durante uma implantação com sobreposição. Uma interrupção entre os dois comandos também pode deixar uma chave sem TTL.

**Código problemático:**

```java
long count = strings.incr(redisKey);
if (count == 1) values.setex(redisKey, windowSeconds, "1");
```

**Evidência:** duas instâncias da classe atual, compilada sem alteração, com comandos Redis controlados para intercalar a segunda chamada antes do primeiro `SETEX`: `accepted=3 limit=2 persisted_count=2`. Probe: `/tmp/folhea-security-audit/RedisRace.java`. Simulação determinística das respostas Redis; não foi exercitado um cluster real.

**Solução proposta:** executar incremento e expiração em um único script Lua. Substituir os campos/constructor de comandos separados pelo datasource e o método `check()` por:

```java
private final RedisDataSource redis;
private static final String INCREMENT_WITH_TTL = """
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    return count
    """;

public RedisRateLimitStore(RedisDataSource redis) {
    this.redis = redis;
}

@Override
public RateLimiter.Decision check(String key, int limit, Duration duration, Instant now) {
    long seconds = Math.max(1, duration.toSeconds());
    String redisKey = KEY_PREFIX + key + ":" + now.getEpochSecond() / seconds;
    long count = redis.execute("EVAL", INCREMENT_WITH_TTL, "1", redisKey,
            Long.toString(seconds)).toLong();
    long retryAfter = Math.max(1, seconds - now.getEpochSecond() % seconds + 1);
    return new RateLimiter.Decision(count <= limit, retryAfter);
}
```

**Explicação da correção:** o Redis executa o script atomicamente; não existe escrita posterior de `1` capaz de apagar contagens concorrentes, nem intervalo entre incremento e instalação do TTL. Atualizar os testes que usam o construtor interno para testar o script com Redis e duas instâncias.

---

### BUG-031: Barra final no destino S3 faz a verificação procurar outra chave

**Severidade:** MÉDIO.

**Arquivo:** `scripts/ops/backup-postgres.sh`.

**Linhas:** 163–173 e 178–181.

**Trecho real:**

```bash
external_uri="${BACKUP_EXTERNAL_DESTINATION%/}/$artifact_name"
# ...
s3_location="${BACKUP_EXTERNAL_DESTINATION#s3://}"
# ...
s3_prefix="${s3_location#*/}"
s3_key="$s3_prefix/$artifact_name"
# ...
"$aws_bin" s3 cp --only-show-errors --no-progress "$artifact" "$external_uri"
"$aws_bin" s3api head-object --bucket "$s3_bucket" --key "$s3_key" >/dev/null
```

**Cenário e impacto:** configuração válida e usual `BACKUP_EXTERNAL_DESTINATION=s3://bucket/prefix/`. O upload grava `prefix/arquivo.dump`, mas o `head-object` verifica `prefix//arquivo.dump`. Mesmo com upload bem-sucedido, o job falha e não executa a retenção. Repetições diárias geram falsos alertas e deixam os dumps locais acumularem. `s3://bucket/` também é aceito inicialmente e falha depois por prefixo vazio.

**Reprodução isolada executada:**

```text
python3 -B /tmp/folhea-infra-audit/probe_backup_destination.py
S3 suffix='prefix' exit=0
S3 suffix='prefix/' exit=1
MOCK missing uploaded key: s3://bucket/prefix//folhea-folhea-<timestamp>.dump
```

O probe executa o script real com Docker/AWS falsos, grava quais URIs foram enviadas e exige a mesma chave no `head-object`. Não acessa banco, Docker daemon ou AWS.

**Solução funcional sugerida:** substituir a construção independente das URIs/chaves por uma normalização única antes dos uploads:

```bash
external_base="$BACKUP_EXTERNAL_DESTINATION"
while [[ "$external_base" == */ ]]; do
  external_base="${external_base%/}"
done
[[ "$external_base" == s3://?* ]] || ops_die "s3 external destination is missing a bucket"
s3_location="${external_base#s3://}"
s3_bucket="${s3_location%%/*}"
[[ -n "$s3_bucket" ]] || ops_die "s3 external destination is missing a bucket"
s3_prefix=""
if [[ "$s3_location" == */* ]]; then
  s3_prefix="${s3_location#*/}"
fi
s3_key="${s3_prefix:+${s3_prefix}/}${artifact_name}"
s3_checksum_key="${s3_key}.sha256"
external_uri="s3://${s3_bucket}/${s3_key}"
external_checksum_uri="s3://${s3_bucket}/${s3_checksum_key}"
```

Preservar as chamadas de upload/head existentes usando as variáveis normalizadas. Cobrir bucket/prefixo com e sem barra final no teste shell; documentar a normalização em `docs/backup-restore.md`.

---

### BUG-032: Health check aprova redirecionamento para uma página HTML

**Severidade:** MÉDIO.

**Arquivo:** `scripts/ci/health-check.mjs`.

**Linhas:** 15–23. Consumidor: `.github/workflows/cd.yml`, job `health-check`.

**Trecho real:**

```javascript
const response = await fetch(new URL(path, baseUrl));
if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
const body = await response.json().catch(() => ({}));
if (body.status && body.status !== 'UP') throw new Error(`${path} reported ${body.status}`);
```

**Cenário e impacto:** proxy/autenticação passa a redirecionar o endpoint de saúde para login/Home. `fetch` segue o redirect, recebe HTML 200; o erro de JSON vira `{}` e não existe `body.status` para rejeitar. O job registra sucesso mesmo sem receber a resposta do endpoint de saúde. O problema também afeta o `/healthz` público configurado pelo runbook: chegar a outra página 200 não comprova que `/healthz` está disponível. Não confundir esse achado com a opção deliberada de monitorar apenas a borda pública.

**Reprodução isolada executada:**

```text
python3 -B /tmp/folhea-infra-audit/probe_health_check.py
Health mocked redirect-to-login exit=0
health check passed on attempt 1: /q/health/live, /q/health/ready
```

O script original foi executado com `fetch` falso que retorna `redirected: true`, HTML inválido como JSON e status 200. Não houve HTTP real. O próprio `docs/operations.md:350`–356 reconhece a limitação e pede uma checagem curl manual; isso não corrige o falso positivo do job automatizado.

**Solução funcional sugerida para os dois contratos hoje documentados:**

```javascript
const response = await fetch(new URL(path, baseUrl), {
  redirect: 'error',
  signal: AbortSignal.timeout(10_000)
});
if (response.status !== 200) {
  throw new Error(`${path} returned HTTP ${response.status}`);
}
if (path === '/healthz') {
  await response.arrayBuffer(); // A borda documentada responde 200 vazio.
} else {
  const body = await response.json();
  if (body.status !== 'UP') throw new Error(`${path} did not report UP`);
}
```

Manter o contrato explícito para novos endpoints configuráveis. Cobrir redirect, HTML, `{}`, status DOWN e healthz vazio. Atualizar a ressalva do runbook depois da correção.

---

## BAIXO

Nenhum code smell foi incluído apenas por estilo, ausência genérica de retry ou match de busca, sem cenário concreto de impacto.

## Verificações da auditoria, antes das correções

| Verificação | Resultado e alcance |
|-------------|---------------------|
| `cd frontend && npm test -- --reporter=dot` | **158 testes em 29 arquivos passaram**, com o `node_modules` já instalado. |
| `cd frontend && npm run typecheck` | Passou. |
| `cd frontend && npm run lint` | Passou. |
| `cd frontend && npm run test:seo` | Passou; arquivo de teste contém quatro casos. |
| Vitest temporário `/tmp/folhea-frontend-audit/audit.spec.ts` | **6 verificações diagnósticas passaram**, afirmando os estados indevidos; cinco sustentam os bugs e uma é observação não contabilizada. Não são testes de correções. |
| `python3 -B -m unittest discover -s scripts/ops/tests -p 'test_*.py'` | **95/95 passaram**, fixtures/mocks. |
| `python3 -B -m unittest discover -s scripts/ci/tests -p 'test_*.py'` | 58 casos: **46 passaram; 12 não executaram satisfatoriamente por ausência de `gitleaks`** (6 falhas e 6 erros consequentes). |
| Subsuítes Python `test_public_image_archive.py` e `test_workflow_security.py` | **39/39** e **5/5** passaram. São subconjuntos do total CI anterior, não somar novamente. |
| `bash scripts/ops/tests/test-backup-restore.sh` | 10 cenários passaram usando Docker/AWS falsos. Não demonstra atomicidade real do restore. |
| `bash scripts/tests/test-dev-backend.sh` e `bash scripts/tests/test-versao.sh` | 9 e 10 cenários passaram, respectivamente. |
| `bash scripts/tests/test-render-realm.sh` | Bloqueado por `spawnSync bash EPERM`. Harness Python alternativo chamou o renderer real: seis combinações dev/prod × três origins passaram. |
| `node --test scripts/ci/tests/public-contract.test.mjs scripts/ci/tests/seo-validator.test.mjs scripts/ci/tests/domain-surface.test.mjs` | Runner não concluiu satisfatoriamente; subprocessos Node apresentaram restrição de execução. Execução direta de seo-validator: dois casos aprovados e um falhou com stdout vazio. **Inconclusivo**, não classificado como bug do produto. |
| Maven com POM atual | **Bloqueado antes dos testes:** `release version 27 not supported` no JDK 25.0.4.1 disponível. Tentativa inicial também encontrou lock do cache Maven sem permissão; repetir offline com `-Daether.syncContext.named.factory=noop` permitiu chegar à compilação. |
| Probes Java de stores e imagem | Fontes atuais compilados diretamente com JDK 25 e dependências em cache; comportamentos reproduzidos. Não equivalem ao build Java 27. |
| Probe ORM | Hibernate 7.4.9.Final, entidades atuais, H2 2.4.240; perda de atualização reproduzida. Não substitui teste PostgreSQL. |
| Probes de S3 e health check | Executaram os scripts reais com AWS/Docker/fetch simulados; falhas reproduzidas. |

### Limites de runtime e dependências na auditoria inicial

Os checks do frontend usaram **Node 26.8.2, Angular/core 22.1.5, CLI 22.1.7, TypeScript 6.0.3, Vitest 5.0.0, ESLint 10.10.0 e jsdom 30.0.1**. Esses pacotes instalados divergem do manifesto/lock atual (Angular 22.2.3, CLI 22.2.2, Vitest 5.0.4, ESLint 10.12.0 e jsdom 30.1.2). `@angular/build` não está instalado. Assim, os checks aprovados **não validam uma instalação limpa do lock atual**; build Angular/SSG e E2E permanecem pendentes.

O ambiente só disponibilizou JDK até 25. A tentativa de acessar a API Adoptium para obter o JDK 27 falhou com `Could not resolve host: api.adoptium.net`. Não se alterou o release do projeto para contornar o problema. Para repetir os gates, provisionar JDK 27, instalar as dependências do lock e Gitleaks e executar em ambiente que permita os subprocessos/containers necessários.

A versão Quarkus 3.40.1 declarada foi conferida na [página oficial de releases do Quarkus](https://quarkus.io/); a disponibilidade de Temurin 27 foi conferida no [inventário oficial Eclipse CBI](https://eclipse.dev/cbi/jiro/Tools/). Isso não é uma auditoria completa de versões/CVEs de todas as dependências. Nenhuma dependência foi modificada na revisão.

## Observações gerais e falsos positivos descartados

- Ownership é verificado antes de ler fotos/avaliar ETags, e as sessões têm consultas por proprietário e FK composta de consistência.
- Listagens usam paginação e agregados em lote; exportação usa streaming JDBC, `fetchSize(1)`, isolamento repeatable-read e fechamento de recursos.
- Exclusão de conta tem intenção durável, revogação por subject e recuperação; não foi demonstrada ressurreição de conta nesse fluxo.
- O normalizador verifica dimensões antes de decodificar, limita bytes de saída e fecha recursos ImageIO; a V010 tem encoder histórico separado, que deve continuar congelado.
- Os IDs locais são filtrados dos livros selecionáveis; sucesso de leitura depende da resposta HTTP; CSRF tem limpeza após erro; o fuso da conta é usado; o listener PWA tem cleanup. Os achados históricos correspondentes não foram reabertos.
- `period=all` começar na primeira sessão corresponde ao contrato atual em `docs/api/domain-contract.md`; não foi contado como bug, embora exclua finalizações anteriores/sem sessões.
- Analytics está explicitamente pausado pelo AUTH-01, portanto ausência de envio não foi contada como regressão.
- A flag `bookDetailLoading` pode permanecer ligada após uma chamada concorrente de métricas, mas não foi demonstrado impacto autônomo adicional na UI; ficou fora da contagem.
- O Compose base usa Keycloak em desenvolvimento, enquanto os overlays de produção selecionam `start --optimized`; o antigo BUG-017 não foi repetido como falha atual de produção.
- A infraestrutura valida identidades/digests, escapa segredos renderizados, usa permissões restritas, journal de deploy e checksum/cópia antes da retenção de backups.
- Não foram inspecionados visualmente assets PNG, nem auditados integralmente lockfiles, binários, código de terceiros, artefatos gerados ou todo o histórico Git. Arquivos de testes/operacionais citados como consulta parcial não devem ser interpretados como leitura integral.

## Inventário da revisão atual

Lista deduplicada de arquivos consultados. Código de produção e fluxos principais foram lidos; parte dos testes extensos, scripts E2E/SEO e documentação foi consultada por trechos. A execução de uma suíte não implica revisão manual de cada teste. `docker-compose.override.yml` é configuração local ignorada pelo Git; somente sua estrutura foi consultada, sem reproduzir segredos.

<details>
<summary>Arquivos consultados na revisão de 16/10/2026</summary>

```text
.dockerignore
.env.example
.github/workflows/cd.yml
.github/workflows/ci.yml
.github/workflows/security.yml
.gitignore
.gitleaks.toml
.vscode/settings.json
AGENTS.md
README.md
backend/.gitignore
backend/.mvn/wrapper/maven-wrapper.properties
backend/pom.xml
backend/src/main/java/com/folhea/auth/AuthenticationRedirectFilter.java
backend/src/main/java/com/folhea/auth/BffAuthResource.java
backend/src/main/java/com/folhea/auth/PostLogoutResource.java
backend/src/main/java/com/folhea/auth/RecentAuthentication.java
backend/src/main/java/com/folhea/book/BookCoverEntity.java
backend/src/main/java/com/folhea/book/BookCoverService.java
backend/src/main/java/com/folhea/book/BookEntity.java
backend/src/main/java/com/folhea/book/BookPhotoEntity.java
backend/src/main/java/com/folhea/book/BookPhotoNormalizer.java
backend/src/main/java/com/folhea/book/BookPhotoService.java
backend/src/main/java/com/folhea/book/BookReadService.java
backend/src/main/java/com/folhea/book/BookRepository.java
backend/src/main/java/com/folhea/book/BookResource.java
backend/src/main/java/com/folhea/book/BookStats.java
backend/src/main/java/com/folhea/book/BookStatus.java
backend/src/main/java/com/folhea/identity/CurrentUser.java
backend/src/main/java/com/folhea/reading/ReadingSessionEntity.java
backend/src/main/java/com/folhea/reading/ReadingSessionRepository.java
backend/src/main/java/com/folhea/reading/ReadingSessionResource.java
backend/src/main/java/com/folhea/security/AbuseProtectionFilter.java
backend/src/main/java/com/folhea/security/BffSessionCookieFilter.java
backend/src/main/java/com/folhea/security/CsrfCookiePolicy.java
backend/src/main/java/com/folhea/security/CsrfResource.java
backend/src/main/java/com/folhea/security/CsrfTokenService.java
backend/src/main/java/com/folhea/security/OidcLogoutListener.java
backend/src/main/java/com/folhea/security/OidcSessionCookieSettings.java
backend/src/main/java/com/folhea/security/RateLimiter.java
backend/src/main/java/com/folhea/security/RateLimiterProducer.java
backend/src/main/java/com/folhea/security/SecureRandomProducer.java
backend/src/main/java/com/folhea/security/SecurityBoundaryFilter.java
backend/src/main/java/com/folhea/security/SecurityHeadersFilter.java
backend/src/main/java/com/folhea/security/SecurityPolicy.java
backend/src/main/java/com/folhea/security/ServerTokenStateManager.java
backend/src/main/java/com/folhea/security/SessionCookiePolicy.java
backend/src/main/java/com/folhea/security/SessionCookieSettings.java
backend/src/main/java/com/folhea/security/store/CsrfTokenStore.java
backend/src/main/java/com/folhea/security/store/InMemoryCsrfTokenStore.java
backend/src/main/java/com/folhea/security/store/InMemoryRateLimitStore.java
backend/src/main/java/com/folhea/security/store/InMemoryTokenStateStore.java
backend/src/main/java/com/folhea/security/store/RateLimitStore.java
backend/src/main/java/com/folhea/security/store/RedisCsrfTokenStore.java
backend/src/main/java/com/folhea/security/store/RedisRateLimitStore.java
backend/src/main/java/com/folhea/security/store/RedisTokenStateStore.java
backend/src/main/java/com/folhea/security/store/SecurityStoreProducer.java
backend/src/main/java/com/folhea/security/store/SerializedAuthorizationTokens.java
backend/src/main/java/com/folhea/security/store/SubjectReference.java
backend/src/main/java/com/folhea/security/store/TokenStateStore.java
backend/src/main/java/com/folhea/shared/BadRequestExceptionMapper.java
backend/src/main/java/com/folhea/shared/ClockProducer.java
backend/src/main/java/com/folhea/shared/ConstraintViolationMapper.java
backend/src/main/java/com/folhea/shared/DatabaseExceptionMapper.java
backend/src/main/java/com/folhea/shared/IllegalArgumentExceptionMapper.java
backend/src/main/java/com/folhea/shared/JsonProcessingExceptionMapper.java
backend/src/main/java/com/folhea/shared/NotAuthorizedExceptionMapper.java
backend/src/main/java/com/folhea/shared/NotFoundExceptionMapper.java
backend/src/main/java/com/folhea/shared/OpenApiConfiguration.java
backend/src/main/java/com/folhea/shared/ProblemException.java
backend/src/main/java/com/folhea/shared/ProblemExceptionMapper.java
backend/src/main/java/com/folhea/shared/ProblemResponse.java
backend/src/main/java/com/folhea/shared/ProblemResponses.java
backend/src/main/java/com/folhea/shared/ProblemTypes.java
backend/src/main/java/com/folhea/shared/ProblemWebExceptionMapper.java
backend/src/main/java/com/folhea/shared/ProcessingExceptionMapper.java
backend/src/main/java/com/folhea/shared/QueryLimits.java
backend/src/main/java/com/folhea/shared/RequestCorrelationFilter.java
backend/src/main/java/com/folhea/shared/StrictJsonNumbers.java
backend/src/main/java/com/folhea/shared/TimeProvider.java
backend/src/main/java/com/folhea/shared/UnhandledExceptionMapper.java
backend/src/main/java/com/folhea/statistics/StatisticsResource.java
backend/src/main/java/com/folhea/statistics/StatisticsService.java
backend/src/main/java/com/folhea/statistics/StreakCalculator.java
backend/src/main/java/com/folhea/user/AccountDeletionIntent.java
backend/src/main/java/com/folhea/user/AccountDeletionPersistence.java
backend/src/main/java/com/folhea/user/AccountDeletionRecovery.java
backend/src/main/java/com/folhea/user/AccountDeletionService.java
backend/src/main/java/com/folhea/user/AccountExportService.java
backend/src/main/java/com/folhea/user/KeycloakAdminClient.java
backend/src/main/java/com/folhea/user/KeycloakAdminRestClient.java
backend/src/main/java/com/folhea/user/KeycloakTokenRestClient.java
backend/src/main/java/com/folhea/user/UserEntity.java
backend/src/main/java/com/folhea/user/UserRepository.java
backend/src/main/java/com/folhea/user/UserResource.java
backend/src/main/java/db/migration/LegacyBookPhotoV010.java
backend/src/main/java/db/migration/V010__private_book_photos.java
backend/src/main/resources/application.properties
backend/src/main/resources/db/migration/V001__initial_schema.sql
backend/src/main/resources/db/migration/V002__ownership_consistency.sql
backend/src/main/resources/db/migration/V003__statistics_query_indexes.sql
backend/src/main/resources/db/migration/V004__local_registration_credentials.sql
backend/src/main/resources/db/migration/V005__unique_registration_email.sql
backend/src/main/resources/db/migration/V006__user_timezone_preference.sql
backend/src/main/resources/db/migration/V007__durable_account_deletion.sql
backend/src/main/resources/db/migration/V008__book_metadata_and_private_covers.sql
backend/src/main/resources/db/migration/V009__remove_delegated_credentials.sql
backend/src/test/java/com/folhea/api/BackendResourceTest.java
backend/src/test/java/com/folhea/api/BookPhotoResourceTest.java
backend/src/test/java/com/folhea/book/BookEntityTest.java
backend/src/test/java/com/folhea/book/BookPhotoMigrationTest.java
backend/src/test/java/com/folhea/book/BookStatsTest.java
backend/src/test/java/com/folhea/book/MigrationIsolationTest.java
backend/src/test/java/com/folhea/book/PhotoFixtures.java
backend/src/test/java/com/folhea/identity/CurrentUserClaimsTest.java
backend/src/test/java/com/folhea/reading/PostgresReadingIntegrityTest.java
backend/src/test/java/com/folhea/reading/ReadingSessionEntityTest.java
backend/src/test/java/com/folhea/reading/ReadingSessionRequestJsonTest.java
backend/src/test/java/com/folhea/reading/SessionProgressSpecTest.java
backend/src/test/java/com/folhea/reading/StreakCalculatorTest.java
backend/src/test/java/com/folhea/security/ServerTokenStateManagerTest.java
backend/src/test/java/com/folhea/security/store/RedisSecurityStoreTest.java
backend/src/test/java/com/folhea/user/DelegatedCredentialsMigrationTest.java
backend/src/test/java/com/folhea/user/KeycloakAdminClientTest.java
backend/src/test/java/com/folhea/user/ProviderTokenContractTest.java
backend/src/test/java/com/folhea/user/UserProblemTypeTest.java
docker-compose.external-pg.runtime.yml
docker-compose.external-pg.yml
docker-compose.override.example.yml
docker-compose.override.yml
docker-compose.prod.yml
docker-compose.yml
docs/api/domain-contract.md
docs/backup-restore.md
docs/bug-report.md
docs/operations.md
frontend/.gitignore
frontend/.postcssrc.json
frontend/README.md
frontend/angular.json
frontend/e2e/bookshelf.spec.ts
frontend/e2e/cover-fixture.ts
frontend/e2e/critical.spec.ts
frontend/e2e/fixtures.ts
frontend/e2e/integrated.spec.ts
frontend/e2e/session-progress.spec.ts
frontend/eslint.config.mjs
frontend/ngsw-config.json
frontend/package.json
frontend/playwright.config.ts
frontend/playwright.integrated.config.ts
frontend/proxy.conf.json
frontend/public/404.html
frontend/public/favicon.svg
frontend/public/folhea-social.svg
frontend/public/icon-192.svg
frontend/public/icon-512.svg
frontend/public/icon.svg
frontend/public/manifest.webmanifest
frontend/public/robots.txt
frontend/public/sitemap.xml
frontend/scripts/generate-seo.mjs
frontend/scripts/seo/index.html.template
frontend/scripts/seo/robots.txt.template
frontend/scripts/seo/sitemap.xml.template
frontend/scripts/test-seo-assets.mjs
frontend/scripts/validate-ssg.mjs
frontend/src/app/app.component.ts
frontend/src/app/app.config.server.ts
frontend/src/app/app.config.ts
frontend/src/app/app.routes.ts
frontend/src/app/core/analytics/analytics.service.spec.ts
frontend/src/app/core/analytics/analytics.service.ts
frontend/src/app/core/api/api-client.service.spec.ts
frontend/src/app/core/api/api-client.service.ts
frontend/src/app/core/api/csrf.interceptor.spec.ts
frontend/src/app/core/api/csrf.interceptor.ts
frontend/src/app/core/api/csrf.service.spec.ts
frontend/src/app/core/api/csrf.service.ts
frontend/src/app/core/api/problem-types.generated.ts
frontend/src/app/core/auth/auth.service.spec.ts
frontend/src/app/core/auth/auth.service.ts
frontend/src/app/core/auth/dev-proxy.spec.ts
frontend/src/app/core/guards/auth.guard.ts
frontend/src/app/core/models/models.ts
frontend/src/app/core/services/card-generator.service.spec.ts
frontend/src/app/core/services/card-generator.service.ts
frontend/src/app/core/services/pwa.service.spec.ts
frontend/src/app/core/services/pwa.service.ts
frontend/src/app/core/services/seo.service.spec.ts
frontend/src/app/core/services/seo.service.ts
frontend/src/app/core/state/dashboard.store.spec.ts
frontend/src/app/core/state/dashboard.store.ts
frontend/src/app/core/state/reading-statistics.spec.ts
frontend/src/app/core/state/reading-statistics.ts
frontend/src/app/features/auth/login.component.ts
frontend/src/app/features/auth/registration.component.spec.ts
frontend/src/app/features/auth/registration.component.ts
frontend/src/app/features/books/book-cover.component.ts
frontend/src/app/features/books/book-detail.component.spec.ts
frontend/src/app/features/books/book-detail.component.ts
frontend/src/app/features/books/book-photo-presentation.spec.ts
frontend/src/app/features/books/book-progress.component.ts
frontend/src/app/features/books/books-progress.spec.ts
frontend/src/app/features/books/books.component.ts
frontend/src/app/features/books/cover-image.spec.ts
frontend/src/app/features/books/cover-image.ts
frontend/src/app/features/books/cover-photo-normalization.spec.ts
frontend/src/app/features/books/cover-picker.component.spec.ts
frontend/src/app/features/books/cover-picker.component.ts
frontend/src/app/features/books/new-book-photo.spec.ts
frontend/src/app/features/books/new-book.component.spec.ts
frontend/src/app/features/books/new-book.component.ts
frontend/src/app/features/cards/cards.component.ts
frontend/src/app/features/form-accessibility.spec.ts
frontend/src/app/features/home/home.component.spec.ts
frontend/src/app/features/home/home.component.ts
frontend/src/app/features/progress/progress.component.ts
frontend/src/app/features/reading/edit-session.component.ts
frontend/src/app/features/reading/feedback.component.spec.ts
frontend/src/app/features/reading/feedback.component.ts
frontend/src/app/features/reading/reading-book-progress.spec.ts
frontend/src/app/features/reading/reading-limits.ts
frontend/src/app/features/reading/reading-session.validator.spec.ts
frontend/src/app/features/reading/reading-session.validator.ts
frontend/src/app/features/reading/reading.component.ts
frontend/src/app/features/reading/session-forms.spec.ts
frontend/src/app/features/settings/settings.component.spec.ts
frontend/src/app/features/settings/settings.component.ts
frontend/src/app/layout/app-shell.component.spec.ts
frontend/src/app/layout/app-shell.component.ts
frontend/src/app/public/landing/landing.component.ts
frontend/src/app/public/legal-contact.ts
frontend/src/app/public/not-found.component.ts
frontend/src/app/public/public-page.component.ts
frontend/src/app/public/public-page.spec.ts
frontend/src/index.html
frontend/src/main.server.ts
frontend/src/main.ts
frontend/src/server.routes.ts
frontend/src/server.ts
frontend/src/styles.css
frontend/src/test-setup.ts
frontend/tsconfig.app.json
frontend/tsconfig.json
frontend/vite.config.ts
infra/Caddyfile
infra/Caddyfile.npm
infra/Dockerfile
infra/caddy-build/go.mod
infra/caddy-build/main.go
infra/keycloak/folhea-realm.dev.template.json
infra/keycloak/folhea-realm.prod.template.json
infra/keycloak/render-realm.sh
infra/keycloak/user-profile.json
infra/postgres/init/10-keycloak-database.sh
infra/systemd/folhea-backup.service
infra/systemd/folhea-backup.timer
scripts/ci/e2e-bookshelf-real.mjs
scripts/ci/e2e-real.mjs
scripts/ci/generate-public-contract.mjs
scripts/ci/health-check.mjs
scripts/ci/scan-secrets.py
scripts/ci/serve-seo.mjs
scripts/ci/tests/test_secret_scan.py
scripts/ci/validate-api-contract.mjs
scripts/ci/validate-domain-surface.mjs
scripts/ci/validate-oidc-surface.mjs
scripts/ci/validate-seo.mjs
scripts/ci/verify-public-image-archive.py
scripts/dev-backend.sh
scripts/local-stack.sh
scripts/ops/backup-all.sh
scripts/ops/backup-postgres.sh
scripts/ops/configure-keycloak.sh
scripts/ops/deploy-config.example.json
scripts/ops/deploy-folhea.py
scripts/ops/deploy-folhea.sh
scripts/ops/folhea-postgres.py
scripts/ops/keycloak-auth.py
scripts/ops/lib.sh
scripts/ops/product-metrics.sh
scripts/ops/product-metrics.sql
scripts/ops/restore-postgres.sh
scripts/ops/tests/test-backup-restore.sh
scripts/ops/tests/test_external_pg_transport.py
scripts/ops/validate-npm-compose.py
scripts/ops/validate-production-compose.sh
scripts/ops/verify-recovery-keycloak.sql
scripts/ops/verify-recovery.sh
scripts/ops/verify-recovery.sql
scripts/tests/test-render-realm.sh
scripts/versao.sh
shared/public-contract.json
```

</details>


## Histórico preservado

<details>
<summary>Relatório de setembro de 2026 e revisões pontuais anteriores — não integra o sumário atual</summary>

# Bug Report — Folhea

Nota DOMINIO-01 (15/10/2026): os exemplos de IDs abaixo foram alinhados ao catálogo público atual; datas, achados e decisões históricas foram preservados.

> Data: 06/09/2026 | Stack: Java 25, Quarkus 3.33.3, Hibernate ORM/Panache, Flyway, OIDC BFF, PostgreSQL 18, Angular 22, TypeScript
> Modo: **full**
> **Status:** corrigido em 06/09/2026 — os 20 itens abaixo foram implementados conforme o plano de correções.
> Arquivos analisados: 44 Java de produção, 47 TypeScript do frontend, 3 migrations SQL, `application.properties`, `Caddyfile`, `docker-compose.yml` e testes amostrados

Grafo consultado: `list_projects`, `index_repository`, `index_status`, `get_architecture` (rotas, hotspots, entry points), `search_code`, `check_index_coverage`. Limitação: parse parcial em `backend/src/main/resources/db/migration/V001__initial_schema.sql` linhas 19–20 — o arquivo foi lido por completo no source. Cobertura sem gap registrado nos arquivos citados; sinal best-effort, não prova de completude.

---

## Sumário

| Severidade | Quantidade |
|------------|------------|
| CRITICO    | 0          |
| ALTO       | 10         |
| MEDIO      | 7          |
| BAIXO      | 3          |
| **Total**  | **20**     |

**Veredicto:** ATENÇÃO → **RESOLVIDO** (06/09/2026)

Não há bug CRÍTICO de corrupção de dados, injeção SQL ou crash no fluxo autenticado feliz. Os itens ALTO/MÉDIO/BAIXO listados abaixo foram corrigidos; o relatório permanece como registro histórico da análise.

---

## CRITICO

Nenhum. Os fluxos de ownership (`findOwned` com `userId`), queries Panache parametrizadas, CSRF + Origin no BFF e o Caddy reescrevendo `X-Forwarded-For` estão sólidos.

---

## ALTO

### BUG-001: Eventos de analytics nunca passam no filtro CSRF

**Arquivo:** `frontend/src/app/core/analytics/analytics.service.ts`
**Linha(s):** 60-72

**O que acontece:**
`track()` envia `POST /api/v1/analytics/events` com `navigator.sendBeacon` (ou `fetch` keepalive). Nenhum dos dois passa pelo interceptor Angular, então o header `X-CSRF-Token` não é enviado.

**Por que é um problema:**
`SecurityBoundaryFilter` trata POST autenticado como mutação e exige CSRF + Origin. Em qualquer navegador com `sendBeacon` (quase todos), o evento é abortado com 403 antes de `AnalyticsResource`. A telemetria do produto descrita em `docs/quality-and-release.md` não chega ao backend. O fallback `fetch` também não envia o token.

**Código problemático:**
```typescript
if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
  navigator.sendBeacon(this.endpoint, new Blob([payload], { type: 'application/json' }));
  return;
}

if (typeof fetch === 'function') {
  void fetch(this.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
    credentials: 'include',
    keepalive: true
  }).catch(() => undefined);
}
```

**Solução:**
```typescript
track(event: ProductEvent, properties: AnalyticsProperties = {}): void {
  if (typeof window === 'undefined') return;
  const payload = {
    event,
    occurredAt: new Date().toISOString(),
    properties: safeAnalyticsProperties(properties)
  };
  this.http.post(this.endpoint, payload, {
    withCredentials: true,
    headers: { Accept: 'application/json' }
  }).pipe(catchError(() => EMPTY)).subscribe();
}
```

Use o `HttpClient` (o `csrfInterceptor` já anexa o token) ou obtenha o token via `CsrfService.getToken()` e envie `X-CSRF-Token` no `fetch`/`sendBeacon`.

**Explicação da correção:**
Mutações autenticadas só são aceitas com o synchronizer token. Sem o header, o filtro aborta; com o `HttpClient`, o interceptor já existente cobre o contrato.

---

### BUG-002: Livro otimista usa `local-book-*` como UUID na sessão

**Arquivo:** `frontend/src/app/core/state/dashboard.store.ts`
**Linha(s):** 117-130
**Também:** `frontend/src/app/features/books/new-book.component.ts` linha 12

**O que acontece:**
`addBook()` insere um livro com `id: local-book-${Date.now()}` e devolve esse objeto. `NewBookComponent.submit()` navega imediatamente para `/app/ler`. A lista de livros inclui o ID fake. Se o usuário registrar leitura antes do `POST /books` retornar (rede lenta) ou se o POST falhar e o livro otimista for removido depois da seleção, o `bookId` enviado não é UUID.

**Por que é um problema:**
Jackson falha ao desserializar `"bookId": "local-book-1757…"` e a API responde 400 (`JSON inválido`). O onboarding mais comum (cadastrar livro → registrar leitura) quebra exatamente quando a rede não é instantânea.

**Código problemático:**
```typescript
const optimistic: Book = { id: `local-book-${Date.now()}`, title, author: author || undefined, status: 'READING', createdAt: now, updatedAt: now };
this.booksState.update((books) => [optimistic, ...books]);
```

```typescript
if (this.form.valid) { this.store.addBook(title, this.form.controls.author.value.trim()); void this.router.navigate(['/app/ler']); }
```

**Solução:**
```typescript
addBook(title: string, author = ''): Observable<Book> {
  return this.api.createBook({ title, author: author || undefined }).pipe(
    tap((book) => {
      this.booksState.update((books) => [book, ...books]);
      this.syncCurrentBook();
      this.analytics.track('book_created');
    })
  );
}
```

No componente, só navegar no `next` do Observable. Enquanto o ID real não existir, não oferecer o livro no `<select>` de leitura.

**Explicação da correção:**
A sessão exige UUID de um livro persistido e pertencente ao usuário. Otimismo na lista é aceitável; usar o ID temporário como chave de API não é.

---

### BUG-003: Tela de sucesso aparece antes da sessão existir

**Arquivo:** `frontend/src/app/features/reading/reading.component.ts`
**Linha(s):** 15
**Também:** `frontend/src/app/features/reading/feedback.component.ts` linhas 5-9; `dashboard.store.ts` linhas 173-186

**O que acontece:**
`submit()` chama `addSession()` (HTTP assíncrono) e navega na hora para `/app/ler/feedback`, que renderiza “Leitura registrada.” com páginas/minutos de `history.state`. Se a API rejeitar (livro otimista, CSRF, 401, validação), o store desfaz a sessão, mas o usuário já viu sucesso.

**Por que é um problema:**
O usuário acredita que o streak/páginas foram gravados. No F5 da home os números não batem. Combina com BUG-002: o caminho cadastro → leitura mostra sucesso e depois um alerta genérico no shell.

O mesmo padrão existe em `EditSessionComponent.save()` / `remove()` (navega para progresso sem esperar a API).

**Código problemático:**
```typescript
submit(): void {
  this.form.markAllAsTouched();
  if (this.form.valid) {
    this.store.addSession({ bookId: this.form.controls.bookId.value, readingDate: this.form.controls.readingDate.value, pages: this.pages.value, minutes: this.minutes.value });
    void this.router.navigate(['/app/ler/feedback'], { state: { pages: this.pages.value, minutes: this.minutes.value } });
  }
}
```

**Solução:**
```typescript
submit(): void {
  this.form.markAllAsTouched();
  if (this.form.invalid) return;
  this.store.addSession({
    bookId: this.form.controls.bookId.value,
    readingDate: this.form.controls.readingDate.value,
    pages: this.pages.value,
    minutes: this.minutes.value
  }).subscribe({
    next: (session) => void this.router.navigate(['/app/ler/feedback'], {
      state: { pages: session.pages, minutes: session.minutes }
    }),
    error: () => { /* o store já define a mensagem; permanecer no formulário */ }
  });
}
```

Faça `addSession` devolver o `Observable` da API (otimismo local pode continuar, mas a navegação de sucesso só no `next`).

**Explicação da correção:**
Feedback de sucesso precisa ser consequência de persistência, não do clique.

---

### BUG-004: Falha ao obter CSRF trava mutações até recarregar a página

**Arquivo:** `frontend/src/app/core/api/csrf.service.ts`
**Linha(s):** 16-28

**O que acontece:**
`getToken()` guarda o Observable em `request$` com `shareReplay({ bufferSize: 1, refCount: false })`. O `tap` que zera `request$` só roda no sucesso. Se `GET /api/v1/csrf` falhar (rede, 429, 500, 401), o erro fica cacheado e `request$` nunca é limpo.

**Por que é um problema:**
Depois de um blip de rede, todo `POST`/`PATCH`/`DELETE` reutiliza o mesmo Observable falho. `clear()` só é chamado no logout ou após 403 no interceptor. O usuário autenticado fica incapaz de registrar leitura até um F5.

**Código problemático:**
```typescript
const request$ = this.http.get<CsrfResponse>('/api/v1/csrf', { withCredentials: true }).pipe(
  map(({ token }) => token),
  tap((token) => { this.token = token; this.request$ = null; }),
  shareReplay({ bufferSize: 1, refCount: false })
);
this.request$ = request$;
```

**Solução:**
```typescript
getToken(): Observable<string> {
  if (this.token) return of(this.token);
  if (!this.request$) {
    this.request$ = this.http.get<CsrfResponse>('/api/v1/csrf', { withCredentials: true }).pipe(
      map(({ token }) => token),
      tap((token) => { this.token = token; }),
      catchError((error) => {
        this.request$ = null;
        this.token = null;
        return throwError(() => error);
      }),
      finalize(() => { this.request$ = null; }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }
  return this.request$;
}
```

**Explicação da correção:**
Erro não pode ser reexecutado como valor memoizado. `finalize` libera o in-flight; a próxima mutação tenta de novo.

---

### BUG-005: “Hoje” e streak no cliente usam o fuso do dispositivo, o backend usa o do usuário

**Arquivo:** `frontend/src/app/core/state/dashboard.store.ts`
**Linha(s):** 217-234
**Também:** `frontend/src/app/features/reading/reading.component.ts` linha 8 (hint: “A data usa o fuso horário do seu dispositivo.”); `backend/src/main/java/com/folhea/shared/TimeProvider.java` linhas 18-20; `StatisticsService.java` linhas 53-55

**O que acontece:**
`DashboardStore.today()` faz `Intl.DateTimeFormat('en-CA').format(new Date())` (fuso do browser). Streak, semana da home e `finishedOn` padrão saem daí. O backend calcula `today(user.timezone)` a partir do claim OIDC/`zoneinfo` (ou UTC). `calculateVisibleStats()` ainda sobrescreve as stats da API com o cálculo local.

**Por que é um problema:**
Quem lê depois da meia-noite no Brasil com `timezone=UTC` na conta (claim ausente) grava “ontem” no servidor e “hoje” no cliente, ou o inverso. O North Star do produto é “dias seguidos”; a métrica diverge entre home, progresso e API. Settings mostra o timezone da conta, mas nenhum fluxo de leitura o usa.

**Código problemático:**
```typescript
today(): string { return new Intl.DateTimeFormat('en-CA').format(new Date()); }
```

**Solução:**
```typescript
today(): string {
  const timezone = this.userTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}
```

Preencher `userTimezone` a partir de `GET /api/v1/me` (`AuthService.user()?.timezone`). No backend, não persistir `UTC` silencioso quando o claim falta se o produto assume o fuso do dispositivo — ou documentar e enviar o timezone do cliente no primeiro `/me`.

**Explicação da correção:**
Um único fuso precisa definir “hoje” em cliente e servidor, senão o streak mente na virada do dia.

---

### BUG-006: Exceções inesperadas viram 500 sem log

**Arquivo:** `backend/src/main/java/com/folhea/shared/UnhandledExceptionMapper.java`
**Linha(s):** 14-22

**O que acontece:**
O mapper de `Throwable` devolve problem+json genérico e não registra a exceção. No código de produção, o único `Logger` é o de analytics.

**Por que é um problema:**
Violação de unique em `identity_subject` (BUG-008), falha de Hibernate ou NPE em um resource aparecem como “Não foi possível concluir a operação.” sem stack no JSON logging. O incidente fica invisível em `docker compose logs backend`.

**Código problemático:**
```java
public Response toResponse(Throwable exception) {
    return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
            .type(MediaType.valueOf("application/problem+json"))
            .entity(new ProblemResponse(URI.create(ProblemTypes.INTERNAL_ERROR),
                    "Erro interno", 500, "Não foi possível concluir a operação."))
            .build();
}
```

**Solução:**
```java
private static final Logger LOG = Logger.getLogger(UnhandledExceptionMapper.class);

@Override
public Response toResponse(Throwable exception) {
    LOG.error("Unhandled exception", exception);
    return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
            .type(MediaType.valueOf("application/problem+json"))
            .entity(new ProblemResponse(URI.create(ProblemTypes.INTERNAL_ERROR),
                    "Erro interno", 500, "Não foi possível concluir a operação."))
            .build();
}
```

**Explicação da correção:**
A mensagem pública continua genérica; o diagnóstico vai para o log estruturado, que já mascara cookies/tokens.

---

### BUG-007: Repositório CSRF em memória cresce sem teto

**Arquivo:** `backend/src/main/java/com/folhea/security/CsrfTokenService.java`
**Linha(s):** 24, 41-48
**Também:** `backend/src/main/java/com/folhea/security/CsrfResource.java` linhas 24-34

**O que acontece:**
Tokens ficam em `ConcurrentHashMap` sem limite e sem varredura de expirados. `CsrfResource` emite um ticket novo sempre que o cookie `__Host-folhea_session` está ausente ou inválido, mesmo com o usuário já autenticado no OIDC.

**Por que é um problema:**
O rate limiter tem `MAX_WINDOWS = 100_000`; o CSRF não. Um cliente autenticado que chama `GET /api/v1/csrf` sem enviar o cookie CSRF (script, app, retry) cria uma entrada nova a cada request. Entradas expiradas só saem em `isValid` daquela chave. Isso é vazamento de memória e vetor de DoS autenticado.

**Código problemático:**
```java
private final Map<String, TokenEntry> tokens = new ConcurrentHashMap<>();

public String getOrIssue(String sessionTicket) {
    requireTicket(sessionTicket);
    Instant now = clock.instant();
    TokenEntry entry = tokens.compute(sessionTicket, (ignored, existing) -> {
        if (existing != null && now.isBefore(existing.expiresAt())) return existing;
        return new TokenEntry(newToken(), now.plus(ttl));
    });
    return entry.value();
}
```

**Solução:**
Espelhar o `RateLimiter`: teto de entradas, `removeIf` de expirados a cada N operações, e recusar `getOrIssue` quando o mapa estiver cheio. Em `CsrfResource`, não gerar ticket novo em loop — recusar sem cookie válido ou reutilizar o ticket OIDC de forma estável.

**Explicação da correção:**
O mapa é estado de processo. Sem eviction e sem teto, o heap acompanha o número de tickets já emitidos, não o de sessões vivas.

---

### BUG-008: Provisionamento de usuário não é atômico

**Arquivo:** `backend/src/main/java/com/folhea/identity/CurrentUser.java`
**Linha(s):** 18-35

**O que acontece:**
`get()` faz `findByIdentitySubject` e, se null, `persist`. Não há `ON CONFLICT` / tratamento da unique `identity_subject`. Qualquer GET autenticado (`/me`, `/books`, `/sessions`, `/dashboard`, `/stats`) pode criar o usuário porque `get()` é `@Transactional` e tem efeito colateral de escrita.

**Por que é um problema:**
Dois requests em paralelo no primeiro login (duas abas no callback, ou `/me` + `/dashboard` se o initializer não serializar) tentam inserir o mesmo `identity_subject`. O segundo estoura constraint SQL, cai no mapper genérico (BUG-006, sem log) e devolve 500. O SPA dispara quatro cargas em paralelo no `DashboardStore.load()`.

**Código problemático:**
```java
UserEntity user = users.findByIdentitySubject(subject);
if (user == null) {
    user = new UserEntity();
    user.identitySubject = subject;
    user.email = email;
    user.timezone = validTimezone(identityTimezone());
    users.persist(user);
}
```

**Solução:**
```java
UserEntity user = users.findByIdentitySubject(subject);
if (user == null) {
    try {
        user = new UserEntity();
        user.identitySubject = subject;
        user.email = email;
        user.timezone = validTimezone(identityTimezone());
        users.persistAndFlush(user);
    } catch (PersistenceException ex) {
        users.getEntityManager().clear();
        user = users.findByIdentitySubject(subject);
        if (user == null) throw ex;
    }
}
```

Alternativa mais limpa: `INSERT … ON CONFLICT (identity_subject) DO NOTHING` + `find` de novo.

**Explicação da correção:**
A unique no banco já é a fonte de verdade; o código precisa tratar a corrida em vez de transformar o segundo request em 500.

---

### BUG-009: 401 em voo não encerra a sessão na UI

**Arquivo:** `frontend/src/app/core/api/csrf.interceptor.ts`
**Linha(s):** 8-26
**Também:** `frontend/src/app/core/auth/auth.service.ts` linhas 29-40; `frontend/src/app/layout/app-shell.component.ts` linha 16

**O que acontece:**
O interceptor só reage a 403 (CSRF). `restoreSession()` roda uma vez no bootstrap. Se o cookie OIDC expirar, as APIs voltam 401, o store mostra “É necessário autenticar-se.” e o header continua com e-mail e botão Sair.

**Por que é um problema:**
O usuário acha que está autenticado e tenta registrar leitura em loop. Não há redirect para `/entrar`. Mutações otimistas são revertidas com a mesma mensagem.

**Código problemático:**
```typescript
catchError((error: unknown) => {
  if (error instanceof HttpErrorResponse && error.status === 403) {
    csrf.clear();
    return csrf.getToken().pipe(
      switchMap((token) => next(withCredentials.clone({ setHeaders: { 'X-CSRF-Token': token } })))
    );
  }
  return throwError(() => error);
})
```

**Solução:**
```typescript
catchError((error: unknown) => {
  if (error instanceof HttpErrorResponse && error.status === 401) {
    inject(AuthService).signOut();
    return throwError(() => error);
  }
  if (error instanceof HttpErrorResponse && error.status === 403) {
    csrf.clear();
    return csrf.getToken().pipe(
      switchMap((token) => next(withCredentials.clone({ setHeaders: { 'X-CSRF-Token': token } })))
    );
  }
  return throwError(() => error);
})
```

Evitar chamar `signOut()` no próprio `GET /me` de restore (loop). Tratar 401 só em requests após `initialized`.

**Explicação da correção:**
401 no BFF significa “não há sessão”. A UI precisa refletir isso, não só o alerta de mutação.

---

### BUG-010: Dashboard e streak carregam todas as sessões do usuário

**Arquivo:** `backend/src/main/java/com/folhea/statistics/StatisticsService.java`
**Linha(s):** 43-55
**Também:** `backend/src/main/java/com/folhea/reading/ReadingSessionResource.java` linhas 43-45; `ReadingSessionRepository.allOwned`

**O que acontece:**
Cada `GET /dashboard` chama `sessions.allOwned(user.id)` só para o streak, além da janela de 7 dias. `GET /sessions` sem `from`/`to` devolve a história inteira. O frontend guarda tudo em memória e recalcula stats no cliente.

**Por que é um problema:**
Com anos de leitura diária isso vira payload e heap lineares. O índice `idx_reading_session_user_date` existe, mas a query não limita. É o clássico “funciona com 50 registros, degrada com 5 000”.

**Código problemático:**
```java
private int streak(UserEntity user) {
    return StreakCalculator.current(sessions.allOwned(user.id).stream().map(s -> s.readingDate).toList(), today(user));
}
```

**Solução:**
Consultar datas distintas em SQL até quebrar a sequência, por exemplo:

```sql
SELECT DISTINCT reading_date
FROM reading_session
WHERE user_id = :userId AND reading_date <= :today
ORDER BY reading_date DESC
LIMIT 400
```

e calcular o streak nesse conjunto. Em `GET /sessions`, exigir período (já existe `from`/`to`) e paginar; o frontend já pede stats por período.

**Explicação da correção:**
Streak só precisa das datas mais recentes até o primeiro buraco, não do histórico completo hidratado em entidades.

---

## MEDIO

### BUG-011: Páginas e minutos não têm teto

**Arquivo:** `backend/src/main/java/com/folhea/reading/ReadingSessionResource.java`
**Linha(s):** 96-109
**Também:** `frontend/src/app/features/reading/reading.component.ts` (input `type="number"` só com `min="0"`)

**O que acontece:**
`validateProgress` rejeita negativo e zero/zero, mas aceita `Integer.MAX_VALUE`. O HTML não tem `max`. A coluna SQL é `INTEGER`.

**Por que é um problema:**
Um `pages=2147483647` distorce stats, cards e streak visual. Não corrompe o banco, mas quebra o sentido das métricas.

**Solução:**
```java
private static final int MAX_PAGES = 10_000;
private static final int MAX_MINUTES = 24 * 60;

private static void validateProgress(Integer pages, Integer minutes) {
    int pageCount = pages == null ? 0 : pages;
    int minuteCount = minutes == null ? 0 : minutes;
    if (pageCount < 0 || minuteCount < 0 || (pageCount == 0 && minuteCount == 0)) {
        invalid("Informe páginas, minutos ou ambos; os valores não podem ser negativos.");
    }
    if (pageCount > MAX_PAGES || minuteCount > MAX_MINUTES) {
        invalid("Páginas ou minutos excedem o limite permitido para uma sessão.");
    }
}
```

No form: `max="10000"` / `max="1440"` e `Validators.max`.

**Explicação da correção:**
Uma sessão de leitura tem limite físico; o contrato precisa refletir isso nos dois lados.

---

### BUG-012: Mappers de 400 devolvem `exception.getMessage()` cru

**Arquivo:** `backend/src/main/java/com/folhea/shared/IllegalArgumentExceptionMapper.java`
**Linha(s):** 12-16
**Também:** `backend/src/main/java/com/folhea/shared/BadRequestExceptionMapper.java` linhas 14-16

**O que acontece:**
`BookEntity.validate()` e `ReadingSessionEntity.validateProgress()` lançam `IllegalArgumentException` em inglês (“Book title cannot be blank”). O mapper envia isso no campo `detail` do problem+json. `BadRequestException` do JAX-RS pode incluir texto interno do runtime.

**Por que é um problema:**
O restante da API é em português e sanitizado (`UnhandledExceptionMapper`, `ProblemWebExceptionMapper`). Aqui vaza mensagem de framework/entidade. Não é stack trace, mas quebra o contrato público e pode expor detalhe de parsing.

**Solução:**
```java
.entity(new ProblemResponse(URI.create(ProblemTypes.INVALID_REQUEST),
        "Requisição inválida", 400, "A requisição não atende ao contrato esperado."))
```

Tratar regras de negócio com `ProblemException` (já usado nos resources) em vez de IAE nas entidades, ou mapear IAE conhecido para o type `invalid-book` / `invalid-reading-session`.

**Explicação da correção:**
O cliente só deve ver as mensagens do contrato; internals ficam no log.

---

### BUG-013: `load()` marca sucesso antes das requests terminarem

**Arquivo:** `frontend/src/app/core/state/dashboard.store.ts`
**Linha(s):** 45-52

**O que acontece:**
`hasLoaded = true` no início. Se dashboard/livros/sessões falharem, `AppShell` não chama `load()` de novo na navegação interna. Há retry pontual em livros/sessões, não no resumo.

**Por que é um problema:**
Primeira carga com 502/timeout deixa a home vazia até F5. `reload()` existe mas quase nenhum template o dispara no erro do dashboard.

**Solução:**
```typescript
load(): void {
  if (this.hasLoaded || this.loadingState()) return;
  this.loadDashboard();
  this.loadBooks();
  this.loadSessions();
  this.loadStats(this.periodState());
}

loadDashboard(): void {
  this.loadingState.set(true);
  this.api.getDashboard().subscribe({
    next: (dashboard) => {
      this.dashboardState.set(dashboard);
      this.loadingState.set(false);
      this.hasLoaded = true;
    },
    error: (error: unknown) => {
      this.loadingState.set(false);
      this.hasLoaded = false;
      this.errorState.set(this.errorMessage(error, 'Não foi possível carregar seu resumo.'));
    }
  });
}
```

**Explicação da correção:**
`hasLoaded` deve significar “já temos um dashboard válido”, não “já disparamos o HTTP”.

---

### BUG-014: Deep link de livro/sessão mostra “não encontrado” enquanto os dados ainda não chegaram

**Arquivo:** `frontend/src/app/features/books/book-detail.component.ts`
**Linha(s):** 27-28, 41
**Também:** `frontend/src/app/features/reading/edit-session.component.ts` linhas 24, 34-35

**O que acontece:**
O template trata `store.getBook(id) === undefined` como “Livro não encontrado”. `getBook` só olha o array em memória. No first paint após F5 em `/app/livros/:id`, `loadBooks()` ainda não retornou.

**Por que é um problema:**
Deep link e PWA aberta numa URL interna piscam o empty state (ou o usuário clica “Voltar” antes do load). Não é 404 real.

**Solução:**
```html
@if (store.booksLoading() && !book()) {
  <div class="loading surface" role="status">Carregando livro…</div>
} @else if (book(); as currentBook) {
  <!-- detalhe -->
} @else {
  <section class="empty surface">Livro não encontrado</section>
}
```

O mesmo para sessão (`sessionsLoading()`).

**Explicação da correção:**
Ausência temporária no store não é ausência no servidor.

---

### BUG-015: `bookId` omitido na criação da sessão vira 404 de livro

**Arquivo:** `backend/src/main/java/com/folhea/reading/ReadingSessionResource.java`
**Linha(s):** 90-93, 105-107

**O que acontece:**
Não há `@Valid` nos records (nenhum resource do projeto usa). `ensureBookOwned(user.id, null)` devolve 404 “Livro não encontrado” em vez de 400 “Informe o livro”.

**Por que é um problema:**
Cliente com body `{ "pages": 10, "minutes": 8, "readingDate": "2026-09-06" }` recebe 404 e pode assumir ID errado. O `@NotNull` do record nunca dispara.

**Solução:**
```java
public Response create(@Valid CreateSessionRequest request) { ... }

private void ensureBookOwned(UUID userId, UUID bookId) {
    if (bookId == null) invalid("Informe o livro da sessão.");
    if (books.findOwned(userId, bookId) == null) {
        throw new ProblemException(404, ProblemTypes.BOOK_NOT_FOUND,
                "Livro não encontrado", "Livro inexistente ou não pertencente ao usuário.");
    }
}
```

**Explicação da correção:**
Campo obrigatório ausente é 400; 404 fica para UUID existente de outro dono ou inexistente.

---

### BUG-016: Flyway `baseline-on-migrate=true` em todos os perfis

**Arquivo:** `backend/src/main/resources/application.properties`
**Linha(s):** 15-16

**O que acontece:**
`quarkus.flyway.baseline-on-migrate=true` não está restrito a `%dev`. Em um banco não vazio sem histórico Flyway, o baseline marca o schema como aplicado e **pula** `V001`.

**Por que é um problema:**
Restore parcial, dump manual ou ambiente criado à mão pode subir o app sem as constraints `book_finished_status_consistent` / `reading_session_book_owner_fk`. Os testes de entidade não salvam esse ambiente.

**Solução:**
```properties
%dev.quarkus.flyway.baseline-on-migrate=true
%test.quarkus.flyway.baseline-on-migrate=true
%prod.quarkus.flyway.baseline-on-migrate=false
```

**Explicação da correção:**
Baseline é conveniência de desenvolvimento; em produção a história de migrations precisa ser explícita.

---

### BUG-017: Compose padrão sobe Keycloak com `start-dev`

**Arquivo:** `docker-compose.yml`
**Linha(s):** 29
**Também:** `docs/operations.md` (já pede `start --optimized` em produção)

**O que acontece:**
O serviço `keycloak` usa `command: ["start-dev", …]`. O README indica `docker compose up` como stack local e o runbook de operação usa o mesmo compose, com um aviso para substituir o comando em produção.

**Por que é um problema:**
Quem seguir só o compose em um host público deixa o IdP em modo desenvolvimento (hostname relaxado, defaults de dev). O risco é operacional, não um bug de código da API.

**Solução:**
Separar `docker-compose.yml` (dev) e `docker-compose.prod.yml` com `start --optimized`, ou tornar o command `${KEYCLOAK_START_COMMAND:-start-dev}` sem default inseguro no overlay de produção.

**Explicação da correção:**
O default executável precisa ser o modo que o ambiente pretende; o aviso em markdown não impede `compose up` em um VPS.

---

## BAIXO

### BUG-018: `drawCover` divide por `naturalWidth`/`naturalHeight` sem guarda

**Arquivo:** `frontend/src/app/core/services/card-generator.service.ts`
**Linha(s):** 89-95

**O que acontece:**
Imagem decodificada com dimensão 0 (arquivo quebrado que ainda dispara `onload`) gera `scale = Infinity` e `drawImage` com origem inválida.

**Solução:**
```typescript
if (image.naturalWidth < 1 || image.naturalHeight < 1) {
  throw new Error('Não foi possível ler esta foto.');
}
```

---

### BUG-019: Listener `appinstalled` não é removido

**Arquivo:** `frontend/src/app/layout/app-shell.component.ts`
**Linha(s):** 41-44

**O que acontece:**
`addEventListener('appinstalled', this.onInstalled)` no constructor, sem `ngOnDestroy`. Em logout há navegação full-page, então o impacto prático é baixo.

**Solução:** implementar `OnDestroy` e `removeEventListener('appinstalled', this.onInstalled)`.

---

### BUG-020: Token state OIDC em memória sem eviction periódica

**Arquivo:** `backend/src/main/java/com/folhea/security/ServerTokenStateManager.java`
**Linha(s):** 26-40, 51-55

**O que acontece:**
Access/refresh tokens ficam no `ConcurrentHashMap` até `getTokens` ver expiração ou `deleteTokens` no logout. Login é limitado por IP (`login-per-ip`), então o risco é menor que o do CSRF (BUG-007), mas sessões abandonadas retêm tokens até o processo reiniciar.

**Solução:** a mesma varredura periódica do rate limiter, com teto e `removeIf` por `expiresAt`.

---

## Observações Gerais

Pontos positivos (não são bugs):

- Ownership consistente: `findOwned` sempre filtra `userId`; V002 amarra `(book_id, user_id)` na sessão.
- Sem concatenação SQL; Panache com placeholders.
- CSRF synchronizer + Origin/Referer + cookie `__Host-` HttpOnly; Caddy apaga e reinsere `X-Forwarded-For` com `{remote_host}` — o filtro de rate limit que lê o header é seguro **neste** edge.
- Problem+json na maior parte dos mappers, sem vazar stack no 500.
- `RateLimiter` com `ConcurrentHashMap`, lock, teto e janela; testes com `Clock` mutável.
- Jackson `fail-on-unknown-properties`, limite de body 64 KiB no Quarkus e no Caddy.
- Frontend: `withCredentials`, `encodeURIComponent` nos IDs, cards revogam object URLs no destroy.

Falsos positivos descartados:

- `.subscribe()` no `DashboardStore`: `providedIn: 'root'` e `HttpClient` completa; não é leak de componente.
- `orElse(null)` em `CurrentUser` no e-mail: coluna nullable, e o update ignora claim ausente.
- `X-Forwarded-For` no `AbuseProtectionFilter`: mitigado pelo Caddyfile (strip + `{remote_host}`).
- Catch de `RuntimeException` em timezone: fallback UTC intencional.

Prioridade sugerida: BUG-001, BUG-002, BUG-003, BUG-004, BUG-005, BUG-006, BUG-008.

---

## Revisão pontual — RedisSecurityStoreTest (06/09/2026)

Modo **quick** nos arquivos desta correção: `application.properties`,
`RedisSecurityStoreTest.java`. Nenhum CRÍTICO/ALTO novo. O acoplamento a
`redis://127.0.0.1:6379` era falso verde local (redis-server de sistema);
Dev Services agora provisiona `redis:7-alpine` e o teste recusa a porta 6379.

---

## Revisão pontual — 404 em `/auth/login` no `ng serve` (06/09/2026)

Modo **quick** nos arquivos desta correção: `frontend/proxy.conf.json`,
`frontend/angular.json`, `frontend/src/app/core/auth/dev-proxy.spec.ts`,
`infra/keycloak/folhea-realm.dev.template.json`, `scripts/ci/validate-oidc-surface.mjs`.

Nenhum CRÍTICO/ALTO novo. Causa raiz confirmada em runtime: o Angular
tratava `GET /auth/login` (e até `/api/v1/me`) como rota SPA e renderizava
`NotFoundComponent`. O proxy local replica o Caddy (`/auth` e `/api` →
Quarkus em `:8080`). O alvo é só `http://localhost:8080` (não é open
proxy). `/auth/login` continua sendo o BFF, não uma rota Angular.

`ClockProducer` injeta `Optional<String>` em `folhea.clock.fixed-instant`.
`defaultValue=""` no SmallRye é tratado como propriedade ausente
(SRCFG00014) e o `quarkus:dev` não sobe — a tela em `/auth/login` passava
a ser o erro “Error restarting Quarkus”.

---

## Revisão pontual — Entrar não abre o IdP no `ng serve` (06/09/2026)

Modo **quick** nos arquivos desta correção: `application.properties`,
`SessionCookiePolicy.java`, `SessionCookieSettings.java`,
`BffSessionCookieFilter.java`, `CsrfResource.java`,
`SecurityBoundaryFilter.java`, `UserResource.java`,
`infra/keycloak/render-realm.sh`, `docker-compose.override.example.yml`,
`frontend/proxy.conf.json`.

Nenhum CRÍTICO/ALTO novo em produção. `%prod` continua com OIDC, cookie
`__Host-` e hostname público via Caddy. Causa raiz local: `%dev` tinha
`quarkus.oidc.enabled=false`, então `GET /auth/login` respondia 303 para
`/app/inicio` sem sessão e o `authGuard` devolvia `/entrar`. O Keycloak
também crashava (`/opt/keycloak/data/import` inexistente) e não publicava
`8180` no host. O `%dev` agora inicia o code flow em
`http://localhost:8180`, o override publica essa porta, o proxy envia
`X-Forwarded-Host: localhost:4200` e o cookie CSRF local é `folhea_session`
(HTTP não aceita `__Host-`). `NotAuthorizedExceptionMapper` não pode
engolir `UnauthorizedException` em `/auth/*` como problem+json — isso
transformava o challenge OIDC (302) em 401 e o botão Entrar parecia morto.
No `%dev` o mapper reencaminha o `ChallengeData` do `HttpAuthenticator`. A
substituição do secret no realm usa `sed` (a imagem Keycloak não tem gettext);
`&` e `\\` no valor são escapados no script gerado (`scripts/tests/test-render-realm.sh`).

---

## Revisão pontual — SCRAM sem senha no `quarkus:dev` (07/09/2026)

Modo **quick** nos arquivos desta correção: `scripts/dev-backend.sh`,
`scripts/tests/test-dev-backend.sh`, `backend/.gitignore`,
`docker-compose.yml`.

Nenhum CRÍTICO/ALTO novo. Causa raiz confirmada em runtime: `./mvnw quarkus:dev`
foi iniciado em `backend/`, onde não havia `.env`. O Quarkus lê `.env` só do
diretório de trabalho; `quarkus.datasource.password=${DB_PASSWORD:}` resolveu
para vazio e o Postgres em `localhost:5433` recusou SCRAM. O Flyway falhou no
start e o proxy do `ng serve` mostrou o stack trace em `/auth/login`.

O `dev-backend.sh` agora cria `backend/.env` → `../.env` quando o caminho
está ausente, mantém o symlink correto, substitui um symlink apontando para
outro alvo e avisa sem sobrescrever se o alvo já é um arquivo regular. O link é gitignored. O healthcheck do Keycloak deixou de
usar `wget` (ausente na imagem `quay.io/keycloak/keycloak:26.7.3`) e passou a
sondar `127.0.0.1:9000/health/ready` via `/dev/tcp` em bash; `$line` no
Compose é escapado como `$$line`. Quatorze containers `postgres:18` órfãos de
Testcontainers (label `org.testcontainers=true`) foram removidos da
workstation; não entram no repositório.


</details>
