SPEC COMPLETA (FIX-03), aprovada pelo Mestre em 14/10/2026.

# FIX-03: /healthz responde 200 no domínio

Status: aprovada pelo Mestre em 14/10/2026. Card: https://trello.com/c/XdoAuCQQ

## Contexto (14/10/2026)
- Hoje `https://folhea.app/healthz` retorna 404.
- Os timeouts de TLS vistos pelos bots vinham do IP de saída compartilhado deles (WARP `<IP_SAIDA_BOTS>`). O teste do Mestre pela rede dele deu 10 de 10 com 200, e os testes externos também passaram. Por isso o timeout fica fora do escopo da FIX-03 e segue em card próprio.

## Problema
No bloco do domínio do `infra/Caddyfile`, o `respond @health 200` está solto. O `handle { ... }` final dos arquivos estáticos atende antes e devolve o 404.html. O bloco `:81` funciona porque usa `handle @health`.

## Mudança
No bloco do domínio, trocar o `respond` solto por:

    handle @health {
    	respond 200
    }

## Critérios de aceite
1. `curl https://folhea.app/healthz` responde 200.
2. `/` continua respondendo 200 com o app.
3. Uma rota inexistente do app continua caindo no comportamento atual do SPA.
4. O bloco `:81` continua igual e respondendo 200 no `/healthz`.
5. Depois do merge, `PRODUCTION_HEALTH_PATHS` volta para `/healthz` e o check de saúde do deploy passa.

## Fora desta spec
Os timeouts de TLS. Eles vêm da rede dos bots, não do servidor, e ficam no card próprio do timeout. Se aparecerem fora dessa rede, investigar com `docker compose logs caddy` nesse card.
