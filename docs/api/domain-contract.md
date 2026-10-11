# API de leitura e conta

Contrato formal: `GET /api/openapi` (YAML/JSON por negociação). A aplicação web
usa sessão BFF HttpOnly; obter `GET /api/v1/csrf` e enviar `X-CSRF-Token` e
`Origin`/`Referer` da origem permitida nas mutações. Erros usam
`application/problem+json`; recursos alheios retornam 404.

## Conta e datas

Cadastro público canônico: `POST /api/v1/registration` com `{email,password}`,
provisionado exclusivamente no Keycloak. `/api/v1/auth/register` e
`/api/v1/register` permanecem aliases de compatibilidade, com a mesma validação
e bucket de rate limit por IP. Cadastro público não exige sessão/token CSRF;
se Origin estiver presente, deve ser uma origem permitida. As credenciais não são persistidas pelo Folhea nem retornam no
JSON. Após 201, o navegador deve iniciar `/auth/login` para estabelecer a sessão.
O backend emite `account_created` depois do commit do vínculo local com o
subject provisionado. Incrementa `folhea_product_events_total{event="account_created"}`
e registra somente o nome do evento e a categoria `registration`; e-mail,
identificadores e senha não entram no evento. Cadastros rejeitados (400/409)
ou indisponíveis (503), inclusive rollback local após provisionamento, não
incrementam o contador. O frontend não precisa emitir esse evento anônimo.

`GET /api/v1/me` retorna `{id, email, timezone}`. `PATCH /api/v1/me` aceita
`{"timezone":"America/Sao_Paulo"}` e retorna o mesmo formato. O fuso deve ser
um identificador IANA válido. A escolha explícita persiste e não é substituída
pelos claims OIDC. Antes dessa escolha, o backend usa `zoneinfo`/`timezone` do
token (UTC se ausentes). O frontend pode oferecer a configuração e sugerir o
fuso do dispositivo no primeiro uso.

`readingDate` e `finishedOn` são dias ISO `YYYY-MM-DD`. Sessões e finalizações
não podem apontar para uma data posterior a hoje no fuso da conta. Alterar o
fuso muda o significado de hoje, sem deslocar datas já registradas.
`createdAt`/`updatedAt` são instantes UTC. Exportação em `/me/export` contém
todos os registros próprios, independentemente dos limites de listagem.
As respostas de edição/finalização incluem `updatedAt` após flush da entidade;
repetições sem alteração não geram um novo evento de atualização.

`DELETE /me` exige `{"confirm":true}`. Antes de apagar dados, remove a identidade
do subject no Keycloak e suas sessões (se indisponível, retorna 503 sem apagar). Remove livros
e sessões por cascade, revoga o estado opaco `q_session_folhea` e o CSRF,
e expira ambos os cookies. Requer novo cadastro para voltar a usar a aplicação.
Nenhuma senha é gravada
pelo fluxo de cadastro Folhea.
O subject excluído também recebe revogação de sessão por 8 horas (hash SHA-256,
TTL no store de segurança), impedindo um JWT ainda válido de reprovisionar a
conta silenciosamente. Após remoção no Keycloak, um novo cadastro tem outro
subject. As validações de domínio que usam identidade retornam 401 para a
sessão revogada.

## Livros e sessões

Livros têm título obrigatório (até 500 caracteres), autor opcional e estado
`READING`/`FINISHED`. `POST /books/{id}/finish` aceita `{finishedOn}` ou corpo
vazio para hoje. Repetir sem data preserva a data existente; repetir a mesma
data não duplica a finalização. Uma nova data explícita altera a finalização.
`DELETE /books/{id}/finish` reabre e remove `finishedOn`. Excluir um livro
exclui suas sessões por cascade e recalcula as métricas.

Sessões aceitam páginas, minutos ou ambos: JSON inteiro, valores não negativos,
ao menos um positivo. Campos omitidos na criação equivalem a zero; PATCH
preserva campos omitidos. Máximos por sessão: 10.000 páginas e 1.440 minutos.
Frações e strings numéricas retornam 400. Regras de progresso também são
verificadas pela entidade e por constraints PostgreSQL.
Falhas de desserialização seguem `application/problem+json` em todos os perfis,
sem reproduzir valores enviados ou detalhes internos do Jackson.

`GET /api/v1/sessions/{id}` retorna a sessão própria no mesmo formato das
listagens (`id`, `bookId`, `readingDate`, `pages`, `minutes`, `createdAt`,
`updatedAt`). Retorna 404 se não existir ou pertencer a outro usuário.

