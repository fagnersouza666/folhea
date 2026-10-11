# Spec SESSAO-01 — Registrar, editar e excluir sessão de leitura

Status: aprovada por Fagner (2026-10-11), incluindo a revisão de progresso por livro  
Produto: Folhea  
Recorte: Diretor de Produto, 2026-09-05 (agora = SESSAO-01)  
Base: PRD-01 §§30–32, 57, 64 + contrato do Arquiteto (2026-09-05)  
Depende de: AUTH-01 e LIVRO-01 aprovadas

## Problema

Sem sessão de leitura o Folhea não registra o hábito do dia. Este pedaço só cria, lista, edita e exclui sessões do usuário.

## Objetivo real

O leitor autenticado registra quanto leu em um dia (páginas e/ou minutos) ligado a um livro dele. Pode corrigir ou apagar depois.

## Fora de escopo

- Card, PWA, SEO
- Cronômetro ao vivo
- Mudança em AUTH-01
- Streak, stats gerais, dashboard e card (continuam no PROG-01 e CARD-01)

## Premissas (explícitas)

1. Sessão web AUTH-01 (cookie + CSRF nas mutações).
2. `bookId` tem de ser livro do usuário autenticado; senão → `404`.
3. Só o dono da sessão vê/altera; alheio ou inexistente → `404`.
4. `readingDate` é **DATE** (`YYYY-MM-DD`), nunca timestamp do “dia da leitura”.
5. Várias sessões no mesmo dia (mesmo livro ou livros diferentes) são permitidas.
6. PRD §32 fala em repercutir métricas na alteração — **métricas ficam no PROG-01**. Neste pedaço a alteração só persiste a sessão; não há endpoint de stats.
7. Se detalhe do PRD conflitar com este contrato, prevalece este recorte.

## Modelo `ReadingSession`

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | UUID | |
| `userId` | UUID | dono; da sessão |
| `bookId` | UUID | FK livro do mesmo usuário |
| `readingDate` | DATE | `YYYY-MM-DD` |
| `pages` | integer | `>= 0` |
| `minutes` | integer | `>= 0` |
| `createdAt` | TIMESTAMPTZ | |
| `updatedAt` | TIMESTAMPTZ | |

### Regra de validação (obrigatória em 3 camadas)

```text
pages >= 0
AND minutes >= 0
AND (pages > 0 OR minutes > 0)
```

Deve existir:

1. na API (validação de request);
2. na camada de domínio;
3. como constraint no PostgreSQL.

Omitir `pages` ou `minutes` no POST/PATCH: tratar como `0` se o outro campo cumprir a regra; se ambos omitidos/zero → `400`.

## Contrato API

| Método | Path | Papel |
| --- | --- | --- |
| `GET` | `/api/v1/sessions` | Lista sessões do usuário |
| `POST` | `/api/v1/sessions` | Cria sessão |
| `PATCH` | `/api/v1/sessions/{id}` | Edita sessão (só dono) |
| `DELETE` | `/api/v1/sessions/{id}` | Exclui (só dono) |

### Request — POST `/api/v1/sessions`

```json
{
  "bookId": "uuid",
  "readingDate": "2026-09-05",
  "pages": 32,
  "minutes": 25
}
```

- `bookId` e `readingDate` obrigatórios.
- `pages` e `minutes` opcionais no JSON, mas a regra `(pages > 0 OR minutes > 0)` deve valer após normalização.
- Resposta `201`: ReadingSession completo.

### Request — PATCH `/api/v1/sessions/{id}`

```json
{
  "bookId": "uuid?",
  "readingDate": "YYYY-MM-DD?",
  "pages": 0,
  "minutes": 0
}
```

- Só campos enviados mudam.
- Se mudar `bookId`, o novo livro tem de ser do usuário (`404` se não).
- Após merge, a regra de pages/minutes continua válida; senão → `400`.
- Resposta `200`: ReadingSession completo.

### GET lista

- Só sessões do usuário da sessão.
- Query opcional sugerida (não obrigatória no aceite): `?bookId=` e/ou `?from=&to=` — se não implementada, lista completa do usuário basta para este pedaço.
- Resposta `200`: array de ReadingSession.

### DELETE

- Resposta `204`.

### Shape ReadingSession (response)

```json
{
  "id": "uuid",
  "bookId": "uuid",
  "readingDate": "2026-09-05",
  "pages": 32,
  "minutes": 25,
  "createdAt": "2026-09-05T18:00:00Z",
  "updatedAt": "2026-09-05T18:00:00Z"
}
```

