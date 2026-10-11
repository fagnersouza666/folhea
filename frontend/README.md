# Frontend Folhea v1

Aplicação Angular 22: páginas públicas SSG e área privada CSR, com navegação web normal e instalação PWA opcional. O build de produção é estático; não requer Node como servidor. A versão do produto é controlada pela integração do monorepo.

## Executar e validar

Na pasta `frontend`, execute `npm ci`, `npm start` e acesse `http://localhost:4200`. O proxy local encaminha `/api` e `/auth` ao BFF. O cadastro usa `POST /api/v1/registration`; entrar redireciona ao Keycloak pelo BFF. Google e recuperação de senha são opções do IdP quando configuradas.

O cadastro anônimo envia o POST público diretamente, sem buscar `/csrf`, que exige autenticação. O interceptor limita essa exceção ao método POST nos caminhos exatos `/api/v1/registration` e nos aliases de compatibilidade `/api/v1/auth/register` e `/api/v1/register`. As mutações de livros, sessões, conta e analytics continuam exigindo token CSRF. A regressão de cadastro da suíte crítica simula `/me` e `/csrf` com 401 antes do login para não mascarar esse contrato público.

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run build:ssg
npm run validate:ssg
npx playwright install chromium
npm run e2e:critical
```

A suíte crítica usa porta 4202 para não competir com o desenvolvimento. Ela percorre a UI de cadastro/login, livros, leitura, edição/exclusão, filtros, paginação, card/foto/download/compartilhamento e erros de rede. **API e redirecionamento BFF são simulados nessa suíte**, assim como Web Share. Canvas, arquivo PNG, formulários e navegação são executados no navegador; não existem endpoints de geração de cards no backend.

O cadastro do primeiro livro confirma sua seleção automática na leitura. Outra jornada cria um novo livro enquanto existe outro em andamento, confere ID e título selecionados antes e depois de recarregar a página e registra a primeira sessão nesse livro pela UI. As jornadas não usam `fetch` ou chamadas diretas de API para substituir ações do usuário.

Para a stack local real com BFF, Keycloak e PostgreSQL, use uma conta de teste isolada e sem dados pessoais:

```bash
FOLHEA_E2E_BASE_URL=https://localhost:9443 \
FOLHEA_E2E_EMAIL=<email-da-conta-de-teste> \
FOLHEA_E2E_PASSWORD=<senha-da-conta-de-teste> \
npm run e2e:integrated
```

Essa suíte não intercepta requisições. Apenas sua configuração opt-in aceita a CA HTTPS de desenvolvimento local (`ignoreHTTPSErrors: true`); o padrão é `https://localhost:9443`. Ela cria um livro próprio pela UI, confirma ID e título selecionados antes da primeira leitura, registra/edita leitura, baixa card, finaliza/reabre o livro e remove esse livro com suas sessões. Não execute em conta de uso diário. Cadastro público, HTTP 404/redirect, isolamento entre contas e stack operacional são validados também pela integração do monorepo. Ausência de credenciais deixa a suíte integrada explicitamente ignorada, sem considerar integração validada.

## Regras de experiência e dados

