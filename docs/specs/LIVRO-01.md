# Spec LIVRO-01 — Cadastro, lista, finalizar e reabrir livro

Status: aprovada por Fagner (2026-09-05)  
Produto: Folhea  
Recorte: Diretor de Produto, 2026-09-05 (agora = LIVRO-01)  
Base: PRD-01 §§28–29, 56, 63, 70 + contrato do Arquiteto (2026-09-05)  
Depende de: AUTH-01 aprovada (sessão cookie + CSRF)

## Problema

Sem livro cadastrado não há o que ler no Folhea. Este pedaço só cria, lista, edita, finaliza, reabre e exclui livro do usuário.

## Objetivo real

O leitor autenticado gerencia seus livros físicos: título (obrigatório), autor (opcional), status `READING` | `FINISHED`, data de finalização reversível.

## Fora de escopo

- Sessão de leitura
- Progresso / streak / stats / dashboard
- Card, PWA, SEO
- ISBN, capa, catálogo, e-reader
- Google / mudança em AUTH-01

## Premissas (explícitas)

1. Toda rota exige sessão AUTH-01 (cookie). Mutações exigem CSRF.
2. Só o dono (`userId` = User da sessão) vê ou altera. Recurso de outro usuário ou inexistente → `404` (sem revelar existência alheia).
3. Sem ISBN/capa/catálogo neste pedaço.
4. Se detalhe do PRD conflitar com o contrato do Arquiteto neste recorte, prevalece o contrato.

## Modelo `Book`

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | UUID | |
| `userId` | UUID | dono; da sessão |
| `title` | string | obrigatório; trim; não vazio |
| `author` | string \| null | opcional; trim; vazio → null |
| `status` | `READING` \| `FINISHED` | |
| `finishedOn` | DATE (`YYYY-MM-DD`) \| null | preenchido só se `FINISHED` |
| `createdAt` | TIMESTAMPTZ | |
| `updatedAt` | TIMESTAMPTZ | |

Sem senha, sem ISBN, sem capa.

## Contrato API

| Método | Path | Papel |
| --- | --- | --- |
| `GET` | `/api/v1/books` | Lista livros do usuário autenticado |
| `POST` | `/api/v1/books` | Cadastra (status inicial `READING`, `finishedOn` null) |
| `GET` | `/api/v1/books/{id}` | Detalhe (só dono) |
| `PATCH` | `/api/v1/books/{id}` | Edita `title` e/ou `author` (só dono) |
| `DELETE` | `/api/v1/books/{id}` | Exclui (só dono) |
| `POST` | `/api/v1/books/{id}/finish` | Finaliza — body `{ "finishedOn": "YYYY-MM-DD" }` — **idempotente** |
| `DELETE` | `/api/v1/books/{id}/finish` | Reabre → `READING`, `finishedOn` null |

### Request — POST `/api/v1/books`

```json
{ "title": "O Hobbit", "author": "J. R. R. Tolkien" }
```

- `author` pode omitir ou ser `null`.
- Resposta `201`: Book completo.

### Request — PATCH `/api/v1/books/{id}`

```json
{ "title": "string?", "author": "string|null?" }
```

- Só campos enviados mudam.
- `PATCH` **não** muda `status` / `finishedOn` — isso é só via finish/reabrir.
- Resposta `200`: Book completo.

### Request — POST `/api/v1/books/{id}/finish`

```json
{ "finishedOn": "2026-09-05" }
```

- `finishedOn` obrigatório, formato `YYYY-MM-DD`.
- Efeito: `status = FINISHED`, `finishedOn` = valor enviado.
- **Idempotente:** repetir com o mesmo ou outro `finishedOn` em livro já `FINISHED` → `200` e atualiza `finishedOn` para o valor do body (última data enviada vale).
- Resposta `200`: Book completo.

### DELETE `/api/v1/books/{id}/finish`

- Efeito: `status = READING`, `finishedOn = null`.
- Se já estava `READING`: idempotente → `200` com Book já aberto.
- Resposta `200`: Book completo.

### GET lista

- Só livros do usuário da sessão.
- Ordem sugerida (implementação pode documentar): `updatedAt` desc — critério de aceite não depende de ordenação específica além de “só os meus”.
- Resposta `200`: array de Book.

### DELETE livro

- Remove o livro do dono.
- Resposta `204`.
- (Sessões futuras dependerão deste livro; neste pedaço não há sessão — exclusão não precisa cascata de sessão ainda.)

### Shape Book (response)

```json
{
  "id": "uuid",
  "title": "O Hobbit",
  "author": "J. R. R. Tolkien",
  "status": "READING",
  "finishedOn": null,
  "createdAt": "2026-09-05T16:00:00Z",
  "updatedAt": "2026-09-05T16:00:00Z"
}
```

- `userId` **não** precisa ir no JSON público se a sessão já identifica o dono; se a implementação incluir, ok. Aceite não exige expor `userId`.

## Erros

`application/problem+json`.

| HTTP | Quando |
| --- | --- |
| 400 | título ausente/vazio; `finishedOn` inválido/ausente no finish; body inválido |
| 401 | sem sessão |
| 403 | CSRF inválido em mutação |
| 404 | id inexistente **ou** de outro usuário |

## Angular (comportamento mínimo deste pedaço)

- Telas/fluxos: listar, cadastrar, editar título/autor, finalizar (com data), reabrir, excluir.
- `credentials: include` + header CSRF nas mutações (AUTH-01).
- Sem tela de sessão/progresso/card.

## Critérios de aceite (objetivos)

1. Com sessão: `POST /books` com título → `201`, aparece no `GET /books`, status `READING`.
2. `PATCH` altera título/autor; não altera status sem finish.
3. `POST .../finish` com data → `FINISHED` + `finishedOn`; repetir → ainda `200` (idempotente).
4. `DELETE .../finish` → `READING` + `finishedOn` null.
5. `DELETE /books/{id}` → some da lista; `GET` desse id → `404`.
6. Sem sessão → `401`. Outro usuário / id fake → `404`.
7. Sem sessão de leitura, stats, card, PWA, SEO nesta entrega.

## Definição de pronto

Spec aprovada por Fagner → Angular + Quarkus contra **esta** versão → aceite vivo dos critérios → sem SESSAO/PROG/CARD neste ciclo.

## Entrega e para

Analista entrega este `.md` e para. Devs fora até Fagner aprovar. Sem LIVRO-02 sem mudança pedida pelo Diretor.
