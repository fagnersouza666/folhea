# Frontend Folhea v1

Aplicação Angular 22: páginas públicas SSG e área privada CSR, com navegação web normal e instalação PWA opcional. O build de produção é estático; não requer Node como servidor. A versão do produto é controlada pela integração do monorepo.

## Contato público

O contato de Privacidade, Termos e Sobre vem da única constante `LEGAL_CONTACT_EMAIL`, em `src/app/public/legal-contact.ts`: `contato@folhea.app`. As três páginas exibem o endereço com link `mailto:`. O usuário confirmou em 14/10/2026 que a caixa existe e recebe mensagens; os testes verificam apenas conteúdo e destino dos links, sem enviar e-mail ou acessar a caixa.

## Executar e validar

Na pasta `frontend`, execute `npm ci`, `npm start` e acesse `http://localhost:4200`. O proxy local encaminha `/api` e `/auth` ao BFF. Cadastro e login navegam para `/auth/register` e `/auth/login`, com credenciais apenas na tela padrão do Keycloak. Não há POST público de senha. Todas as mutações de API usam CSRF; analytics está pausado. A suíte crítica simula API e redirects, e não equivale ao aceite com IdP real.

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run test:seo
npm run build:ssg
npm run validate:ssg
npx playwright install chromium
npm run e2e:critical
```

As jornadas de estante exercitam cadastro JSON e envio RAW de foto com retry no mesmo livro, PNG transparente convertido com fundo branco, legado, percentual inteiro, média por dias com páginas lidas, edição/exclusão de leituras, troca/remoção de capa e falhas com retry. Esses contratos da API permanecem simulados; o Canvas e os arquivos são reais no navegador.

A suíte crítica usa porta 4202 para não competir com o desenvolvimento. Ela percorre a UI de cadastro/login, livros, leitura, edição/exclusão, filtros, paginação, card/foto/download/compartilhamento e erros de rede. **API e redirecionamento BFF são simulados nessa suíte**, assim como Web Share. Canvas, arquivo PNG, formulários e navegação são executados no navegador; não existem endpoints de geração de cards no backend.

O cadastro do primeiro livro entra na estante; o link “Registrar leitura” confirma sua seleção automática na leitura. Outra jornada cria um novo livro enquanto existe outro em andamento, confere ID e título selecionados antes e depois de recarregar a página e registra a primeira sessão nesse livro pela UI. As jornadas não usam `fetch` ou chamadas diretas de API para substituir ações do usuário.

Para a stack local real com BFF, Keycloak e PostgreSQL, use uma conta de teste isolada e sem dados pessoais:

```bash
FOLHEA_E2E_BASE_URL=https://127.0.0.2:9445 \
FOLHEA_E2E_EMAIL=<email-da-conta-de-teste> \
FOLHEA_E2E_PASSWORD=<senha-da-conta-de-teste> \
npm run e2e:integrated
```

Essa suíte não intercepta requisições. Apenas sua configuração opt-in aceita a CA HTTPS de desenvolvimento local (`ignoreHTTPSErrors: true`); o padrão é o estágio isolado `https://127.0.0.2:9445`, com host diferente da stack de uso diário. Trace e screenshots estão desativados nessa configuração para não registrar credenciais. Ela cria um livro próprio com metadados e capa pela UI, confirma persistência da capa após recarregar, ID e título selecionados antes da primeira leitura, registra/edita leitura, confere percentual e média oficiais, baixa card, remove a capa, finaliza/reabre o livro e remove esse livro com suas sessões. Não execute em conta de uso diário. Cadastro público, HTTP 404/redirect, isolamento entre contas e stack operacional são validados também pela integração do monorepo. Ausência de credenciais deixa a suíte integrada explicitamente ignorada, sem considerar integração validada.

## Regras de experiência e dados

