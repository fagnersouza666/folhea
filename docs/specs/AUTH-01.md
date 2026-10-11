# Spec AUTH-01: conta com e-mail e senha

Status: aprovada por Fagner (2026-10-11), com os ajustes 1 a 4, o cadastro pela tela do Keycloak e o critério 9 com `manage-users` restrito ao excluir conta
Produto: Folhea
Recorte: Diretor de Produto, 2026-09-05; ajustes de 2026-10-11 com Diretor e Arquiteto
Base: PRD-01 §§55, 62, 68–70, 73–74, contrato do Arquiteto e revisão do repo `folhea` (commit `12fb93f`)
Versão anterior: o histórico do git deste arquivo (login e cadastro por `POST` com JSON)

## O que mudou desta versão para a anterior

1. Login e cadastro deixam de ser `POST` com JSON. Os dois são feitos na tela do Keycloak, por redirect. A senha nunca passa pelo Folhea.
2. Saem os três paths de cadastro (`/api/v1/registration`, `/api/v1/auth/register`, `/api/v1/register`).
3. A coluna `password_hash` sai do banco do Folhea.
4. Exportar dados e excluir conta passam a fazer parte desta spec, abertos a todos.

## Problema

Sem conta não há identidade Folhea nem base para livro, sessão e card.

## Objetivo real

O leitor cria conta ou entra pela tela do Keycloak e volta ao Folhea com sessão por cookie. `GET /api/v1/me` devolve o usuário Folhea. Nenhum token chega ao JavaScript. O leitor pode baixar os próprios dados e excluir a conta.

## Fora de escopo

- Google login
- Reset de senha e verificação de e-mail (se o Keycloak oferecer na própria tela, não é critério de aceite aqui)
- Tema visual do Keycloak (a tela fica com o visual padrão até alguém pedir um tema)
- Bearer, access ou refresh token no Angular
- `/api/v1/analytics/events` (parado até o Mestre dizer o que mede e para quê)
- Preço, assinatura, loja

## Premissas

1. O Keycloak guarda as credenciais. O Folhea não recebe, não guarda e não loga senha. O Quarkus nunca lê tabelas internas do Keycloak.
2. Usuário Folhea: `id`, `identitySubject` (o `sub` do OIDC), `email`, `timezone`. Sem campo de senha.
3. O Angular só tem cookies `Secure`, `HttpOnly` e `SameSite` geridos pelo Quarkus, mais o cookie CSRF legível.
4. Realm com `registrationAllowed: true` e `directAccessGrantsEnabled: false`.

## Contrato

### Navegação (redirect, fora de `/api/v1`)

| Método | Path | Papel |
| --- | --- | --- |
| `GET` | `/auth/login` | Redireciona para o login do Keycloak |
| `GET` | `/auth/register` | Redireciona para a tela de cadastro do Keycloak (endpoint de registro do OIDC ou `kc_action=register`; a implementação escolhe) |
| `GET` | `/auth/callback` | Volta do Keycloak, abre a sessão por cookie e faz upsert do usuário Folhea |
| `GET` | `/auth/logout` | Encerra a sessão no Quarkus e no Keycloak e limpa os cookies |
| `GET` | `/auth/logged-out` | Página de volta depois do logout |

O nome exato de `/auth/register` pode mudar se a implementação usar outro, desde que seja um path só e esteja descrito no PR.

### API

| Método | Path | Papel |
| --- | --- | --- |
| `GET` | `/api/v1/csrf` | Emite o cookie CSRF |
| `GET` | `/api/v1/me` | Devolve o usuário Folhea. Sem sessão, `401` |
| `PATCH` | `/api/v1/me` | Altera `timezone` |
| `GET` | `/api/v1/me/export` | Baixa os dados do usuário (livros, sessões e, com a LIVRO-02, as fotos) |
| `DELETE` | `/api/v1/me` | Exclui a conta. Corpo `{"confirm": true}`; sem isso, `400`. Resposta `204` e cookies limpos |

