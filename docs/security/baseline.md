# Baseline de segurança do Folhea v1

Este baseline transforma o modelo de ameaças em critérios de implementação,
operação e CI. Itens marcados como obrigatórios são condição de merge para a
primeira release; o PRD continua sendo a fonte dos requisitos de produto.

## 1. Identidade, sessão e Keycloak

- Usar OpenID Connect sobre OAuth 2.1 com Authorization Code + PKCE.
- O Quarkus funciona como BFF: inicia o login, troca o code e mantém access e
  refresh tokens somente no servidor. Angular nunca grava tokens em
  `localStorage`, `sessionStorage`, IndexedDB, URL ou cookie legível por
  JavaScript.
- Validar `issuer` fixo do realm, assinatura via JWKS, `aud`, `azp`, `exp`,
  `nbf`, `iat`, `nonce` e o `state` associado à tentativa. Aceitar somente uma
  redirect URI exata; não aceitar curingas em produção.
- Após autenticação, rotacionar o ticket de sessão e invalidar o ticket
  anterior. Timeout absoluto e de inatividade devem ser configurados no
  Keycloak/BFF e documentados no ambiente. Logout revoga a sessão server-side e
  inicia logout OIDC quando aplicável.
- O cookie de sessão de produção deve ser equivalente a:

  ```http
  Set-Cookie: __Host-folhea_session=<opaque-ticket>; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800
  ```

  `__Host-` exige `Path=/` e proíbe `Domain`, reduzindo escopo e fixação. Nunca
  usar `SameSite=None` sem justificativa e revisão de risco.

### Mapeamento `subject → User`

1. O BFF obtém `sub` do token validado, nunca de body, query, header ou claim de
   e-mail enviada pelo browser.
2. A tabela `user` tem `oidc_subject` `NOT NULL UNIQUE`. O primeiro login cria
   o registro em transação; logins seguintes fazem lookup por `oidc_subject`.
3. E-mail é atributo mutável para contato, não identificador nem mecanismo de
   reassociação automática. A troca de e-mail não troca o usuário.
4. `user_id` interno é a única chave usada nas tabelas `book` e
   `reading_session`; o vínculo deve ser criado no servidor.
5. Testes obrigatórios cobrem primeiro login, login recorrente, mudança de
   e-mail, `sub` desconhecido, token expirado, issuer/audience incorretos e
   tentativa de enviar `userId` de outro usuário.

## 2. CSRF e política de origem

Como a sessão usa cookie, toda operação `POST`, `PUT`, `PATCH` e `DELETE` exige:

1. token CSRF imprevisível, gerado e armazenado server-side, vinculado ao
   ticket; o BFF expõe apenas o valor não secreto necessário para o Angular;
2. header `X-CSRF-Token` igual ao token esperado; token no cookie não é a única
   defesa;
3. `Origin` igual à origem canônica `https://folhea.com.br` (ou `Referer` com
   mesma origem quando `Origin` não existir); ausência ou origem diferente é
   rejeitada;
4. `Content-Type: application/json` e limite de corpo; não aceitar forms
   simples para mutações autenticadas.

Rotacionar o token no login/logout e rejeitar token ausente, expirado ou
associado a outra sessão. `SameSite` é defesa adicional, nunca substituta do
token e da checagem de origem. Testes tentam mutação sem token, com token de
outra sessão e com origem maliciosa.

Frontend e API usam a mesma origem pública:

```text
https://folhea.com.br/       # Angular/SSG/PWA
https://folhea.com.br/api/*  # BFF/Quarkus via Caddy
```

O padrão é não enviar cabeçalho CORS. Se uma origem adicional for aprovada,
allowlist exata deve ser configurada no servidor, sem `*`, com
`Access-Control-Allow-Credentials: true` apenas quando indispensável e
`Vary: Origin`. Preflight e métodos permitidos devem ser mínimos.

## 3. Headers, HTTPS e cache

O proxy deve entregar os headers abaixo em páginas públicas e API, adaptando
apenas `Cache-Control` ao tipo de resposta:

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; upgrade-insecure-requests
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

Não adicionar `unsafe-eval` ou `unsafe-inline` à CSP para contornar um build;
alterações exigem revisão. `HSTS preload` só pode ser ativado depois de
confirmar HTTPS em todos os subdomínios.

Para `/api/*` usar no mínimo:

```text
Cache-Control: no-store
```

Não usar cache público para respostas autenticadas, incluindo redirects OIDC,
dashboard, stats, livros e sessões. PostgreSQL e o console administrativo do
Keycloak ficam em rede privada, sem exposição indiscriminada à internet.

## 4. Autorização e validação de entrada

- Toda rota `/api/v1/*` autenticada exige sessão; falha de autenticação retorna
  `401`. Recurso inexistente ou de outra conta retorna `404`.
