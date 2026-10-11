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
do subject no Keycloak e suas sessões (se indisponível, retorna 503 sem apagar naquele momento). Remove livros
e sessões por cascade, revoga o estado opaco `q_session_Default_folhea` e o CSRF,
e expira ambos os cookies. Requer novo cadastro para voltar a usar a aplicação.
Nenhuma senha é gravada
pelo fluxo de cadastro Folhea.
O subject excluído também recebe revogação de sessão por 8 horas (hash SHA-256,
TTL no store de segurança), impedindo um JWT ainda válido de reprovisionar a
conta silenciosamente. Após remoção no Keycloak, um novo cadastro tem outro
subject. As validações de domínio que usam identidade retornam 401 para a
sessão revogada.

A confirmação é registrada primeiro na fila privada PostgreSQL `account_deletion`
(V007), em uma transação já confirmada antes de chamar o IdP. A remoção local e
o marcador persistente do subject são confirmados juntos em outra transação.
Se o IdP já apagou a identidade, mas flush/commit local falha, a intenção permanece
pendente; DELETE 404 no IdP é sucesso na retomada. O worker interno reprocessa
até 25 intenções por execução, a cada 60 segundos, também depois de um restart,
sem exigir sessão ou novo login. Não há limite que descarte uma intenção após
falhas; indisponibilidade do banco/IdP mantém a solicitação para nova tentativa.
Um 503 preserva dados/sessão imediatamente e permite repetir a confirmação na
UI, mas a solicitação já confirmada pode concluir em background quando o serviço
se recuperar. Intenções repetidas do mesmo subject não duplicam a operação.