Listagens de livros/sessões são arrays com `limit` (máximo/default 100) e
`offset`. Sessões permitem `from`/`to` inclusivos até 366 dias; sem filtro,
listam os últimos 366 dias. A UI deve paginar para não ocultar registros.

## Métricas

`GET /api/v1/stats?period=today|7|30|all`: hoje, hoje menos 6 dias, hoje menos
29 dias e desde a primeira sessão até hoje, respectivamente. Sem `period`,
o padrão é 7 dias. Também aceita `from`/`to` inclusivos (até 366 dias), sem
combinar com `period`. Páginas/minutos são somas PostgreSQL; livros finalizados
contam por `finishedOn` dentro do período. Nenhum registro futuro legado é
incluído nos períodos predefinidos. `/dashboard` usa 7 dias móveis.

O streak usa dias distintos de todo o histórico, sem limite de 400 dias ou
dependência do filtro. Começa em hoje se houver leitura; caso contrário em
ontem; uma lacuna interrompe a contagem. CRUD, reabertura e exclusão repercutem
na próxima consulta, sem cache de domínio.

## Stack e operação

Backend: Java 25, Quarkus 3.40.1 LTS e Maven 3.10.0, sem alteração isolada da
versão do produto. O wrapper usa a versão estável conferida no
[Maven Central](https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/maven-metadata.xml).
O TLS público termina no Caddy. Quarkus aceita HTTP somente na rede privada
do Compose (`insecure-requests=enabled`); ele não redireciona para um listener
SSL inexistente. Cookies externos continuam Secure/HttpOnly, redirects OIDC
usam HTTPS e forwarded headers só são aceitos dos proxies configurados em
`TRUSTED_PROXIES`. O BFF não deve publicar sua porta diretamente.
A versão estável foi conferida no [Maven Central](https://repo.maven.apache.org/maven2/io/quarkus/platform/quarkus-bom/maven-metadata.xml)
e no [histórico oficial Quarkus](https://quarkus.io/releases/).

As extensões Micrometer/Prometheus e OpenTelemetry fazem parte do build.
`/q/metrics` fornece contagem/latência/status HTTP, CPU/memória/JVM e pool JDBC;
falhas de persistência incrementam `folhea_database_errors_total`. O pool usa
`quarkus.datasource.metrics.enabled=true` e
`quarkus.datasource.jdbc.metrics.enabled=true`, conforme a
[configuração atual de datasource](https://quarkus.io/guides/datasource/).
O proxy deve
manter `/q/*` privado. Traces OTLP são opcionais: `OTEL_SDK_DISABLED=false` e
`OTEL_EXPORTER_OTLP_ENDPOINT` apontam para o collector interno. O padrão
desabilita o SDK, sem retirar a instrumentação do build. Não instrumentar SQL
com parâmetros nem tráfego administrativo com segredos. Logs JSON permanecem
ativos. [Referência Micrometer](https://quarkus.io/guides/telemetry-micrometer/)
e [OpenTelemetry](https://quarkus.io/guides/opentelemetry-tracing/).

`POST /analytics/events` aceita os eventos do PRD e propriedades contadoras
inteiras não negativas (até 1.000.000). `source`, `screen` e `method` só aceitam
categorias conhecidas; texto livre, título, autor, foto e dados pessoais são
rejeitados. A métrica `folhea_product_events_total{event}` conta eventos aceitos;
o log estruturado conserva apenas o evento e propriedades validadas.

Logout normal continua em `/auth/logout`, processado pelo mecanismo OIDC do
Quarkus. Ele revoga o estado de tokens e limpa cookies; um observador do evento
OIDC remove o vínculo CSRF também quando o fluxo não passa pelos filtros REST.
As operações de store Redis durante autenticação usam `OidcRequestContext`
para executar fora da thread de eventos.
O filtro de cookies do callback usa `CurrentIdentityAssociation.getDeferredIdentity()`
e retorna `Uni<Void>`; a rotação/revogação CSRF com Redis executa em worker.
Ele mantém cookies Secure/HttpOnly/SameSite=Lax e aguarda a identidade autenticada,
sem acessar a identidade lazy de forma bloqueante na thread de I/O.
Veja a [referência oficial de autenticação lazy](https://quarkus.io/guides/security-proactive-authentication/).
