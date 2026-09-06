# Modelo de ameaças do Folhea v1

**Status:** baseline aprovado para implementação dos endpoints mutáveis

**Escopo:** aplicação web responsiva/PWA, Caddy, BFF Quarkus, Keycloak e PostgreSQL

**Última revisão:** 2026-09-06

Este documento é o contrato de segurança do v1. Um endpoint novo só pode ser
implementado depois de aplicar as regras de [baseline](baseline.md), adicionar
os testes de autorização/CSRF correspondentes e atualizar esta matriz quando o
fluxo de dados mudar.

## 1. Arquitetura e limites de confiança

```text
Browser/PWA não confiável
        | HTTPS; cookie de sessão; Origin/CSRF
        v
Caddy (borda pública)
        | /api/* e /auth/*; mesma origem; headers
        v
Quarkus BFF/API --------------------> Keycloak
        |                                 | OIDC
        | subject validado                 v
        v                            Google/e-mail
PostgreSQL
  (somente dados Folhea)
```

Limites de confiança:

| ID | De → para | O que não é confiável | Controles obrigatórios |
| --- | --- | --- | --- |
| TB-01 | Browser → Caddy | JavaScript, headers, body, IDs e cookies enviados pelo cliente | TLS, sessão `Secure`/`HttpOnly`, validação server-side, CSRF e checagem de `Origin` |
| TB-02 | Caddy → BFF | Requisição que não veio pelo caminho esperado | Rede privada, proxy explícito, headers de segurança e limite de corpo |
| TB-03 | BFF → Keycloak | Conteúdo de claims além do contrato OIDC | TLS, issuer/audience/assinatura/expiração validados e `sub` como única identidade |
| TB-04 | BFF → PostgreSQL | Valores e identificadores derivados da requisição | parâmetros/ORM, princípio do menor privilégio e predicado obrigatório por `user_id` |
| TB-05 | CI → artefatos/dependências | Código de terceiro, dependências e segredos acidentais | revisão de dependências, scanner de vulnerabilidade/misconfiguração e scanner de segredos |
| TB-06 | Operação → produção | Pessoas e processos sem necessidade de acesso | secrets externos, contas nominativas, MFA no IdP/admin e auditoria sem dados privados |

## 2. Ativos e classificação

| ID | Ativo | Classificação | Requisito |
| --- | --- | --- | --- |
| A-01 | `sub` OIDC e vínculo `User` | Confidencial | `sub` imutável e único; não usar e-mail como chave |
| A-02 | Cookie/ticket de sessão, state, nonce e tokens OIDC | Secreto | nunca ir para JavaScript, URL, Git ou logs; armazenamento server-side |
| A-03 | Livros, sessões, datas, métricas e configurações | Dado privado | isolamento por usuário em toda leitura e mutação; mínimo necessário em respostas |
| A-04 | Senhas e configuração do Keycloak | Secreto crítico | somente Keycloak/secrets manager; nunca consultar tabelas internas do Keycloak |
| A-05 | Credenciais de banco, client secret e chaves TLS | Secreto crítico | secret externo/variável de ambiente; rotação e acesso mínimo |
| A-06 | Logs, backups e artefatos CI | Operacional/confidencial | sem token, cookie, senha, foto, payload privado ou segredo; retenção definida |
| A-07 | Disponibilidade da API e integridade dos registros | Integridade/disponibilidade | rate limit, brute-force protection, validação e backups testados |

## 3. Atores e capacidades

| Ator | Capacidade presumida | Objetivo de segurança |
| --- | --- | --- |
| U1 — usuário legítimo | Cria e altera seus próprios livros/sessões | manter seus dados privados e íntegros |
| U2 — usuário autenticado curioso | Conhece UUIDs ou IDs de outra conta | não ler, alterar, finalizar ou excluir dados de terceiros |
| U3 — atacante anônimo | Controla requisições, origem, body e timing | não obter sessão, enumerar contas ou causar abuso relevante |
| U4 — atacante com sessão roubada | Possui um ticket válido por tempo limitado | reduzir impacto com expiração, revogação e ausência de tokens no browser |
| U5 — página/script de terceiro | Tenta enviar requisições cross-site | CSRF e política de origem devem impedir mutações |
| U6 — operador/fornecedor comprometido | Acesso limitado à infraestrutura ou dependências | menor privilégio, rotação, auditoria e bloqueio no CI |
| U7 — provedor OIDC | Emite claims conforme contrato OIDC | validar issuer, audience, assinatura, nonce, state e expiração |

O modelo não assume que UUID seja segredo, que `SameSite` substitua CSRF, que o
frontend aplique autorização ou que `robots.txt` proteja rotas privadas.

## 4. Ameaças, abuso e mitigação priorizada

Prioridade **P0** bloqueia merge. **P1** bloqueia release até correção ou aceite
formal de risco. **P2** deve entrar no backlog com responsável e prazo.

