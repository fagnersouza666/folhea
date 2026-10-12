# Contrato API e domínio

## AUTH-01 — identidade delegada ao Keycloak

Cadastro e login são navegações GET `/auth/register` (OIDC `prompt=create`) e `/auth/login`. A escolha `prompt=create` usa a forma padrão recomendada pelo [Keycloak 26.7](https://www.keycloak.org/docs/26.7.0/server_admin/index.html#_application_initiated_actions) para abrir a mesma tela de registro; `/registrations` é a alternativa depreciada. O [OidcRedirectFilter do Quarkus 3.40](https://quarkus.io/version/3.40/guides/security-oidc-code-flow-authentication/#oidc-redirect-filters) acrescenta o prompt sem contornar state, nonce ou PKCE. Esta decisão de implementação não reescreve o anexo/spec aprovada. Folhea nunca recebe senha; os três POSTs de cadastro legados e `/api/v1/analytics/events` não existem. V009 remove `password_hash` e `login_identifier`, sem editar V001..V008 nem dados de livros/capas.

O BFF usa somente authorization code (sessão opaca Secure/HttpOnly/Lax no servidor). Callback/login/cadastro fazem upsert pelo `sub` e rejeitam subjects com intenção de exclusão persistida. `GET /api/v1/csrf` emite `__Host-folhea_csrf` Secure/Lax/Path=/ legível e mantém `{token}` para compatibilidade. Toda mutação exige Origin confiável e `X-CSRF-Token` igual ao cookie, além do vínculo servidor com a sessão HttpOnly; GET não exige CSRF.

`DELETE /api/v1/me` exige `{confirm:true}` com booleano JSON literal (strings e números retornam 400) e `auth_time` numérico inteiro do ID token OIDC verificado, entre agora-300s e agora (inclusivos); não usa `iat`, refresh ou login local. Ausência/antiguidade/futuro devolve `401 problem+json`, tipo `recent-authentication-required`, sem redirect. O cliente oferece `/auth/reauthenticate`, que encerra somente a sessão local, inicia login com `prompt=login`/`max_age=0` e retorna às Configurações; uma nova confirmação é necessária, nunca DELETE automático.

A intenção V007 confirma antes de chamar o IdP. Uma intenção pendente já bloqueia acesso e novos callbacks; erro posterior devolve `503 account-deletion-pending`, expira cookies e continua pelo job, sem novo login. Falha ao persistir a intenção devolve `503 account-deletion-unavailable` sem confirmar a operação. O cliente administrativo só possui DELETE por subject e recovery, exige TTL informado 1..300s e auditoria administrativa sem payloads. O commit da exclusão local é independente da limpeza Redis posterior. Exportação privada e V008/capas permanecem portáveis e sem métricas dinâmicas.


Contrato formal: `GET /api/openapi` (YAML/JSON por negociação). A aplicação web
usa sessão BFF HttpOnly; obter `GET /api/v1/csrf` e enviar `X-CSRF-Token` e
`Origin`/`Referer` da origem permitida nas mutações. Erros usam
`application/problem+json`; recursos alheios retornam 404.

## Conta e datas

Cadastro e login seguem a [AUTH-01](../specs/AUTH-01.md): os dois acontecem na tela do
Keycloak, por redirect (`/auth/register` e `/auth/login`). O Folhea não recebe senha.
O vínculo local com o `sub` é criado no callback/entrada restaurada após o fluxo OIDC.
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
e expira os cookies OIDC, binding HttpOnly e CSRF legível. Requer novo cadastro para voltar a usar a aplicação.
Nenhuma senha é gravada
pelo Folhea.
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
O `503 account-deletion-pending` conserva temporariamente os dados ainda não removidos, mas bloqueia acesso imediatamente e expira os cookies. A UI informa conclusão automática; não repete a confirmação. O `503 account-deletion-unavailable` antes do commit da intenção não confirma a exclusão. Intenções repetidas do mesmo subject não duplicam a operação.

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

## Estante e compatibilidade do contrato V008

`BookResponse` conserva seus campos e acrescenta `edition` (string até200),
`totalPages` (inteiro positivo de 32 bits ou null), `cover`, `hasPhoto` e `stats`. Título/autor têm até500;
JSON legado somente com título continua válido. Livros anteriores mantêm os
metadados novos nulos, sem perder dados, e podem ser completados por PATCH.
O cadastro novo na UI exige título; total, autor, edição e foto são opcionais.
Omissão em PATCH preserva; totalPages null apaga o total. Autor/edição vazios removem seus valores.

A UI usa JSON para metadados e RAW /photo separado, conforme LIVRO-02 abaixo.
Clientes anteriores continuam aceitos: com foto, POST `/api/v1/books`
e PATCH `/api/v1/books/{id}` usam multipart/form-data: parte `book` contém JSON
(application/json, até8192bytes) e `cover` contém JPEG/PNG. POST multipart
exige título/total e cover; autor/edição continuam opcionais. PATCH aceita
`book={}` para somente substituir a capa. A validação da imagem acontece antes
de persistir; livro/metadados/capa são confirmados na mesma transação. Falhas
não deixam livro parcial nesse contrato legado. No fluxo RAW novo, falha de
upload preserva o livro salvo e oferece retry sem novo cadastro.
O navegador controla o boundary, preservando Origin/X-CSRF-Token/BFF.

O endpoint multipart legado recebe JPEG/PNG até2097152bytes, lados1..4096 e
produto até4194304pixels. A validação ocorre antes de carregar pixels; assinatura
e MIME devem concordar. A saída agora delega ao JPEG canônico de até1.000.000bytes
e1600pixels, sem metadados. `cover` mantém
`{mediaType,byteSize,width,height,version}`; version deriva do SHA dos bytes,
portanto enviar a mesma imagem normalizada conserva a identidade do conteúdo.
GET `/books/{id}/cover` é alias autenticado com no-store; DELETE é compatível
e idempotente. A UI nova usa /photo; nada vira URL pública. V010 migra bytes
para book_photo e esvazia book_cover, preservando rollback e recuperação V007.

`stats={pagesRead,totalPages,percent,averagePagesPerDay,firstDate,referenceDate,
elapsedDays}` é calculado no backend por usuário+livro, com SUM(pages) e MIN(data)
de TODO histórico próprio. A listagem agrega em lote os livros de sua página,
sem limitar sessões a100/366dias e sem N+1. Sem sessões: pagesRead/avg/days=0,
firstDate=null. Sem total, percent=null. Percentual truncado em duas casas
(DOWN), limitado a100:299999/300000=99.99 e100 somente se soma>=total.
Releituras conservam a soma bruta; reduzir o total não apaga leituras nem finaliza.

Média=pagesRead/max(1,diasEntre(firstDate,referenceDate)+1), com dias corridos
inclusivos (inclusive sem leitura) e duas casas HALF_UP. ReferenceDate é hoje
no fuso da conta para READING, ou finishedOn para FINISHED. Datas legadas
inconsistentes não descartam sessões: finalização antes da primeira data usa
denominador 1. A média de concluídos permanece estável com o passar dos dias;
CRUD de leitura, metadados, finalização/reabertura repercutem na próxima consulta.

Exportação conserva JSON `{user,books,sessions}` e acrescenta `covers` com
`{bookId,mediaType,byteSize,width,height,version,dataBase64}`. Os livros exportados
contêm apenas metadados persistidos, sem stats/referenceDate/today, mantendo
conteúdo estável sem writes. O JSON é transmitido de um snapshot READ ONLY
com cursores JDBC/fetchSize1 e encoding Base64 em stream: no máximo uma capa
limitada por vez, sem materializar todo o catálogo. Não há novo fluxo de UI.

O limite HTTP do backend passa a3MiB para o envelope multipart; o filtro mantém
o limite JSON64KiB e aceita multipart somente nesses POST/PATCH de livros.
Todas as mutações de capa continuam protegidas por Origin/CSRF/rate limit.
Configuração de multipart segue o [guia oficial Quarkus REST3.40](https://quarkus.io/version/3.40/guides/rest/#handling-multipart-form-data).

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

Analytics de produto está pausado por AUTH-01; não há endpoint de eventos nem emissão no Angular. Métricas técnicas permanecem privadas.

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

O primeiro upsert OIDC é idempotente em requisições concorrentes. Conflitos nos índices de subject/e-mail não atualizam a identidade existente: a conta é resolvida exclusivamente pelo `sub`; outro subject com o mesmo e-mail recebe `401`, sem reassociação.

## LIVRO-02: total opcional e foto privada

O novo fluxo salva o livro por JSON; `totalPages` é opcional, inteiro positivo de 32 bits ou null. Em PATCH, omissão preserva e null apaga o total. Autor/edição e finalização manual são preservados; esta entrega não muda cálculos de leitura.

- `PUT /api/v1/books/{id}/photo`: corpo RAW JPEG/PNG/WebP, sessão BFF e CSRF; retorna BookResponse com `hasPhoto`. Limite **1 MB = 1.000.000 bytes** independente do JSON de 64 KiB. Falha mantém a foto anterior; retry usa o mesmo livro.
- `GET /api/v1/books/{id}/photo`: JPEG normalizado e ETag SHA-256 dos bytes; `private, no-cache, max-age=0, must-revalidate` em 200/304. Autenticação e ownership são verificados antes de If-None-Match; alheio/ausente 404, anônimo 401, erros no-store.
- `DELETE /api/v1/books/{id}/photo`: CSRF e ownership, 204 presente; foto ausente ou livro alheio/inexistente 404. Exclusão do livro/conta remove a foto por FK cascade.

Assinatura e decoder ImageIO reais são conferidos, com entrada limitada a 24 MP/16384 px por lado antes da alocação. JPEG/PNG/WebP são regravados como JPEG sem EXIF/GPS, fundo branco para alpha, lado máximo 1600 e saída até 1.000.000 bytes; qualidade/dimensões adaptam ao orçamento. WebP usa SPI Java TwelveMonkeys ImageIO 3.15.3, sem JNI. Formato inválido 415; corpo acima do limite 413; problemas usam application/problem+json.

V010 é migração Java Flyway transacional: processa cada capa V008 com cursor de uma linha, preserva o original até o sucesso de toda a transação e apaga as linhas legadas somente depois da conversão. Falha reverte DDL/dados e mantém originais. V008/V009 não são alteradas. `book_photo` contém uma foto por livro (bytes, content_type, SHA, dimensões/tamanho e timestamps); `book_cover` permanece vazia apenas para compatibilidade de schema, nunca como segunda mídia retida. POST/PATCH multipart e /cover anteriores delegam à foto canônica; a UI nova usa somente JSON e /photo RAW.

Export é um snapshot somente leitura, com cursor/fetchSize 1: `photos` inclui bytes base64/SHA/timestamps persistidos; o campo `covers` compatível representa os mesmos bytes canônicos, sem uma segunda foto no banco. Livros exportados incluem hasPhoto e metadados persistidos, sem stats/datas calculadas.