- Nunca confiar em `userId`, `ownerId` ou equivalente enviado pelo cliente.
  Cada query de livro/sessão inclui o predicado de propriedade, inclusive em
  `UPDATE` e `DELETE`.
- Validar UUID, datas ISO/`LocalDate`, enumerações e tipos no backend. Título é
  obrigatório; `pages` e `minutes` são inteiros `>= 0` e pelo menos um é `> 0`.
  Rejeitar campos desconhecidos e payloads acima do limite documentado.
- Usar ORM/queries parametrizadas; nunca concatenar SQL, HTML ou comandos a
  partir da entrada. Codificar saída por contexto e manter CSP.
- Não registrar corpo de request/response ou tokens. Erros seguem
  `application/problem+json` sem stack trace, SQL, segredo ou existência de
  dados de outra conta.

## 5. Rate limiting e brute force

Os limites iniciais são defaults operacionais, devem ser medidos e ajustados
sem remover a proteção:

| Superfície | Limite inicial | Chave/resultado |
| --- | --- | --- |
| início de login, callback e recuperação | 10/min/IP e proteção por conta | `429`, backoff e mensagem não enumerável |
| mutações da API | 60/min/usuário e 20/min/IP | `429` com `Retry-After` |
| leituras da API | 120/min/usuário | `429` com `Retry-After` |
| body HTTP | 64 KiB para JSON da API | `413` antes de processar |

Configurar no realm Keycloak a proteção contra brute force (habilitada, limite
de falhas, espera incremental, bloqueio máximo e janela de reset) e testar o
comportamento em ambiente não produtivo. Os valores do realm devem ser
versionados como configuração sem segredos ou exportados por canal seguro.
Rate limit não substitui validação, autorização ou proteção contra abuso
distribuído; alertas devem acompanhar picos de `401`, `403` e `429`.

O código mantém fallback in-memory fail-closed para `%test` e testes unitários.
Em produção (`%prod`) o Redis na rede privada persiste sessão OIDC, CSRF e rate
limit com TTL alinhado ao cookie de sessão (8 h). Fora do Compose, exigir TLS
(`rediss://`) — ressalva documentada no veredicto de segurança.

## 6. Segredos, dados e logs

- Segredos chegam por secret manager/CI secrets ou variáveis de ambiente fora
  do Git. Proibidos no repositório: senhas, client secrets, tokens, cookies,
  chaves privadas, dumps, fotos reais e dados privados.
- Fixtures usam UUIDs, e-mails e títulos sintéticos. Testes nunca imprimem
  token/cookie; valores sensíveis devem ser redigidos mesmo em exceções.
- Logs estruturados usam request ID, rota, status, latência e identificador
  interno não reversível. Não registrar `Authorization`, `Cookie`, query/body,
  e-mail, título do livro, conteúdo de erro do IdP ou URL com code/state.
- Backups são criptografados, têm acesso mínimo e restauração testada. Definir
  retenção e exclusão conforme a política de privacidade antes da produção.

## 7. Gates de CI e gestão de findings

O workflow `.github/workflows/security.yml` é obrigatório em pull request e
push. Gitleaks falha quando encontra segredo; Trivy falha em vulnerabilidades,
segredos ou misconfigurações conforme a severidade configurada; Dependency
Review falha em vulnerabilidades `high`/`critical`. Nenhum job usa
`continue-on-error`.

Um finding P0/P1 só pode ser liberado com aceite formal contendo responsável,
prazo de expiração, impacto, justificativa e mitigação. Supressão deve ser
específica para arquivo/regra e revisada; não desabilitar scanner globalmente.
Dependências devem ser atualizadas ou substituídas antes do prazo do aceite.

O job de Dependency Review consulta a API do Dependency Graph antes de executar
a revisão incremental. Se o repositório não tiver o Dependency Graph habilitado,
o job registra um aviso e pula somente essa revisão; o Trivy continua bloqueante
para vulnerabilidades, segredos e misconfigurações no checkout completo. Erros
da API diferentes da indisponibilidade explícita do recurso continuam falhando o
job. Habilitar o Dependency Graph restaura a revisão incremental sem alterar os
limites de severidade.

## 8. Checklist antes de liberar endpoint mutável

- [ ] rota está na matriz de autorização e tem teste com dois usuários;
- [ ] query aplica ownership no banco, não apenas no frontend;
- [ ] autenticação, CSRF, `Origin`, content-type e limite de body cobertos;
- [ ] validação de entrada e erro `problem+json` não revelam dados;
- [ ] resposta privada tem `Cache-Control: no-store`;
- [ ] logs e fixtures foram revisados para ausência de dados sensíveis;
- [ ] scanners passaram e não existe finding P0/P1 sem aceite válido;
- [ ] mudança de trust boundary/ativo atualizou o threat model.