- Leituras aceitam páginas, minutos ou ambos; omissão equivale a zero. Pelo menos um inteiro positivo é obrigatório. Datas e finalização não podem estar no futuro do fuso da conta.
- O livro em andamento ou recém-cadastrado fica selecionado para acelerar o próximo registro. Livros possuem edição, finalização com data, reabertura e exclusão confirmada. Operações em andamento bloqueiam duplicação e mostram retorno de sucesso/erro.
- Estatísticas e streak vêm da API. Paginar histórico não recalcula nem reduz totais. Respostas de filtros e páginas anteriores não substituem a consulta mais recente. Após persistência, dashboard e estatísticas são atualizados. Falha de resumo/estatísticas apresenta erro e nova tentativa, sem inventar total zero ou total com dados parciais. A data do início também segue o fuso da conta. O livro atual é carregado por ID mesmo fora da primeira página.
- O feedback mantém páginas e minutos da leitura salva e mostra o streak global e as métricas semanais após atualizar o resumo. Durante a atualização ou se ela falhar, não apresenta zeros ou totais antigos como confirmados; informa indisponibilidade e permite tentar novamente sem repetir o cadastro da sessão. Fechar o alerta global não elimina o estado de indisponibilidade do resumo nem restaura métricas antigas.
- A Home também mantém o resumo indisponível após falha de atualização, mesmo ao fechar o alerta global e retornar de uma leitura salva, editada ou excluída. O retry busca novamente as métricas sem repetir a mutação já persistida.
- Histórico inclui leituras antigas, com páginas de 100 registros e botão para carregar mais; livros também são paginados. Um título ainda não carregado não é rotulado como livro removido. Edição por link direto usa `GET /sessions/{id}`. Sessões presentes no histórico também carregam seu livro associado por ID, mesmo fora dos 100 primeiros livros; uma falha apresenta retry no editor e mantém os campos. Indicadores dos últimos dias avisam quando falta carregar histórico para confirmar ausência de leitura.
- Configurações permitem selecionar fuso IANA via `PATCH /me`, exportar dados e excluir conta. Após `DELETE /me` concluir com 204, identidade e sessão já estão revogadas: a aplicação limpa a memória e o token CSRF e retorna à Home pública. A ação normal “Sair da conta” continua passando por `/auth/logout` para encerrar o login OIDC. Se a exclusão falhar com 503, o diálogo apresenta erro, mantém a sessão e permite tentar novamente.
- Cards Minimal, Foto e Dark são gerados localmente em PNG 1080 × 1920. Período/título e quatro métricas acompanham o filtro. Foto JPEG/PNG/WebP até 8 MiB permanece no dispositivo. Enquadramento e overlay atualizam prévia/exportação; alterações invalidam a imagem anterior. Texto claro sobre overlay escuro de 65% a 85% preserva contraste mesmo sobre uma foto branca. Sem suporte a compartilhar arquivos, o fluxo salva PNG. Cancelar o compartilhamento não conta como envio.
- Não há persistência de domínio offline nem sincronização. Erros mantêm campos para nova tentativa e o shell sinaliza falta de conexão. O service worker guarda somente assets e exclui `/api`, `/auth` e `/realms` do fallback de navegação. A atualização da PWA é oferecida na aplicação. Os listeners de conexão são removidos ao destruir o serviço.

Campos possuem rótulos associados por `for`/`id`, separados das dicas e opções; isso mantém o nome acessível estável para teclado, leitores de tela e testes.
Os números das etapas na home usam verde sobre fundos claros e âmbar sobre o fundo verde, preservando contraste de texto normal de pelo menos 4,5:1.
O foco por teclado usa anel verde com faixa clara, para ser distinguível em superfícies claras e escuras. Sobre o fundo creme principal, o anel tem contraste de 7,67:1, acima dos 3:1 exigidos para o indicador de estado pela [WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

## SEO, PWA e dependências

`validate:ssg` verifica HTML inicial, conteúdo, metadados únicos, canonical, robots, sitemap, PNG social 1200 × 630, ícones PNG 192/512 e manifesto standalone. O shell indicado por `ngsw.json.index` deve constar no `hashTable` e nos assets `prefetch`; no build SSG, o Angular usa `/index.csr.html`, incluído explicitamente no cache para permitir a navegação offline. Isso não armazena dados da API nem permite registrar leituras sem conexão. CSS crítico inline é desativado para compatibilidade com CSP `script-src 'self'`; o stylesheet não depende de handler inline. HTTP 404/301/308 e desempenho real exigem o proxy completo.

Dependências diretas foram conferidas em metadados estáveis do [registry oficial npm](https://registry.npmjs.org/@angular%2fcore) em 11/10/2026: Angular/CLI 22.2.2, TypeScript 6.0.3 (faixa suportada pelo compiler-cli), Playwright 1.64.0 e Vitest 5.0.3. Versões estão fixadas no `package.json` e `package-lock.json`. Os engines oficiais de Angular/core/CLI/build são `^22.22.3 || ^24.15.0 || >=26.0.0`; o builder aceita TypeScript `>=6.0 <6.1`. O Node 26 usado nos checks atende a essa faixa.

O build/servidor de desenvolvimento usa `@angular/build` 22.2.2 com esbuild/Vite, seguindo a [migração oficial do Angular](https://angular.dev/tools/cli/build-system-migration). O pacote legado `@angular-devkit/build-angular` não é necessário neste projeto e sua árvore Webpack foi removida. Isso elimina a cadeia de seis alertas `high` de desenvolvimento relacionada ao [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), sem downgrade ou override de pacote vulnerável. Audite a árvore completa com `npm audit` e a classificação de dependências de produção com `npm audit --omit=dev`; mantenha o lockfile ao integrar. O runtime publicado é estático no Caddy, mas o audit inclui também ferramentas de desenvolvimento.