| ID | Abuso/ameaça | Impacto | Mitigação e evidência mínima | Prioridade |
| --- | --- | --- | --- | --- |
| T-01 | Trocar `bookId`/`sessionId` por ID de outro usuário (IDOR/BOLA) | leitura ou alteração de dados privados | derivar usuário da sessão; query com `WHERE id = ? AND user_id = ?`; testes 401/404 e mutações cross-user | **P0** |
| T-02 | Forjar `userId` no body, query ou header | atribuição indevida | ignorar identidade fornecida pelo cliente; `sub → User` no BFF; teste tenta `userId` de terceiro | **P0** |
| T-03 | Site malicioso induzir POST/PATCH/DELETE com cookie | alteração/exclusão de registros | token CSRF server-side por sessão, `X-CSRF-Token`, validação de `Origin`/`Referer`, `SameSite=Lax` | **P0** |
| T-04 | Roubar refresh/access token via XSS ou storage | takeover da conta | BFF com tokens apenas server-side; cookie `HttpOnly`; CSP sem `unsafe-inline`/`unsafe-eval`; expiração e revogação | **P0** |
| T-05 | Reutilizar callback OIDC ou trocar resposta de login | login em conta errada/fixação de sessão | Authorization Code + PKCE, state/nonce de uso único, redirect URI exata, rotação do ticket após login | **P0** |
| T-06 | Forjar issuer/audience/claims ou usar token expirado | bypass de autenticação | discovery/issuer fixado, assinatura JWKS, audience/client, `exp`/`nbf`/nonce validados | **P0** |
| T-07 | Brute force de senha, login ou recuperação | takeover e indisponibilidade | Keycloak brute-force protection, rate limit por IP e conta, mensagens não enumeráveis, alertas | **P1** |
| T-08 | Injetar HTML/SQL/JSON ou valores absurdos | XSS, corrupção ou DoS | Bean Validation, allowlists, queries parametrizadas/ORM, limites de tamanho e content-type | **P0** |
| T-09 | Observar token, cookie, e-mail ou payload privado em logs | exposição persistente | redaction centralizada, allowlist de campos, correlação sem payload, revisão automatizada | **P0** |
| T-10 | Expor PostgreSQL, console/admin do Keycloak ou actuator | tomada da infraestrutura | rede privada/firewall, sem portas públicas, admin com MFA/VPN e health endpoints mínimos | **P0** |
| T-11 | Dependência vulnerável ou segredo commitado | execução arbitrária/comprometimento | dependency review, Trivy e Gitleaks bloqueantes em PR/push; exceção expirada e justificada | **P0** |
| T-12 | Abuso de API e criação massiva de registros | custo/indisponibilidade | limits por IP/usuário, body limitado, paginação, quotas operacionais e alertas | **P1** |
| T-13 | Cache/proxy servir resposta privada a outra pessoa | vazamento de dados | `Cache-Control: no-store` em `/api/*`, ausência de cache público e testes com dois usuários | **P0** |
| T-14 | Downgrade HTTP, framing ou MIME sniffing | interceptação/execução de conteúdo | HTTPS automático, HSTS, CSP `frame-ancestors`, `X-Frame-Options`, `nosniff` | **P1** |
| T-15 | Secret ou imagem privada entrar em fixture/artefato | vazamento acidental | fixtures sintéticas, revisão de diffs, secret scan e regra de não armazenar fotos no v1 | **P0** |

## 5. Autorização por recurso

Todas as rotas autenticadas exigem sessão válida. O BFF resolve o `User` pelo
`sub` antes de acessar o domínio. O repositório deve aplicar o escopo na query,
e não carregar o recurso primeiro para só depois checar propriedade.

| Recurso/operação | Regra | Teste negativo obrigatório |
| --- | --- | --- |
| `GET /api/v1/books` | lista somente `book.user_id = currentUser.id` | usuário A não vê livro de B |
| `GET/PATCH/DELETE /api/v1/books/{id}` | exige propriedade do livro | A recebe 404 para ID de B e o livro de B permanece igual |
| `POST /api/v1/books/{id}/finish` | exige propriedade; idempotência só dentro da conta | A não finaliza livro de B |
| `DELETE /api/v1/books/{id}/finish` | exige propriedade | A não reabre livro de B |
| `GET /api/v1/sessions` | lista somente sessões do usuário | A não recebe sessão de B |
| `POST /api/v1/sessions` | `bookId` também deve pertencer ao usuário | A não cria sessão apontando para livro de B |
| `PATCH/DELETE /api/v1/sessions/{id}` | exige propriedade da sessão e valida livro relacionado | A não altera/exclui sessão de B |
| `GET /api/v1/stats` e `/dashboard` | agregações somente do usuário | métricas de A não incluem dados de B |
| `GET /api/v1/me` | retorna apenas o usuário da sessão | não aceita `id`/`sub` escolhido pelo cliente |

O contrato usa `404` para recurso inexistente ou não pertencente ao usuário,
evitando confirmar sua existência. A resposta nunca inclui `userId` arbitrário
recebido no request.

## 6. Critério de decisão e resposta a findings

Um finding é **crítico** se permitir autenticação/autorização bypass, exposição
de segredo/token/dado privado, execução de código, ou exposição direta do banco e
admin do IdP. Um finding **alto** inclui CSRF efetivo, XSS armazenado/refletido,
IDOR, vulnerabilidade crítica de dependência ou brute force sem proteção.

Findings P0/P1 bloqueiam merge/release. A exceção precisa ser um registro
explícito do proprietário do risco com: ID, impacto, justificativa, mitigação
compensatória, prazo de expiração e aprovador. Exceções não podem desativar o
scanner para o repositório inteiro.

Revisar este modelo quando houver novo ator, dado, origem, integração externa,
endpoint mutável ou mudança de fluxo de autenticação, e no mínimo a cada
trimestre antes de uma release.
