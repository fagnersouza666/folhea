# FIX-02: Pendências depois da FIX-01 (PR pequeno, não trava o deploy)

Status: aprovada pelo Mestre em 12/10/2026
Origem: revisões do DevQuarkus dos PRs #49 a #52 e decisões do Diretor e do Arquiteto (12/10/2026)

## 1. V010 sem depender do código da aplicação

Situação: a migração V010 chama a classe `BookPhotoNormalizer`. Num banco novo isso não quebra, porque a `book_cover` vem vazia. Mas, se a classe mudar, uma migração que já rodou passa a se comportar de outro jeito.

Correção: copiar para dentro da migração o trecho que ela usa da classe. A V010 não pode ser editada, porque o Flyway confere o checksum de toda migração que já rodou e a troca de checksum quebra o deploy. Se a lógica estiver numa migração Java, o Arquiteto define se a cópia entra nela ou numa V011.

Critérios de aceite:
1. Nenhuma migração importa uma classe de `com.folhea` fora do pacote de migração.
2. Um banco novo sobe do zero com todas as migrações.
3. Um banco com capas antigas na `book_cover` migra e gera a mesma `book_photo` de antes.

## 2. Testes de 400 que ficaram faltando (FIX-01, critério 5)

Critérios de aceite:
1. Um teste mostra que um POST multipart com foto e `totalPages` = 0 responde 400 (`application/problem+json`).
2. Um teste mostra que um POST multipart com foto e sem a parte de dados do livro responde 400.

## 3. Script e2e com campos que não existem mais

Situação: `scripts/ci/e2e-bookshelf-real.mjs` ainda confere `averagePagesPerDay` e `elapsedDays` (linhas 62 e 90-178).

Critérios de aceite:
1. O script não usa mais esses campos e passa a conferir `averagePagesPerReadingDay`.
2. O script roda até o fim contra o ambiente local, como descreve `docs/operations.md`.

## 4. Mesmo limite de entrada nos dois caminhos da foto

Situação: a foto salva sai igual pelos dois caminhos, sem EXIF, com até 1600 px e até 1 MB. Só o tamanho da imagem aceita na chegada é diferente: o multipart `cover` aceita até 4096 px e o `PUT /photo` tem outro limite.

Correção: os dois caminhos aceitam o mesmo limite de entrada, o do `PUT /photo`, que é o da LIVRO-02. O Arquiteto confirma o valor.

Critérios de aceite:
1. Uma imagem acima do limite é recusada com o mesmo 400 e a mesma mensagem nos dois caminhos.
2. Um teste cobre os dois caminhos.

## Fora desta spec

- Renomear a conta de serviço `folhea-registration` para um nome que diga que ela só exclui conta. Isso mexe em configuração do Keycloak em produção, e o Arquiteto vai planejar como fazer. Não trava nada.

## Depois do merge

Vem a revisão do DevQuarkus e depois o aceite do Diretor. O deploy da 0.6.0 não espera esta spec. Ele depende só da decisão sobre o nome.