- Leituras aceitam páginas, minutos ou ambos; omissão em POST equivale a zero e em PATCH preserva o campo. Null explícito é inválido. Pelo menos um inteiro positivo é obrigatório, com tetos de10.000 páginas e1.440 minutos por registro. Datas e finalização não podem estar no futuro do fuso da conta.
- O novo cadastro exige título; total de páginas é opcional e, quando informado, deve ser inteiro positivo representável pela API. PATCH com null apaga o total existente. Autor (até 500 caracteres), edição (até 200) e capa são opcionais. O livro entra na estante privada, e “Registrar leitura” abre o formulário com seu ID selecionado, inclusive fora dos 100 primeiros livros. Livros antigos mantêm total/edição/capa ausentes e podem completar os metadados no detalhe; ausência de total não se transforma em 0% nem elimina leituras. Livros possuem finalização manual com data, reabertura e exclusão confirmada. Operações em andamento bloqueiam duplicação e mostram retorno de sucesso/erro.
- Páginas lidas, percentual e média por livro usam os campos oficiais top-level `Book.pagesRead`, `progressPercent` e `averagePagesPerReadingDay`, agregados sobre todo o histórico. A UI não soma páginas da listagem nem usa o `stats` legado como fallback. O percentual é inteiro para baixo, limitado a100:2999/3000 mostra99%. A média usa datas distintas com páginas positivas e uma casa decimal; dias somente de minutos não mudam o denominador. Sem tais dias, a média é null e a UI informa ausência de leituras com páginas. Alterar o total não finaliza automaticamente o livro. Criar/editar/excluir leituras atualiza as métricas oficiais; transferir uma sessão atualiza os dois livros. Durante refresh/falha, o progresso antigo fica oculto e um retry busca somente o livro, sem repetir a leitura salva. Respostas anteriores não sobrescrevem metadados ou métricas mais recentes. Estatísticas globais, streak e cards permanecem separados dessas métricas por livro.
- Fotos de livro são privadas e persistentes na conta, inclusive entre dispositivos. A seleção aceita JPEG/PNG/WebP de até 8 MiB, com guarda de dimensões antes da decodificação (máximo 24 milhões de pixels), e prepara localmente JPEG de até **1 MB = 1.000.000 bytes** e lado máximo 1600. A conversão elimina metadados e preenche transparência com branco. A opção câmera usa o suporte nativo do navegador. O novo cadastro salva JSON em `POST /books` e envia a foto selecionada por `PUT /books/{id}/photo` RAW, com CSRF. Se a foto falhar, o livro salvo é preservado: retry reutiliza seu ID sem repetir o POST, e o leitor pode continuar sem foto. Metadados usam PATCH JSON; total null remove o valor. A foto salva usa `hasPhoto` e imagem same-origin autenticada, lazy, com fallback/retry; remoção por `DELETE /books/{id}/photo`. GET fornece ETag e cache privado sujeito a revalidação autenticada, inclusive antes de retornar 304. O servidor normaliza novamente JPEG/PNG/WebP. Esses endpoints não entram no cache do service worker. O contrato multipart `/cover` anterior permanece somente para compatibilidade. A foto de fundo dos cards abaixo continua apenas no dispositivo.
- No detalhe, “Salvar alterações” grava metadados e “Enviar foto” troca a imagem independentemente. Enviar ou tentar novamente a foto preserva alterações de título/autor/edição/total ainda não salvas.
- Estatísticas e streak vêm da API. Paginar histórico não recalcula nem reduz totais. Respostas de filtros e páginas anteriores não substituem a consulta mais recente. Após persistência, dashboard e estatísticas são atualizados. Falha de resumo/estatísticas apresenta erro e nova tentativa, sem inventar total zero ou total com dados parciais. A data do início também segue o fuso da conta. O livro atual é carregado por ID mesmo fora da primeira página.
- O feedback mantém páginas e minutos da leitura salva e mostra o streak global e as métricas semanais após atualizar o resumo. Durante a atualização ou se ela falhar, não apresenta zeros ou totais antigos como confirmados; informa indisponibilidade e permite tentar novamente sem repetir o cadastro da sessão. Fechar o alerta global não elimina o estado de indisponibilidade do resumo nem restaura métricas antigas.
- A Home também mantém o resumo indisponível após falha de atualização, mesmo ao fechar o alerta global e retornar de uma leitura salva, editada ou excluída. O retry busca novamente as métricas sem repetir a mutação já persistida.
- Histórico inclui leituras antigas, com páginas de 100 registros e botão para carregar mais; livros também são paginados. Um título ainda não carregado não é rotulado como livro removido. Edição por link direto usa `GET /sessions/{id}`. Sessões presentes no histórico também carregam seu livro associado por ID, mesmo fora dos 100 primeiros livros; uma falha apresenta retry no editor e mantém os campos. Indicadores dos últimos dias avisam quando falta carregar histórico para confirmar ausência de leitura.
- Configurações permitem selecionar fuso IANA via `PATCH /me`, exportar dados e excluir conta. Após `DELETE /me` concluir com 204, identidade e sessão já estão revogadas: a aplicação limpa a memória e o token CSRF e retorna à Home pública. A ação normal “Sair da conta” continua passando por `/auth/logout` para encerrar o login OIDC. Se a exclusão falhar com 503, o diálogo apresenta erro, mantém a sessão e permite tentar novamente.
- Cards Minimal, Foto e Dark são gerados localmente em PNG 1080 × 1920. Período/título e quatro métricas acompanham o filtro. Foto JPEG/PNG/WebP até 8 MiB permanece no dispositivo. Enquadramento e overlay atualizam prévia/exportação; alterações invalidam a imagem anterior. Texto claro sobre overlay escuro de 65% a 85% preserva contraste mesmo sobre uma foto branca. Sem suporte a compartilhar arquivos, o fluxo salva PNG. Cancelar o compartilhamento não conta como envio.
- Não há persistência de domínio offline nem sincronização. Erros mantêm campos para nova tentativa e o shell sinaliza falta de conexão. O service worker guarda somente assets e exclui `/api`, `/auth` e `/realms` do fallback de navegação. A atualização da PWA é oferecida na aplicação. Os listeners de conexão são removidos ao destruir o serviço.

