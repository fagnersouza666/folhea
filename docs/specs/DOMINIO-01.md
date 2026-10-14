# DOMINIO-01: Folhea responde e se identifica como folhea.app

Status: aprovada pelo Mestre em 13/10/2026.. Card: https://trello.com/c/CvKc4plH

## Objetivo
Tirar do repositório e da configuração todo resto de `folhea.com.br` e `folhea.fagnersouza.tech`, para o login funcionar em `https://folhea.app` e o contato legal apontar para um e-mail do Mestre.

## Contexto
- O Mestre decidiu em 13/10/2026 usar `https://folhea.app` como ambiente de trabalho e teste.
- O Arquiteto encontrou `folhea.com.br` em `application.properties`, nos problem types, no SEO e nos textos legais.
- `oi@folhea.com.br` aparece na política de privacidade e nos termos. O domínio é de outra empresa, o que é risco de LGPD.
- O repo é público: nenhum domínio, IP ou dado de infraestrutura fixo no código além do domínio público do produto.

## Escopo, em duas entregas
- **Parte A (agora):** itens 1 e 4.
- **Parte B (PR separado, depois da DEPLOY-01):** itens 2 e 3.

### 1. Configuração (Parte A)
- `application.properties` sem `folhea.com.br` como default em CORS, OIDC (authorization, logout, issuer), `canonical-origin` e `allowed-origins`.
- Esses valores vêm de variáveis de ambiente derivadas de `PUBLIC_DOMAIN`. Em dev, default `http://localhost`.
- Realm do Keycloak: `redirectUris`, `webOrigins`, `post.logout.redirect.uris` e `frontendUrl` com `https://folhea.app`, configurados pelo export do realm com placeholder, sem domínio fixo.
- Verificar se o `.env` do servidor sobrescreve CORS e OIDC e alinhar com `folhea.app` (o `.env` fica fora do repo).

### 4. E-mail de contato (Parte A)
- Política de privacidade e termos usam `contato@folhea.app` (decisão do Mestre em 13/10/2026, provisória).
- O e-mail vem de uma única constante ou configuração, usada nos dois textos.

### 2. Problem types (Parte B)
- `https://folhea.com.br/problems/...` vira relativo `/problems/...`, numa constante compartilhada.
- O frontend (`auth.service.ts`, `csrf.interceptor.ts`, `settings.component.ts`) compara pela mesma constante.

### 3. SEO (Parte B)
- `canonical`, `og:*`, `sitemap.xml`, `robots.txt` e `validate-seo.mjs` usam `https://folhea.app`, gerados a partir de uma única origem.

## Critérios de aceite
### Parte A
1. Login, logout e cadastro funcionam em `https://folhea.app`, sem erro de redirect ou CORS no console.
2. `application.properties` não tem `folhea.com.br` nem `folhea.fagnersouza.tech`.
3. O realm exportado do Keycloak não tem domínio fixo além do placeholder.
4. Política de privacidade e termos mostram `contato@folhea.app`; `rg "oi@folhea\.com\.br"` não acha nada.
5. Testes de backend e frontend passam no CI.
### Parte B
6. Nenhum problem type usa URL absoluta; frontend e backend compartilham a constante, com teste cobrindo a comparação.
7. `validate-seo.mjs` passa com `folhea.app`.
8. `rg "folhea\.com\.br|folhea\.fagnersouza\.tech"` não acha nada no repo.

## Dependências
- Caixa `contato@folhea.app` precisa existir e receber e-mail antes de ir ao ar.
- Mestre confirma o IP `195.35.16.186` como servidor do Folhea.
- Libera o teste do Avaliador (precisa do login em folhea.app).

## Fora do escopo
- Limite por IP e timeout (card próprio).
- Healthcheck `/healthz` (FIX-03).