Shape de `/me`:

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "timezone": "America/Sao_Paulo"
}
```

### Excluir conta

- Apaga no Folhea o usuário, livros, sessões e fotos, e apaga o usuário no Keycloak.
- Se o Keycloak falhar no meio, a exclusão termina depois sozinha (já existe no código com a V007) e o leitor não consegue mais entrar.
- Para apagar no Keycloak, o Folhea usa uma conta de serviço com `manage-users` (o Keycloak não tem permissão menor que só apague). Ela só é usada pelo `DELETE /api/v1/me`, com login de no máximo 5 minutos e auditoria ligada.

## Banco

- Migração nova V008: `DROP COLUMN password_hash` em `folhea_user`, e `login_identifier` se não tiver uso. O campo sai do `UserEntity`.
- A V004 não é editada, porque o Flyway confere o checksum.

## Sessão e cookies

- Sessão só no BFF Quarkus. Tokens OIDC ficam no servidor ou em cookie criptografado do Quarkus.
- Cookies de sessão com `Secure`, `HttpOnly` e `SameSite` (`Lax` ou `Strict`).

## CSRF

1. Cookie CSRF legível pelo JS, valor aleatório.
2. Toda mutação em `/api/v1` (`POST`, `PUT`, `PATCH`, `DELETE`) exige o header `X-CSRF-Token` igual ao cookie. Sem ele, `403`.
3. `GET` não exige CSRF.

## Erros

`application/problem+json`.

| HTTP | Quando |
| --- | --- |
| 400 | excluir conta sem `{"confirm": true}`; `timezone` inválido |
| 401 | rota protegida sem sessão |
| 403 | CSRF inválido ou ausente em mutação |

E-mail repetido, senha fraca e senha errada são tratados na tela do Keycloak, não no Folhea.

## Angular

- "Entrar" leva a `/auth/login`. "Criar conta" leva a `/auth/register`. Não existe formulário de senha no Angular.
- Chama a API com `credentials: include` e manda `X-CSRF-Token` nas mutações.
- Não guarda token em `localStorage`, `sessionStorage` nem memória.
- `401` em rota protegida leva para a tela de entrada.
- Em Configurações: "Baixar meus dados" e "Excluir conta" (com confirmação), para todos, sem premium.

## Critérios de aceite

1. **Cadastro:** "Criar conta" abre a tela do Keycloak. Depois de cadastrar, o leitor volta ao Folhea logado e `GET /api/v1/me` dá `200` com o e-mail usado.
2. **Login:** conta existente entra pela tela do Keycloak e volta logada.
3. **Logout:** depois do logout, `/api/v1/me` dá `401`.
4. **Sem senha no Folhea:** nenhuma requisição ao Folhea leva senha. `POST /api/v1/registration`, `/api/v1/auth/register` e `/api/v1/register` dão `404` ou `405`. A coluna `password_hash` não existe mais no banco.
5. **Sem token no Angular:** storage e network sem access ou refresh token do Folhea.
6. **CSRF:** mutação sem `X-CSRF-Token` dá `403`; com o header certo, segue.
7. **Exportar:** "Baixar meus dados" entrega um arquivo com os livros e as sessões do leitor, e nada de outro usuário.
8. **Excluir:** depois de excluir, o leitor não consegue entrar de novo com o mesmo e-mail e senha, e os dados dele não aparecem para ninguém.
9. **Credencial de serviço:** a conta de serviço tem `manage-users` e só é usada pelo `DELETE /api/v1/me`, que exige sessão, CSRF e login de no máximo 5 minutos (se for mais antigo, o leitor digita a senha de novo no Keycloak com `prompt=login`). A ordem é gravar a `AccountDeletionIntent`, apagar o usuário no Keycloak e depois apagar livros, sessões, fotos e o `folhea_user` numa transação. Se o Keycloak falhar, um job tenta de novo a partir da intenção, sem duplicar. Os eventos de administração do Keycloak ficam ligados para auditoria. Nenhuma outra rota usa essa conta.

## Situação no código (commit `12fb93f`)

| Item | Situação |
| --- | --- |
| Login, callback e logout por redirect | feito |
| `/me`, CSRF, cookies | feito |
| Exportar e excluir conta | feito (V007) |
| Cadastro pela tela do Keycloak | não feito: hoje são três `POST` que recebem a senha |
| V008 sem `password_hash` | não feito |
| Conta de serviço usada só no excluir conta, com login recente | não feito: hoje também é usada no cadastro |

## Entrega e para

Analista entrega este `.md` e para. O Diretor aceita no ar contra esta versão.