Campos possuem rótulos associados por `for`/`id`, separados das dicas e opções; isso mantém o nome acessível estável para teclado, leitores de tela e testes.
Os números das etapas na home usam verde sobre fundos claros e âmbar sobre o fundo verde, preservando contraste de texto normal de pelo menos 4,5:1.
Botões de exclusão usam texto `#7e3030` sobre `#fbe9e3`, como os alertas de erro, com contraste aproximado de 7,59:1 para texto normal.
O foco por teclado usa anel verde com faixa clara, para ser distinguível em superfícies claras e escuras. Sobre o fundo creme principal, o anel tem contraste de 7,67:1, acima dos 3:1 exigidos para o indicador de estado pela [WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

## SEO, PWA e dependências

`shared/public-contract.json`, na raiz do monorepo, é a fonte única da origem pública e dos IDs relativos `/problems/...`. O gerador `node scripts/ci/generate-public-contract.mjs` mantém Java e `src/app/core/api/problem-types.generated.ts` sincronizados; `--check` apenas verifica, sem gravar. O frontend usa `PUBLIC_SITE_ORIGIN` no `SeoService` e `PROBLEM_TYPES` nos comparadores de reautenticação e exclusão. A comparação é exata, sem aliases de hosts anteriores ou busca de configuração em runtime. Erros de validação e falhas não confirmadas preservam o fluxo de retry e a sessão.

Os templates em `scripts/seo/` geram `src/index.html`, `public/robots.txt` e `public/sitemap.xml` com a mesma origem do catálogo. `npm start`, `npm run build` e `npm run build:ssg` fazem essa geração antes do Angular. Os três outputs ficam versionados; edite os templates ou o contrato, regenere e inclua os resultados no commit. `npm run check:seo` detecta drift sem modificar arquivos, e `npm run validate:ssg` também exige essa sincronização. API, manifesto e assets da PWA mantêm caminhos relativos. Os validadores da raiz e do frontend leem o mesmo catálogo, sem precisar de um override de ambiente para validar o domínio do produto.

`validate:ssg` verifica HTML inicial, conteúdo, metadados únicos, canonical, robots, sitemap, PNG social 1200 × 630, ícones PNG 192/512 e manifesto standalone. O shell indicado por `ngsw.json.index` deve constar no `hashTable` e nos assets `prefetch`; no build SSG, o Angular usa `/index.csr.html`, incluído explicitamente no cache para permitir a navegação offline. Isso não armazena dados da API nem permite registrar leituras sem conexão. CSS crítico inline é desativado para compatibilidade com CSP `script-src 'self'`; o stylesheet não depende de handler inline. HTTP 404/301/308 e desempenho real exigem o proxy completo.

Dependências diretas foram conferidas em metadados estáveis do [registry oficial npm](https://registry.npmjs.org/@angular%2fcore) em 11/10/2026: Angular/CLI 22.2.2, TypeScript 6.0.3 (faixa suportada pelo compiler-cli), Playwright 1.64.0 e Vitest 5.0.3. Versões estão fixadas no `package.json` e `package-lock.json`. Os engines oficiais de Angular/core/CLI/build são `^22.22.3 || ^24.15.0 || >=26.0.0`; o builder aceita TypeScript `>=6.0 <6.1`. O Node 26 usado nos checks atende a essa faixa.

Na conferência de12/10/2026 para SESSAO-01, Angular22.2.2, Node26.11.1,
Vitest5.0.3 e Playwright1.64.0 continuam atuais. TypeScript7.0.2 é a versão
mais recente do registry, mas está fora da faixa oficial de Angular22.2.2;
mantemos6.0.3, estável e compatível, sem forçar o peer dependency.

Conferência de 15/10/2026 no [registry oficial npm](https://registry.npmjs.org/@angular%2fcore/latest): runtime Angular e compiler/compiler-cli **22.2.3**; CLI, builder e SSR **22.2.2**; Vitest e coverage-v8 **5.0.4**, PostCSS **8.5.30** e typescript-eslint **8.71.2**. O grupo Angular usa os peers exatos do mesmo patch, e CLI/build/SSR aceitam esse grupo. TypeScript permanece **6.0.3**, dentro de `>=6.0 <6.1`; a versão geral 7.0.2 continua incompatível com esses peers. Node **26.12.0** atende aos engines oficiais e é usado pela toolchain privada, sem mudar o PATH global. Os patches são fixados no package/lock sem `--force` ou `--legacy-peer-deps`.

O build/servidor de desenvolvimento usa `@angular/build` 22.2.2 com esbuild/Vite, seguindo a [migração oficial do Angular](https://angular.dev/tools/cli/build-system-migration). O pacote legado `@angular-devkit/build-angular` não é necessário neste projeto e sua árvore Webpack foi removida. Isso elimina a cadeia de seis alertas `high` de desenvolvimento relacionada ao [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), sem downgrade ou override de pacote vulnerável. Audite a árvore completa com `npm audit` e a classificação de dependências de produção com `npm audit --omit=dev`; mantenha o lockfile ao integrar. O runtime publicado é estático no Caddy, mas o audit inclui também ferramentas de desenvolvimento.

### AUTH-01

Cadastro e login navegam para `/auth/register` e `/auth/login`; não há formulário de senha ou POST de cadastro no Angular. Os CTAs públicos usam redirect completo para o BFF. Analytics está pausado e não transmite eventos. O CSRF é lido de `__Host-folhea_csrf` por mutação; GET `/csrf` emite o cookie quando necessário, sem ler cookies HttpOnly ou guardar tokens de acesso/refresh. Um 401 privado encerra o espelho local e leva à entrada. A exceção `recent-authentication-required` preserva a sessão e oferece reautenticação (`prompt=login`), exigindo nova confirmação da exclusão. `account-deletion-pending` informa conclusão durável automática, sem oferecer novo DELETE ou prometer preservação da conta. Testes Angular/Playwright com API simulada não comprovam um login real no IdP.
