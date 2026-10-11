# Spec AUTH-01 — Conta com e-mail e senha

Status: aprovada por Fagner (2026-09-05)  
Produto: Folhea  
Recorte: Diretor de Produto, 2026-09-05 (agora = conta e-mail/senha)  
Base: PRD-01 §§55, 62, 68–70, 73–74 + contrato do Arquiteto (2026-09-05)

## Problema

Sem conta não há identidade Folhea nem base para livro, sessão e card. Este pedaço só cria e entra com e-mail e senha, com sessão web por cookie.

## Objetivo real

O leitor cria conta ou entra; o Angular fica com sessão cookie; `GET /api/v1/me` devolve o User Folhea. Sem token no JavaScript.

## Fora de escopo

- Livro, sessão de leitura, progresso, card
- PWA instalar, páginas públicas / SEO
- Google login
- Reset de senha, verificar e-mail
- Auth própria no Quarkus (senha no banco Folhea)
- Bearer / access / refresh no Angular
- Preço, assinatura, loja

## Dependências

- PRD-01 aprovado (nicho e auth Keycloak/BFF)
- Keycloak (IdP OIDC/OAuth2) disponível no ambiente de deploy
- Quarkus como BFF (cliente confidencial)
- Same-origin preferido: `folhea.com.br` + `/api/*` (ex.: Caddy) — simplifica cookie/CORS

## Premissas (explícitas)

1. Auth **não** é própria no Quarkus. Keycloak guarda credenciais. Quarkus **nunca** lê tabelas internas do Keycloak.
2. Folhea User: `id`, `identitySubject` (OIDC `sub`), `email`, `timezone` — **sem** campo senha (PRD §55).
3. Angular **não** vê access/refresh. Só cookies `Secure` + `HttpOnly` + `SameSite`, geridos pelo Quarkus.
4. Google fica no PRD para depois; **não** entra nesta spec.
5. Se detalhe do PRD conflitar com este recorte, **prevalece este recorte**.

## Contrato API

| Método | Path | Papel |
| --- | --- | --- |
| `POST` | `/api/v1/auth/register` | Cria no Keycloak + abre sessão cookie + upsert User Folhea |
| `POST` | `/api/v1/auth/login` | Autentica no Keycloak + abre sessão cookie + upsert User Folhea |
| `POST` | `/api/v1/auth/logout` | Encerra sessão Quarkus + logout Keycloak + limpa cookies |
| `GET` | `/api/v1/me` | Sessão obrigatória; devolve User Folhea |

### Request — register e login

```json
{ "email": "string", "password": "string" }
```

- `email`: trim + lower no servidor antes de validar/gravar
- `password`: mínimo 8 caracteres; nunca logar; nunca devolver na response

### Response 200 — register e login

Mesmo shape de `/me` (User Folhea). **Sem tokens no body.**

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "timezone": "America/Sao_Paulo"
}
```

- Cookies de sessão setados na response (HttpOnly, Secure, SameSite).
- Upsert User: se `identitySubject` já existe, atualiza `email`/`timezone` conforme política; se não, cria.

### Response 200 — GET /api/v1/me

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "timezone": "America/Sao_Paulo"
}
```

- Sem sessão válida → `401`.
- Qualquer rota protegida futura sem sessão → `401`.

### Logout — POST /api/v1/auth/logout

- Encerra sessão no BFF, logout no Keycloak, limpa cookies de sessão (e CSRF se aplicável).
- Response: `204` (sem body) ou `200` vazio — implementação escolhe um; critério é cookies limpos e `/me` = `401` em seguida.

## Sessão e cookies

- Sessão web só no BFF Quarkus.
- Refresh/token OIDC ficam no servidor (ou cookie criptografado do Quarkus OIDC) — Angular não mexe.
- Flags obrigatórias nos cookies de sessão: `Secure`, `HttpOnly`, `SameSite` (preferir `Lax` ou `Strict` no same-origin).

## CSRF (obrigatório neste pedaço — PRD §73)

SameSite sozinho **não** basta.

Estratégia nomeada para AUTH-01:

1. Cookie CSRF **legível pelo JS** (não HttpOnly), valor opaco aleatório.
2. Toda mutação (`POST`/`PUT`/`PATCH`/`DELETE`) exige header `X-CSRF-Token` (ou nome equivalente documentado na implementação) com o mesmo valor do cookie.
3. Quarkus rejeita mutação sem header válido → `403` (problem+json).
4. `GET /api/v1/me` não exige CSRF (só sessão).
5. Register/login: na primeira visita sem cookie CSRF, o BFF emite o cookie CSRF antes ou junto da mutação (fluxo usual double-submit); detalhe de bootstrap fica na implementação desde que mutações autenticadas fiquem protegidas.

## Erros

Envelope: `application/problem+json` (PRD §67).

| HTTP | Quando |
| --- | --- |
| 400 | e-mail ausente/inválido, senha com menos de 8 caracteres; `detail`/`field` claros |
| 401 | login: credenciais inválidas (mensagem **única**, sem revelar se o e-mail existe); `/me` sem sessão |
| 403 | CSRF inválido ou ausente em mutação |
| 409 | register: e-mail já registrado no Keycloak / conflito de negócio |

Senha e tokens **nunca** aparecem em log de application nem em response.

## Angular (comportamento)

- Chama só `/api/v1/auth/*` e `/api/v1/me` com `credentials: include` (cookies).
- **Não** guarda Bearer, access nem refresh em `localStorage`/`sessionStorage`/memória de app.
- Em 401 em rota protegida: trata como deslogado (tela de login).
- Envia header CSRF em toda mutação após ter o cookie CSRF.

## Critérios de aceite (objetivos)

1. **Register:** e-mail + senha válidos → 200 + cookies → `GET /api/v1/me` 200 com mesmo e-mail.
2. **Login:** conta existente → 200 + cookies → `/me` 200.
3. **Logout:** após logout → cookies de sessão limpos → `/me` = 401.
4. **Sem token no Angular:** network tab / storage sem access/refresh Bearer do Folhea; só cookies HttpOnly de sessão (+ CSRF legível).
5. **CSRF:** mutação autenticada sem header CSRF → 403; com header correto → segue.
6. **Fora:** sem Google, sem livro/sessão/card, sem reset/verify e-mail nesta entrega.

## O que NÃO é aceite deste pedaço

- Deploy Keycloak “bonito” além do necessário para register/login/logout/me.
- Telas de onboarding, PWA, SEO.
- Migração de usuários de outro sistema.

## Definição de pronto

Spec aprovada por Fagner → implementação Angular + Quarkus + Keycloak contra **esta** versão → aceite vivo dos critérios acima → sem código de livro/sessão/card neste ciclo.

## Entrega e para

Analista entrega este `.md` e para. Devs fora até Fagner aprovar. Sem AUTH-02 sem mudança de comportamento pedida pelo Diretor.
