# Contrato público

`public-contract.json` é a fonte única da origem SEO pública e dos 33 IDs de problemas relativos. `publicOrigin` alimenta SEO; não substitui as variáveis de origem do backend/IdP. O mapa `problemTypes` define os nomes UPPER_SNAKE e valores `/problems/slug` usados por Java e TypeScript.

Após editar o catálogo, execute na raiz:

```sh
node scripts/ci/generate-public-contract.mjs
node scripts/ci/generate-public-contract.mjs --check
node --test scripts/ci/tests/public-contract.test.mjs
```

Commite também `backend/src/main/java/com/folhea/shared/ProblemTypes.java` e `frontend/src/app/core/api/problem-types.generated.ts`. Não edite esses outputs manualmente. O TypeScript exporta `PROBLEM_TYPES` e `PUBLIC_SITE_ORIGIN`; Java exporta `ProblemTypes`. Os outputs ficam versionados para Maven/Angular consumirem sem Node adicional em runtime ou fetch HTTP. O check de CI rejeita outputs ausentes ou desatualizados sem reescrevê-los.

Os IDs não incluem host, query, fragmento ou alias de URL antiga. Status, title e detail dos erros pertencem aos consumidores e não são alterados pelo gerador. A geração SEO de index/robots/sitemap usa a mesma `publicOrigin` do catálogo.
