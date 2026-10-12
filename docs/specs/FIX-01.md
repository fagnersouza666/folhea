# FIX-01: Correções antes do deploy da 0.6.0

Status: aguardando aprovação do Mestre
Origem: revisão do DevQuarkus dos PRs #49, #50 e #51 e prioridade do Diretor (12/10/2026)
Trava: aceite da LIVRO-02 e da SESSAO-01

## 1. Bug: cadastro de livro com foto exige total de páginas (LIVRO-02, critério 1)

Situação: em `BookResource.java:73`, o `createMultipart` devolve 400 com "Informe o total de páginas do livro." quando `totalPages` não vem. Pela spec, o campo é opcional.

Correção: remover essa checagem. As outras validações continuam iguais (título obrigatório e `validateMetadata`, que valida `totalPages` só quando ele vem).

Critérios de aceite:
1. Um POST multipart com título e foto, sem `totalPages`, cria o livro (201) com `totalPages` nulo.
2. Esse livro não mostra percentual.
3. Um POST multipart com `totalPages` inválido (0, negativo ou acima do limite) continua dando 400.
4. Existe um teste automatizado para o caso 1.

## 2. Bug: duas médias de páginas por dia (SESSAO-01)

Situação: a resposta tem duas médias.
- `averagePagesPerReadingDay` (`BookReadService.java:52`) divide as páginas pelos dias distintos com leitura. É o cálculo da spec.
- `averagePagesPerDay` e `elapsedDays` (`BookStats.java:13-15`) dividem pelos dias corridos. Isso está fora da spec.

Correção: tirar `averagePagesPerDay` e `elapsedDays` do `BookStats` e da resposta da API.

Uso no front (conferido em 12/10/2026): a tela usa só `averagePagesPerReadingDay` (`book-progress.component.ts:14`). Os dois campos que saem aparecem apenas no tipo `BookStats` de `models.ts:32-35` e em mocks de teste (`home.component.spec.ts`, `dashboard.store.spec.ts`). Eles saem do tipo e dos mocks no mesmo PR.

Critérios de aceite:
1. Nenhuma resposta da API tem `averagePagesPerDay` ou `elapsedDays`.
2. Com 75 páginas em 2 dias distintos, `averagePagesPerReadingDay` vale 37,5.
3. Sem nenhuma sessão, a média é nula e a tela não mostra média.
4. Os testes do `BookStatsTest` passam a verificar a média por dia de leitura, ou são removidos se a classe deixar de calcular média.
5. O build do front e os testes passam.

## 3. Registro na spec (sem código)

A V009 removeu `password_hash` e também `login_identifier`. O DevQuarkus confirmou que ninguém lê `login_identifier`. A AUTH-01 passa a citar as duas colunas. A V009 substitui a V008 da spec, porque esse número ficou com a migração das fotos.

## Fora desta spec (vai para o próximo PR, não trava o deploy)

- V010: copiar para dentro da migração o trecho que ela usa do `BookPhotoNormalizer`, para não depender do código da aplicação. Fonte: Arquiteto.
- Renomear a conta de serviço `folhea-registration` para um nome que diga que ela serve para excluir contas.
- `book_cover` antiga aceitando até 4096 px: fica como IDEIA.

## Ordem

1, depois 2, no mesmo PR ou em dois PRs. Depois do merge vêm a revisão do DevQuarkus, o deploy da 0.6.0 (que depende da decisão do nome) e o teste no ar pelo Avaliador.