A limpeza de referências OIDC/CSRF no Redis só ocorre depois do commit local.
Falhas nessa limpeza não desfazem a exclusão nem mudam seu 204: os cookies são
expirados e o worker retenta a limpeza. O marcador PostgreSQL impede reprovisionar
o subject mesmo se a revogação Redis estiver ausente. Depois da limpeza, a fila
remove subject, ID local e referências de cookies; conserva apenas ID interno,
hash SHA-256, estado e horários por oito horas, antes de remover o marcador.
Essa fila não aparece em exportações/respostas e seus campos privados não entram
em logs. A transação e o agendamento usam as extensões do mesmo BOM Quarkus,
conforme [fronteiras de transação](https://quarkus.io/version/3.40/guides/transaction/)
e [scheduler](https://quarkus.io/guides/scheduler-reference/).

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
`offset` (padrão 0). `limit` ausente ou não positivo usa 100; acima de 100 é
limitado a 100. `offset` negativo usa 0. Sessões permitem `from`/`to` inclusivos
até 366 dias, ambos obrigatórios quando há filtro. Sem `from`/`to`, a consulta
percorre todo o histórico próprio paginado, inclusive registros mais antigos
que 366 dias. Ordenação: `readingDate`, `createdAt` e `id`, todos decrescentes,
com desempate estável para paginação. A UI deve paginar para não ocultar
registros e usar `GET /sessions/{id}` para abrir edição após reload ou por
link de um registro fora da página atual. Estatísticas e streak continuam
calculados pelo backend sobre os respectivos períodos/histórico global,
independentemente das páginas carregadas no cliente.

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

Backend: Java 27 (Temurin 27+35), Quarkus 3.40.1 LTS e Maven 3.10.0, sem alteração isolada da
versão do produto. A instrução mais recente de usar a última versão estável
prevalece sobre a recomendação Java 25 LTS do PRD, cujo texto fonte é preservado.
O JDK é a [release GA oficial Temurin 27+35](https://github.com/adoptium/temurin27-binaries/releases/tag/jdk-27+35),
com SHA-256 do arquivo Linux x64 HotSpot conferido antes da instalação:
`1cf69a4848ffb728b3b260dfd45206a51566ab571a02a30092271d4c580bccbc`.
O wrapper usa a versão estável conferida no
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
Quarkus. A policy `authenticated` com mecanismo `code` ativa o fluxo nesse
caminho mesmo com `proactive=false`. Ele revoga o estado de tokens e limpa
o cookie OIDC antes de redirecionar ao end-session público do IdP; um observador do evento
OIDC remove o vínculo CSRF também quando o fluxo não passa pelos filtros REST.
O IdP retorna a `/auth/logged-out`, rota pública no backend que exige um único
`state` idêntico ao cookie HttpOnly `q_post_logout` do tenant/suffix configurado
(`q_post_logout_Default_folhea` neste runtime). A comparação usa tempo constante.
State ausente, divergente, duplicado ou sem cookie retorna 403 em
`application/problem+json`, sem redirect. O cookie de state expira após a
tentativa. Retorno válido revoga o vínculo CSRF residual, expira seu cookie e
responde 303 para `/`, com `Cache-Control: no-store` e sem query de state.
O URI de retorno deve ser permitido no Keycloak e `/auth/*` encaminhado ao BFF.
O padrão `Clear-Site-Data` é `cache,storage`: o cookie de state precisa sobreviver
até a verificação; cookies de sessão/binding são removidos individualmente.
Um override que inclua `cookies` pode apagar o state antes dessa validação.
O logout anônimo inicia o desafio OIDC; a revogação autenticada completa é
validada com Keycloak/proxy reais, além da regressão HTTP lazy sem resposta IdP
simulada. Veja [logout iniciado pelo usuário](https://quarkus.io/version/3.40/guides/security-oidc-code-flow-authentication/#user-initiated-logout).
O primeiro acesso REST a `/api/*` com uma referência OIDC inexistente, revogada
ou malformada retorna 401 em `application/problem+json`, sem `Location` e com
`Cache-Control: no-store`. O mecanismo OIDC expira o cookie inválido antes de
mapear a falha; a API não inicia outro fluxo de login nem emite cookie de state.
O mapper de `AuthenticationFailedException` mantém o desafio do autenticador
nas rotas do navegador, incluindo `/auth/login` e `/auth/logout`, para preservar
state, nonce e PKCE. A regressão executa HTTP com OIDC habilitado e Redis real,
sem simular respostas do IdP; a revogação autenticada após end-session é também
verificada no aceite com Keycloak e proxy reais.
As operações de store Redis durante autenticação usam `OidcRequestContext`
para executar fora da thread de eventos.
O filtro de cookies do callback usa `CurrentIdentityAssociation.getDeferredIdentity()`
e retorna `Uni<Void>`; a rotação/revogação CSRF com Redis executa em worker.
Ele mantém cookies Secure/HttpOnly/SameSite=Lax e aguarda a identidade autenticada,
sem acessar a identidade lazy de forma bloqueante na thread de I/O.
Veja a [referência oficial de autenticação lazy](https://quarkus.io/guides/security-proactive-authentication/).

Regressões de integridade usam JDBC direto contra PostgreSQL para comprovar
os três CHECKs de progresso, ownership e tipos DATE, sem passar pelos
validadores REST/ORM. A regressão do callback executa o filtro em um event loop
Vert.x real, usa a associação de identidade lazy do Quarkus e CSRF em Redis real,
e verifica que rotação/revogação executam fora da thread de I/O. A jornada OIDC
com Keycloak e proxy reais permanece necessária para validar o fluxo completo.

A rotação no filtro gerado REST ocorre somente na resposta 303 de `/auth/callback` ou `/auth/login`
autenticado, uma vez por requisição. Respostas de erro ou challenge preservam
o resultado original sem consultar novamente uma identidade rejeitada. Isso
impede reentrada pelo `FilterUtil.handleUniVoid` durante tratamento de falha.
Testes HTTP exercitam esse pipeline gerado, além da regressão Vert.x/Redis;
o aceite do login continua sendo a jornada assinada com Keycloak e proxy reais.
Com `restore-path-after-redirect=true`, Quarkus pode concluir a troca do código
e redirecionar ao `/auth/login` original antes de executar um recurso REST no
callback; a resposta autenticada desse recurso também cria o binding CSRF.
Redirects 302 do mecanismo OIDC nunca criam esse binding por si só.
O próprio mecanismo usa `AuthenticationRedirectException` após trocar e validar
o código quando remove parâmetros/restaura a rota; não se deve consultar essa
identidade novamente na resposta 302. Referência: [fonte Quarkus 3.40.1](https://github.com/quarkusio/quarkus/blob/3.40.1/extensions/oidc/runtime/src/main/java/io/quarkus/oidc/runtime/CodeAuthenticationMechanism.java).

O build fixa Byte Buddy e seu agent na mesma versão estável 1.18.14, que usa
ASM 9.10.1. O BOM 3.40.1 fornece 1.18.8: em um `clean verify` com Java 27,
o enhancer Hibernate de `BookEntity` falhou no leitor JDK ClassFile API
(`BoundLocalVariable.typeSymbol`, descriptor nulo). O ajuste mantém a
instrumentação ORM habilitada e é validado com build limpo e suíte completa.
A versão foi conferida nos [metadados Maven Central](https://repo.maven.apache.org/maven2/net/bytebuddy/byte-buddy/maven-metadata.xml)
e na [release oficial estável](https://github.com/raphw/byte-buddy/releases/tag/byte-buddy-1.18.14).

A exclusão deriva o nome OIDC da configuração `tenant-id` e `cookie-suffix`,
conforme `OidcUtils.getSessionCookieName`: com `Default` e `folhea`, o nome
real é `q_session_Default_folhea`. Revoga a referência desse cookie no store
e expira o mesmo nome/path/domain, além do binding CSRF separado. Os testes
comparam a política com a implementação Quarkus e exercitam DELETE com o nome
observado no Keycloak/BFF real. O logout OIDC permanece tratado pelo mecanismo
Quarkus (remoção da referência/cookie); seu evento revoga também o CSRF no worker.
Logs de exclusão não incluem o identificador pessoal da conta.
A [referência oficial ASM](https://asm.ow2.io/versions.html) registra suporte
Java 27 a partir de 9.10; 9.9.x cobre Java 26. O clean focado com Byte Buddy
1.18.14 passou pela instrumentação e iniciou PostgreSQL/migrações, revelando a
regressão esperada do nome OIDC anterior, sem erro de enhancement.