- `userId` opcional no JSON (aceite não exige expor).

## Erros

`application/problem+json`.

| HTTP | Quando |
| --- | --- |
| 400 | regra pages/minutes falhou; `readingDate` inválido/ausente; body inválido |
| 401 | sem sessão |
| 403 | CSRF inválido em mutação |
| 404 | sessão inexistente/alheia; `bookId` inexistente ou de outro usuário |

## Angular (comportamento mínimo)

- Fluxos: listar, registrar (escolher livro + data + páginas e/ou minutos), editar, excluir.
- `credentials: include` + CSRF nas mutações.
- Sem tela de streak/stats/card neste pedaço.

## Critérios de aceite (objetivos)

1. Com sessão e livro próprio: `POST /sessions` com páginas > 0 → `201`; aparece no `GET /sessions`.
2. Só minutos > 0 (pages 0) → `201`. Só pages e minutes 0 → `400`.
3. `bookId` de outro usuário ou fake → `404`.
4. `PATCH` corrige pages/minutes/data; regra continua valendo.
5. `DELETE` → some da lista; `GET` desse id (se houver detalhe) ou ausência na lista.
6. Sem sessão → `401`.
7. Sem streak, stats gerais ou card nesta entrega (o progresso por livro da revisão 2026-10-11 é a exceção).

## Revisão 2026-10-11: progresso por livro

Pedido do Mestre, decidido com Diretor e Arquiteto. A foto e o total de páginas do livro ficam na LIVRO-02. Esta spec não depende da LIVRO-02: sem total de páginas, o progresso funciona sem percentual.

### Calculado na hora, nunca gravado

A partir das sessões do próprio livro (`SUM(pages)` e `COUNT(DISTINCT readingDate)` por `bookId`, usando o índice `reading_session(book_id, reading_date)`):

| Campo na resposta do livro | Cálculo |
| --- | --- |
| `pagesRead` | soma de `pages` das sessões do livro |
| `averagePagesPerReadingDay` | `pagesRead` dividido pelos dias distintos com sessão desse livro, uma casa decimal. Sem sessão, vem `null` |
| `progressPercent` | só quando o livro tem `totalPages` (LIVRO-02): `pagesRead / totalPages * 100`, inteiro, máximo 100. Sem total, vem `null` |

- Na tela, a média se chama **"páginas por dia de leitura"**, para ninguém confundir com dias corridos.
- Criar, editar ou excluir sessão muda os números na hora.
- Ler mais que o total não é erro: o percentual para em 100% e `pagesRead` mostra o número real.
- Chegar a 100% não finaliza o livro. Finalizar continua sendo `POST /books/{id}/finish`.
- Sessão só com minutos não muda páginas lidas, média nem percentual.

### Critérios de aceite novos

8. Sessões de 30 e 45 páginas em dois dias diferentes: `pagesRead` 75 e "páginas por dia de leitura" 37,5.
9. Duas sessões no mesmo dia, de 20 e 30 páginas: `pagesRead` 50 e média 50,0 (conta um dia só).
10. Excluir a sessão de 45 do caso 8: `pagesRead` 30 e média 30,0.
11. Livro sem total de páginas: `progressPercent` vem `null` e a tela não mostra percentual.
12. Com a LIVRO-02 no ar e total de 300: o caso 8 mostra 25%. Passando de 300 páginas, mostra 100% e o livro continua `READING`.

## Definição de pronto

Spec aprovada por Fagner → Angular + Quarkus (+ constraint PG) contra **esta** versão → aceite vivo → sem PROG/CARD neste ciclo.

## Entrega e para

Analista entrega este `.md` e para. Devs fora até Fagner aprovar. Sem SESSAO-02 sem mudança pedida pelo Diretor.

## Situação no código (repo `folhea`, commit `12fb93f`, 2026-10-11)

| Item | Situação |
| --- | --- |
| Critérios 1 a 7 (CRUD de sessão) | implementado: `ReadingSessionResource`, regra pages/minutes na API, no domínio e em constraint do PostgreSQL (V001), `404` para livro ou sessão alheia, PATCH troca de livro |
| Filtro `?bookId=` | não existe (era opcional). Existe `?from=&to=` |
| Extras fora da spec | limite de 10.000 páginas e 1.440 minutos por sessão; data futura recusada. Ficam como estão, entram na spec se o Diretor aceitar |
| Critérios 8 a 12 (progresso por livro) | não implementado |

Falta o aceite no ar dos critérios 1 a 7 e a implementação dos 8 a 12.

