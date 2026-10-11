# Spec LIVRO-02: foto e total de páginas do livro

Status: aprovada por Fagner (2026-10-11)
Produto: Folhea
Recorte: pedido do Mestre (2026-10-11), decidido com o Diretor de Produto; desenho técnico do Arquiteto
Depende de: AUTH-01 e LIVRO-01 aprovadas
Não reabre a LIVRO-01: ela fecha com o olhar no ar.

## Problema

Na estante pessoal o livro só tem título e autor. O leitor quer ver a foto do próprio exemplar e saber quanto falta para terminar.

## Objetivo real

O leitor pode informar o total de páginas e tirar ou enviar uma foto do livro. Com o total, a SESSAO-01 passa a mostrar o percentual lido.

## Fora de escopo

- Catálogo, ISBN e capa automática (mortos no v1)
- URL pública ou assinada da foto
- Mais de uma foto por livro
- Cálculo de progresso (fica na SESSAO-01)

## Total de páginas

| Campo | Tipo | Regra |
| --- | --- | --- |
| `totalPages` | integer ou null | opcional; se informado, inteiro maior que zero |

- `POST /api/v1/books` e `PATCH /api/v1/books/{id}` aceitam `totalPages`. No PATCH, `null` apaga o valor.
- Livros já cadastrados ficam com `totalPages` null e continuam funcionando.
- Valor zero, negativo ou não inteiro dá `400`.

## Foto do livro

### Onde fica

No PostgreSQL, tabela `book_photo`: `book_id` (chave, um para um com o livro), `content_type`, `bytes`, `sha256`, `createdAt`, `updatedAt`. Entra no backup diário e sai junto quando o livro ou a conta é excluído. Se o volume pesar, migra para object storage sem mudar o contrato.

### Contrato

| Método | Path | Papel |
| --- | --- | --- |
| `PUT` | `/api/v1/books/{id}/photo` | Envia ou troca a foto. Corpo é a imagem crua, não multipart |
| `GET` | `/api/v1/books/{id}/photo` | Devolve a foto, com `Cache-Control: private` e `ETag` |
| `DELETE` | `/api/v1/books/{id}/photo` | Remove a foto |

- Tudo pela sessão do BFF (AUTH-01). `PUT` e `DELETE` exigem CSRF.
- Livro de outro usuário, inexistente ou sem foto dá `404`.
- A resposta do livro indica se há foto (ex.: `hasPhoto`), para o front não pedir à toa.

### Formato e tamanho

- No front, o leitor escolhe JPEG, PNG ou WebP. O front reduz para no máximo 1600 px no lado maior, converte para JPEG de até 1 MB e apaga o EXIF (que costuma trazer o GPS da casa).
- O servidor não confia no front: confere a assinatura do arquivo, não só o `Content-Type`; acima de 1 MB dá `413`; formato errado dá `415`; regrava o JPEG sem metadados antes de salvar.
- A rota da foto tem limite de corpo próprio, separado do limite de JSON do `SecurityBoundaryFilter`.

### LGPD

A exportação de dados do usuário e a exclusão de conta incluem a foto.

## Erros

`application/problem+json`.

| HTTP | Quando |
| --- | --- |
| 400 | `totalPages` inválido |
| 401 | sem sessão |
| 403 | CSRF inválido em `PUT` ou `DELETE` |
| 404 | livro alheio, inexistente ou sem foto |
| 413 | foto acima de 1 MB |
| 415 | arquivo que não é JPEG, PNG ou WebP |

## Critérios de aceite

1. Cadastrar livro com `totalPages` 300: salvo e devolvido. Com 0 ou -5: `400`.
2. Livro antigo sem total continua listando e abrindo normalmente.
2b. O leitor corrige o total depois (`PATCH` de 300 para 320) e o percentual da SESSAO-01 recalcula. Livro sem ISBN ou catálogo aceita total normalmente.
3. Enviar foto de celular: aparece na estante e no detalhe. O arquivo salvo é JPEG, com no máximo 1600 px e sem EXIF (sem GPS).
4. `PUT` com PDF renomeado para `.jpg` dá `415`. Acima de 1 MB dá `413`.
5. Outro usuário pede `GET` da foto: `404`. A foto não tem URL pública.
6. `DELETE` da foto: some da tela, e o `GET` dá `404`.
7. Excluir o livro ou a conta apaga a foto. A exportação de dados inclui a foto.
8. Com total 300 e 75 páginas lidas, a SESSAO-01 mostra 25%.

## Entrega e para

Analista entrega este `.md` e para. Ninguém codeia até o Mestre aprovar.

## Situação no código (repo `folhea`, commit `12fb93f`, 2026-10-11)

Nada implementado: sem `totalPages`, sem tabela `book_photo`, sem rota de foto. A foto que existe hoje é o fundo do card, que fica só no aparelho e não é do livro. A página pública "recursos" diz que o Folhea não exige foto do livro; com a LIVRO-02 continua verdade, porque a foto é opcional.

