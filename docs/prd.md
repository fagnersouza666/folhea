# PRD-01 | Folhea v1

Status: proposta consolidada  
Produto: **Folhea**  
Tagline provisória: **Cada página conta.**  
Data: 2026-09-05

# 1. Visão do produto

O **Folhea** ajuda pessoas que leem livros físicos a registrar rapidamente suas sessões de leitura, acompanhar a evolução do hábito e transformar esse progresso em cards visuais compartilháveis.

A experiência central do produto é:

```text
Ler
↓
Registrar leitura
↓
Ver progresso
↓
Continuar o hábito
↓
Compartilhar, se quiser
```

O Folhea não é inicialmente:

* rede social;
* catálogo de livros;
* leitor digital;
* loja;
* plataforma de reviews.

O núcleo do produto é:

> transformar leitura física em progresso visível.

# 2. Posicionamento

O Folhea deve ocupar o espaço entre um rastreador de hábitos e um aplicativo de leitura.

O produto não deve competir inicialmente pela quantidade de livros cadastrados ou informações bibliográficas.

Seu diferencial deve estar em:

* registro rápido;
* acompanhamento do hábito;
* streak;
* métricas simples;
* recompensa visual;
* cards compartilháveis.

# 3. Público inicial

Pessoas que:

* leem livros físicos;
* desejam acompanhar o próprio hábito;
* querem visualizar evolução;
* gostam de metas e números;
* eventualmente compartilham leituras;
* atualmente usam memória, caderno, notas, planilhas ou aplicativos genéricos.

O compartilhamento não é obrigatório para que o produto gere valor.

# 4. Problema

Quem lê livros físicos frequentemente perde a percepção quantitativa do hábito.

Sem algum controle, é difícil responder:

* quantos dias seguidos estou lendo?
* quanto li hoje?
* quantas páginas li esta semana?
* quanto tempo passei lendo?
* quantos livros terminei?
* estou lendo mais ou menos que antes?

O Folhea resolve isso permitindo registrar a sessão em poucos segundos e apresentando imediatamente o progresso acumulado.

# 5. Hipóteses do MVP

## H1. Registro

Usuários estão dispostos a registrar sessões de leitura regularmente.

## H2. Progresso

Visualizar streak, páginas e tempo aumenta a percepção de progresso.

## H3. Retenção

A percepção de progresso incentiva o usuário a voltar e registrar novas leituras.

## H4. Compartilhamento

Uma parcela dos usuários considera os cards suficientemente interessantes para gerar e compartilhar.

# 6. Plataformas

O Folhea será uma aplicação web responsiva.

O mesmo frontend atenderá:

* desktop;
* notebook;
* tablet;
* smartphone;
* PWA instalada.

Não haverá aplicativo Flutter, Android nativo ou iOS nativo no v1.

A experiência mobile será fornecida pela PWA.

# 7. Arquitetura de frontend

Será mantido um único projeto frontend.

Tecnologia:

```text
Angular 22
TypeScript
Angular Signals
Angular Router
Angular Reactive Forms
Angular HttpClient
Tailwind CSS 4
Angular PWA
```

Usar sempre a versão de manutenção mais recente disponível dentro da major adotada.

# 8. Estratégia de rendering

O Folhea utilizará rendering híbrido.

Existirão duas áreas arquiteturalmente distintas:

```text
ÁREA PÚBLICA
↓
SSG / prerender

ÁREA AUTENTICADA
↓
CSR / PWA
```

## 8.1 Área pública

Exemplos:

```text
/
/como-funciona
/recursos
/sobre
/privacidade
/termos
/blog/*
```

Essas páginas devem ser geradas previamente durante o build.

Estratégia:

```text
Angular SSG
```

Objetivos:

* SEO;
* carregamento rápido;
* HTML disponível imediatamente;
* boa indexação;
* compartilhamento social;
* melhor experiência inicial.

## 8.2 Área autenticada

Exemplo:

```text
/app
/app/inicio
/app/livros
/app/livros/{id}
/app/progresso
/app/cards
/app/configuracoes
```

Estratégia:

```text
Angular CSR
```

A área autenticada não precisa de indexação.

# 9. Node.js em produção

Node.js será utilizado para:

* desenvolvimento;
* build Angular;
* testes;
* geração SSG.

Node.js não será necessário no runtime da aplicação em produção.

Após o build, páginas públicas prerenderizadas e assets Angular serão arquivos estáticos servidos pelo Caddy.

Não haverá servidor Angular SSR permanente no v1.

# 10. SEO

SEO técnico é requisito obrigatório do Folhea v1.

Conteúdo editorial em escala não é requisito do MVP.

A arquitetura deve estar preparada para crescimento orgânico posterior.

# 11. Estratégia de SEO

A aquisição orgânica poderá futuramente seguir:

```text
Pesquisa
↓
Conteúdo público Folhea
↓
Landing page
↓
Experimentar produto
↓
Criar conta
↓
Registrar primeira leitura
↓
Instalar PWA
```

Exemplos de conteúdos futuros:

```text
/blog/como-criar-habito-de-leitura
/blog/como-ler-mais
/blog/quantas-paginas-ler-por-dia
/blog/como-acompanhar-leitura
/blog/beneficios-da-leitura-diaria
```

O blog não precisa existir no lançamento, mas a arquitetura de URLs deve permitir sua inclusão.

# 12. Requisitos técnicos de SEO

Toda página pública indexável deverá possuir:

* `<title>` exclusivo;
* meta description exclusiva;
* URL canônica;
* heading `h1` coerente;
* hierarquia semântica de headings;
* HTML semântico;
* texto indexável;
* `lang="pt-BR"`;
* atributos `alt` adequados em imagens relevantes;
* metadados Open Graph;
* metadados sociais equivalentes quando aplicável.

# 13. Canonical

Cada página pública deverá informar explicitamente sua canonical URL.

Exemplo:

```html
<link
  rel="canonical"
  href="https://folhea.com.br/como-funciona"
/>
```

URLs com parâmetros de tracking não devem gerar conteúdo duplicado indexável.

# 14. Sitemap

O build deverá gerar:

```text
/sitemap.xml
```

O sitemap incluirá apenas páginas públicas indexáveis.

Não incluir:

```text
/app/*
login
callback OIDC
URLs privadas
URLs temporárias
```

# 15. Robots

Disponibilizar:

```text
/robots.txt
```

As rotas privadas não devem ser tratadas apenas por `robots.txt`.

A área `/app/**` também deverá utilizar:

```html
<meta name="robots" content="noindex,nofollow">
```

quando tecnicamente aplicável.

Segurança nunca deve depender de SEO ou regras de crawler.

# 16. Structured Data

Utilizar JSON-LD quando houver benefício claro.

Tipos possíveis:

```text
Organization
SoftwareApplication
WebSite
Article
BreadcrumbList
```

Não adicionar schema.org apenas para aumentar quantidade de marcação.

Os dados estruturados devem representar conteúdo realmente existente na página.

# 17. Open Graph

Páginas públicas relevantes deverão fornecer pelo menos:

```text
og:title
og:description
og:url
og:type
og:image
```

Objetivo:

* WhatsApp;
* Telegram;
* Facebook;
* LinkedIn;
* outros sistemas de preview.

A imagem principal de compartilhamento deverá possuir dimensão apropriada para social preview.

# 18. URLs

URLs públicas devem ser:

* simples;
* legíveis;
* estáveis;
* sem IDs desnecessários;
* sem hash routing.

Exemplo bom:

```text
/como-funciona
```

Evitar:

```text
/#/page?id=12
```

# 19. Performance web

SEO e UX compartilham requisitos de desempenho.

Objetivos:

```text
LCP <= 2,5 s
INP <= 200 ms
CLS <= 0,1
```

Esses números são metas de qualidade, não SLA contratual.

O produto deverá priorizar:

* bundle inicial reduzido;
* lazy loading;
* code splitting;
* imagens otimizadas;
* fontes otimizadas;
* compressão;
* cache;
* ausência de JavaScript desnecessário.

# 20. Imagens públicas

Preferir:

```text
AVIF
WebP
```

com fallback quando necessário.

Utilizar:

* dimensões explícitas;
* lazy loading quando apropriado;
* `srcset`;
* tamanhos adequados à tela.

Não utilizar imagens muito maiores do que sua área de renderização.

# 21. Acessibilidade

SEO não substitui acessibilidade.

A aplicação deve considerar:

* HTML semântico;
* navegação por teclado;
* foco visível;
* labels associados a campos;
* contraste;
* `aria-*` quando realmente necessário;
* tamanhos de toque adequados no mobile.

Meta inicial:

```text
WCAG 2.2 nível AA
```

sempre que razoavelmente possível.

# 22. Home pública

A rota:

```text
/
```

será uma landing page pública.

Objetivo:

> explicar rapidamente o que é o Folhea e levar o visitante a experimentar o produto.

Estrutura conceitual:

```text
Folhea
Cada página conta.

Acompanhe seu hábito de leitura.
Registre páginas e tempo.
Veja sua evolução.
Compartilhe suas conquistas.

[ Começar agora ]

Como funciona
Benefícios
Exemplo de card
FAQ
CTA final
```

# 23. Primeiro uso

Fluxo esperado:

```text
Landing page
↓
Começar agora
↓
Autenticação
↓
Cadastrar primeiro livro
↓
Registrar primeira leitura
↓
Ver resultado
```

Evitar onboarding longo.

# 24. Home autenticada

A Home do aplicativo não deve parecer um painel CRUD.

Exemplo:

```text
Olá

17 dias seguidos

Continue lendo

O Hobbit

[ Registrar leitura ]

Esta semana

134 páginas
2h 18min
1 livro finalizado

[ Ver progresso ]
[ Criar card ]
```

Objetivo principal:

> levar o usuário ao próximo registro de leitura.

# 25. Navegação

Mobile:

```text
Início
Livros
Progresso
```

A ação:

```text
Registrar leitura
```

deve possuir maior destaque visual.

Desktop poderá usar navegação lateral ou superior.

A arquitetura de rotas deve ser a mesma.

# 26. Registro de leitura

Campos:

```text
Livro
Data
Páginas
Minutos
```

Páginas ou minutos podem ser omitidos individualmente.

Pelo menos um deve ser maior que zero.

Exemplo:

```text
Registrar leitura

Livro
O Hobbit

Páginas
32

Tempo
25 minutos

Data
Hoje

[ Registrar ]
```

Meta de UX:

> usuário recorrente deve conseguir registrar uma leitura em menos de 10 segundos.

# 27. Feedback após leitura

Após registrar:

```text
Leitura registrada

32 páginas
25 minutos

12 dias seguidos

Esta semana

143 páginas
2h 10min

[ Criar card ]
[ Concluir ]
```

O feedback imediato faz parte da recompensa comportamental.

# 28. Livros

Campos:

```text
id
userId
title
author
status
finishedOn
createdAt
updatedAt
```

Título:

```text
obrigatório
```

Autor:

```text
opcional
```

Estados:

```text
READING
FINISHED
```

# 29. Operações de livro

O usuário poderá:

* cadastrar;
* visualizar;
* editar;
* finalizar;
* reabrir;
* excluir.

Finalização deve ser reversível.

# 30. Sessão de leitura

Modelo:

```text
id
userId
bookId
readingDate
pages
minutes
createdAt
updatedAt
```

`readingDate` será:

```text
DATE / LocalDate
```

Exemplo:

```text
2026-09-05
```

Não utilizar timestamp para representar o dia da leitura.

# 31. Validações

Uma sessão deve satisfazer:

```text
pages > 0
OR
minutes > 0
```

Também:

```text
pages >= 0
minutes >= 0
```

A regra deve existir:

* na API;
* na camada de domínio;
* através de constraint no PostgreSQL.

# 32. Alteração de sessão

Usuário poderá:

* criar;
* editar;
* excluir.

Qualquer alteração deve repercutir imediatamente nas métricas.

# 33. Streak

Um dia conta como leitura quando existe pelo menos uma sessão com:

```text
pages > 0
```

ou:

```text
minutes > 0
```

## Regra

Se houve leitura hoje:

```text
contar a partir de hoje e retroceder
enquanto houver leitura consecutiva.
```

Se ainda não houve leitura hoje e houve ontem:

```text
contar a partir de ontem.
```

Se não houve leitura hoje nem ontem:

```text
streak = 0
```

Exemplo:

```text
segunda  leitura
terça   leitura
quarta  hoje, ainda sem leitura

streak = 2
```

# 34. Streak e filtros

O streak representa a sequência atual.

Portanto, não é limitado pelo filtro de estatísticas.

Exemplo:

```text
Streak atual: 42 dias
Filtro: 7 dias

Resultado:
42 dias seguidos
```

# 35. Períodos

Filtros:

```text
Hoje
7 dias
30 dias
Todo o período
```

Hoje:

```text
readingDate = hoje
```

7 dias:

```text
hoje - 6 dias
até
hoje
```

30 dias:

```text
hoje - 29 dias
até
hoje
```

Todo o período:

```text
desde a primeira sessão
```

# 36. Métricas

Exibir:

```text
streak atual
páginas
tempo
livros finalizados
```

Páginas:

```text
SUM(readingSession.pages)
```

Tempo:

```text
SUM(readingSession.minutes)
```

Livros:

```text
finishedOn dentro do período
```

# 37. Tela de progresso

Exemplo:

```text
Seu progresso

[ Hoje ] [ 7 dias ] [ 30 dias ] [ Tudo ]

17
dias seguidos

214
páginas

5h 42min
de leitura

1
livro finalizado

[ Criar card ]
```

# 38. Card compartilhável

O card é uma funcionalidade central do Folhea.

Formato principal:

```text
1080 x 1920
9:16
```

Conteúdo:

* período;
* streak;
* páginas;
* tempo;
* livros finalizados;
* marca Folhea.

Exemplo:

```text
FOLHEA

Minha semana de leitura

17 dias seguidos
214 páginas
5h42 de leitura
1 livro concluído

Cada página conta.
```

# 39. Templates de card

O v1 deverá oferecer no mínimo:

```text
Minimal
Foto
Dark
```

Não haverá editor gráfico completo.

# 40. Foto de fundo

Usuário poderá escolher foto existente no dispositivo.

Permitir:

* enquadramento;
* crop;
* reposicionamento;
* overlay;
* contraste adequado.

A foto não será enviada ao backend.

# 41. Geração do card

Card será gerado integralmente no browser.

Tecnologia:

```text
HTML Canvas API
```

Saída:

```text
PNG
1080 x 1920
Blob
```

Nenhum backend de geração de imagem será necessário.

# 42. Compartilhamento

Quando suportado:

```text
Web Share API
```

Quando indisponível:

```text
Download da imagem
```

Fluxo:

```text
Web Share disponível
↓
Compartilhar

Web Share indisponível
↓
Salvar imagem
```

# 43. PWA

Utilizar:

```text
@angular/pwa
```

A aplicação deverá possuir:

```text
manifest.webmanifest
service worker
ícones
theme_color
background_color
start_url
display: standalone
```

# 44. Escopo offline

Folhea v1 não será offline-first.

O service worker poderá armazenar:

* shell da aplicação;
* JavaScript;
* CSS;
* fontes;
* ícones;
* assets estáticos.

Não deverá existir sincronização automática de dados de negócio no v1.

Sem conexão:

```text
Você está sem conexão.
Conecte-se para registrar sua leitura.
```

# 45. Cache de dados privados

Dados autenticados não deverão ser armazenados indiscriminadamente pelo service worker.

Não utilizar cache público para endpoints:

```text
/api/*
```

que retornem informações privadas.

# 46. Atualização da PWA

Quando nova versão estiver disponível:

```text
Uma nova versão do Folhea está disponível.

[ Atualizar ]
```

O fluxo deve evitar deixar o usuário indefinidamente em versão antiga do frontend.

# 47. Navegadores

Suporte alvo:

```text
Chrome
Edge
Firefox
Safari
Samsung Internet
```

nas versões modernas suportadas pelos próprios fornecedores.

Recursos específicos de PWA e Web Share poderão variar.

Sempre deve existir fallback web.

# 48. Backend

Backend obrigatório:

```text
Java 25 LTS
Quarkus 3.33 LTS
Maven
```

Usar a versão de manutenção mais recente da linha Quarkus 3.33.

Execução inicial:

```text
JVM mode
```

Não utilizar Native Image no v1.

# 49. Extensões Quarkus

Baseline:

```text
quarkus-rest-jackson
quarkus-hibernate-orm-panache
quarkus-jdbc-postgresql
quarkus-flyway
quarkus-hibernate-validator
quarkus-oidc
quarkus-smallrye-openapi
quarkus-smallrye-health
```

Observabilidade:

```text
quarkus-opentelemetry
quarkus-micrometer
```

conforme infraestrutura disponível.

# 50. Arquitetura backend

O backend será:

> monólito modular.

Não utilizar microserviços.

Módulos conceituais:

```text
identity
user
book
reading
statistics
analytics
```

# 51. Organização Java

Estrutura sugerida:

```text
com.folhea

  identity/

  user/

  book/
    domain/
    application/
    infrastructure/
    api/

  reading/
    domain/
    application/
    infrastructure/
    api/

  statistics/
    domain/
    application/
    infrastructure/
    api/

  shared/
```

A separação deve proteger as regras de negócio sem criar abstrações artificiais.

# 52. Banco de dados

Banco obrigatório:

```text
PostgreSQL 18
```

Usar sempre a última minor estável da major adotada.

ORM:

```text
Hibernate ORM
Panache Repository
```

Preferir Repository Pattern.

Não utilizar Active Record nas entidades.

# 53. Migração de schema

Utilizar:

```text
Flyway
```

Exemplo:

```text
V001__initial_schema.sql
V002__reading_session_indexes.sql
V003__book_finished_on.sql
```

Hibernate não poderá alterar automaticamente o schema em produção.

# 54. Identificadores

Entidades principais utilizarão:

```text
UUID
```

Não expor identificadores sequenciais públicos.

# 55. User

```text
User

id UUID
identitySubject VARCHAR
email VARCHAR
timezone VARCHAR
createdAt TIMESTAMPTZ
updatedAt TIMESTAMPTZ
```

O Folhea não armazenará senha do usuário quando a autenticação estiver delegada ao provedor de identidade.

# 56. Book

```text
Book

id UUID
userId UUID
title VARCHAR
author VARCHAR
status VARCHAR
finishedOn DATE
createdAt TIMESTAMPTZ
updatedAt TIMESTAMPTZ
```

# 57. ReadingSession

```text
ReadingSession

id UUID
userId UUID
bookId UUID
readingDate DATE
pages INTEGER
minutes INTEGER
createdAt TIMESTAMPTZ
updatedAt TIMESTAMPTZ
```

Constraints mínimas:

```text
pages >= 0
minutes >= 0

pages > 0
OR
minutes > 0
```

# 58. Índices

Criar inicialmente:

```text
reading_session(user_id, reading_date)

reading_session(book_id, reading_date)

book(user_id, status)

book(user_id, finished_on)
```

Índices adicionais devem ser definidos por uso real e `EXPLAIN ANALYZE`, não por antecipação.

# 59. Timezone

Cada usuário possui timezone.

Exemplo:

```text
America/Sao_Paulo
```

Campos associados a dias:

```text
readingDate
finishedOn
```

serão:

```text
DATE
```

Eventos:

```text
createdAt
updatedAt
```

serão:

```text
TIMESTAMPTZ
```

armazenados em UTC.

# 60. API

Padrão:

```text
REST
JSON
HTTPS
```

Base:

```text
/api/v1
```

# 61. OpenAPI

O contrato HTTP deverá ser publicado através de:

```text
SmallRye OpenAPI
```

OpenAPI será a fonte formal do contrato frontend/backend.

Deve ser possível gerar cliente TypeScript futuramente a partir desse contrato.

# 62. API de usuário

```http
GET /api/v1/me
GET /api/v1/me/export
DELETE /api/v1/me
```

Resposta conceitual de `/me`:

```json
{
  "id": "uuid",
  "email": "usuario@email.com",
  "timezone": "America/Sao_Paulo"
}
```

Exportação (`GET /api/v1/me/export`):

```json
{
  "user": { "id": "uuid", "email": "usuario@email.com", "timezone": "America/Sao_Paulo", "createdAt": "...", "updatedAt": "..." },
  "books": [],
  "sessions": []
}
```

Exclusão de conta (`DELETE /api/v1/me` com corpo `{"confirm": true}`): remove o usuário e registros associados (cascade), revoga CSRF/token state, limpa cookie e encerra sessão OIDC.

# 63. API de livros

```http
GET    /api/v1/books
POST   /api/v1/books
GET    /api/v1/books/{id}
PATCH  /api/v1/books/{id}
DELETE /api/v1/books/{id}
```

Finalizar:

```http
POST /api/v1/books/{id}/finish
```

Body:

```json
{
  "finishedOn": "2026-09-05"
}
```

A operação deve ser idempotente.

Reabrir:

```http
DELETE /api/v1/books/{id}/finish
```

# 64. API de sessões

```http
GET    /api/v1/sessions
POST   /api/v1/sessions
PATCH  /api/v1/sessions/{id}
DELETE /api/v1/sessions/{id}
```

Exemplo:

```json
{
  "bookId": "uuid",
  "readingDate": "2026-09-05",
  "pages": 32,
  "minutes": 25
}
```

# 65. API de estatísticas

```http
GET /api/v1/stats
```

Com período:

```http
GET /api/v1/stats?from=2026-08-30&to=2026-09-05
```

Resposta:

```json
{
  "period": {
    "from": "2026-08-30",
    "to": "2026-09-05"
  },
  "currentStreakDays": 17,
  "minutes": 382,
  "pages": 214,
  "booksFinished": 1
}
```

# 66. API da Home

Para reduzir chamadas no carregamento inicial:

```http
GET /api/v1/dashboard
```

Resposta conceitual:

```json
{
  "currentStreakDays": 17,
  "currentBook": {
    "id": "uuid",
    "title": "O Hobbit"
  },
  "week": {
    "pages": 134,
    "minutes": 138,
    "booksFinished": 1
  }
}
```

# 67. Erros da API

Utilizar:

```text
application/problem+json
```

Exemplo:

```json
{
  "type": "https://folhea.com.br/problems/invalid-reading-session",
  "title": "Sessão de leitura inválida",
  "status": 400,
  "detail": "Informe páginas, minutos ou ambos."
}
```

# 68. Autenticação

Autenticação não será implementada diretamente pelo Folhea.

Utilizar:

```text
Keycloak
OpenID Connect
OAuth 2
```

Métodos:

```text
Google
e-mail + senha
```

As credenciais pertencem ao provedor de identidade.

# 69. Padrão de autenticação web

Preferir arquitetura BFF.

Fluxo:

```text
Angular
↓
Quarkus
↓
OIDC
↓
Keycloak
```

O JavaScript do frontend não deverá manipular refresh token quando isso puder ser evitado.

Sessão web deverá utilizar cookies:

```text
Secure
HttpOnly
SameSite
```

# 70. Autorização

Cada recurso pertence a um usuário.

Identidade:

```text
OIDC subject
↓
Folhea User
↓
Book / ReadingSession
```

Um usuário nunca poderá consultar ou alterar recursos de outro usuário.

# 71. Status HTTP

Utilizar:

```text
400
requisição inválida

401
não autenticado

404
recurso inexistente ou não pertencente ao usuário

409
conflito de negócio

500
erro inesperado
```

# 72. Segurança web

Obrigatório:

```text
HTTPS
HSTS
Content-Security-Policy
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
```

PostgreSQL e Keycloak administrativo não devem ficar expostos indiscriminadamente à internet.

# 73. CSRF

Como a autenticação poderá utilizar cookies, proteção contra CSRF deverá fazer parte do desenho da sessão.

A estratégia deverá ser definida antes da implementação dos endpoints mutáveis.

Não assumir que `SameSite` sozinho resolve todos os cenários.

# 74. CORS

Preferencialmente frontend e API utilizarão a mesma origem pública.

Exemplo:

```text
https://folhea.com.br
https://folhea.com.br/api/*
```

Isso reduz complexidade de:

* cookies;
* CORS;
* autenticação;
* segurança.

# 75. Segredos

Nunca armazenar no Git:

```text
database password
client secret
SMTP credentials
tokens
cookies
chaves privadas
```

Utilizar secrets externos ou variáveis de ambiente conforme ambiente.

# 76. Rate limiting

Aplicar proteção para:

```text
login
registro
recuperação de senha
API
```

Keycloak deverá possuir proteção contra brute force configurada.

# 77. Infraestrutura inicial

Produção:

```text
Linux
Docker
Docker Compose
Caddy
Angular build
Quarkus
Keycloak
PostgreSQL
```

Não utilizar Kubernetes no v1.

# 78. Reverse Proxy

Utilizar:

```text
Caddy
```

Responsabilidades:

* HTTPS;
* certificados;
* compressão;
* headers;
* arquivos estáticos;
* páginas SSG;
* PWA;
* proxy `/api/*`;
* proxy para endpoints necessários de autenticação.

# 79. Arquitetura final

```text
                         INTERNET
                             |
                           HTTPS
                             |
                           CADDY
                             |
             ________________|________________
            |                |                |
            |                |                |
      páginas públicas    /app/*           /api/*
           SSG              CSR               |
            |                |             Quarkus
            |                |                |
            |                |        ________|________
            |                |       |                 |
          Angular           PWA   PostgreSQL         Keycloak
                                                   |
                                                   OIDC
                                                   |
                                            Google / E-mail
```

# 80. PostgreSQL e Keycloak

Preferencialmente utilizar a mesma instância PostgreSQL inicialmente, com bases separadas:

```text
folhea
keycloak
```

O backend Folhea nunca deverá consultar diretamente tabelas internas do Keycloak.

# 81. Desenvolvimento local

Infra:

```text
docker compose up
```

Pode iniciar:

```text
PostgreSQL
Keycloak
```

Backend:

```bash
./mvnw quarkus:dev
```

Frontend:

```bash
npm start
```

O `ng serve` encaminha `/api` e `/auth` ao BFF em `http://localhost:8080`
(`frontend/proxy.conf.json`) e envia `X-Forwarded-Host: localhost:4200`.
`/auth/login` inicia o OIDC; a tela Angular de entrar é `/entrar`. O Keycloak
de desenvolvimento escuta `http://localhost:8180` via override local.

# 82. Repositório

Utilizar monorepo:

```text
folhea/

  frontend/
  backend/
  infra/
  docs/

  docker-compose.yml
  README.md
```

Não utilizar Nx inicialmente.

# 83. Frontend structure

```text
frontend/src/app/

  core/
    auth/
    api/
    guards/
    services/

  shared/
    components/
    directives/
    pipes/
    models/

  public/
    landing/
    how-it-works/
    resources/
    about/

  features/
    home/
    books/
    reading/
    progress/
    cards/
    settings/

  layout/
  app.routes.ts
```

# 84. Estado frontend

Usar:

```text
Angular Signals
```

para estado local e compartilhado simples.

Não utilizar NgRx no v1.

Introduzir uma store complexa apenas se surgirem requisitos que Signals e services não atendam adequadamente.

# 85. Design system

Utilizar:

```text
Tailwind CSS 4
CSS Custom Properties
```

Criar tokens para:

```text
cores
tipografia
spacing
border radius
shadow
breakpoints
estados
```

Não adotar Angular Material como identidade visual principal.

O Folhea deve possuir linguagem visual própria.

# 86. Mobile first

A interface deve ser projetada prioritariamente para smartphone.

Depois adaptar para:

```text
tablet
desktop
```

Registrar leitura deve continuar simples em qualquer viewport.

# 87. Testes frontend

Utilizar:

```text
Vitest
```

Testar principalmente:

* services;
* Signals;
* forms;
* regras de apresentação;
* componentes críticos.

# 88. Testes E2E

Utilizar:

```text
Playwright
```

Fluxos obrigatórios:

```text
landing page
login
cadastro de livro
registro de leitura
edição de leitura
exclusão
finalização do livro
estatísticas
geração do card
```

# 89. Testes SEO

Pipeline deverá validar pelo menos:

* páginas públicas geradas;
* `<title>`;
* meta description;
* canonical;
* robots;
* sitemap;
* ausência acidental de `noindex`;
* status HTTP correto.

Também deverá existir verificação periódica manual ou automatizada com Lighthouse.

# 90. Testes backend

Utilizar:

```text
JUnit 5
RestAssured
Quarkus Test
Dev Services ou Testcontainers
```

# 91. Testes críticos do streak

Cobertura mínima:

```text
leitura hoje

leitura ontem

leitura hoje e ontem

quebra de sequência

múltiplas sessões no mesmo dia

timezone

sessão editada

sessão excluída
```

# 92. CI

Todo Pull Request deverá executar:

```text
frontend lint
frontend build
SSG build
frontend tests
backend build
backend tests
Playwright crítico
Docker build
```

Falha bloqueia merge.

# 93. CD

Após merge para produção:

```text
build
↓
testes
↓
geração SSG
↓
Docker image
↓
deploy
↓
health check
```

Ferramenta inicial:

```text
GitHub Actions
```

# 94. Health Checks

Quarkus deverá expor:

```text
liveness
readiness
```

Deploy saudável exige:

```text
backend saudável
+
PostgreSQL acessível
```

# 95. Logs

Produção:

```text
logs estruturados em JSON
```

Nunca registrar:

* senha;
* token;
* cookie;
* foto do usuário;
* dados privados desnecessários.

# 96. Observabilidade

Preparar o backend para:

```text
OpenTelemetry
Micrometer
```

Métricas técnicas:

```text
request count
latency
HTTP errors
database errors
CPU
memory
JVM
```

Grafana e Prometheus completos não são obrigatórios para o primeiro deploy.

# 97. Backup

PostgreSQL deverá possuir:

```text
backup diário
retenção mínima de 7 dias
backup fora do servidor principal
```

Preferencialmente:

```text
S3 compatible
```

Restores deverão ser testados periodicamente.

# 98. Analytics de produto

Eventos:

```text
account_created
book_created
reading_session_created
reading_session_updated
reading_session_deleted
book_finished
book_reopened
stats_viewed
card_created
card_shared
card_downloaded
pwa_installed
```

Não enviar para analytics:

```text
título de livro
autor
foto
conteúdo privado
```

# 99. Métricas de produto

## Ativação

Usuário registra sua primeira leitura.

## Ativação forte

Usuário registra leitura em pelo menos três dias dos primeiros sete.

## Retenção

Percentual que registra novamente na semana seguinte.

## Frequência

```text
sessões registradas
/
usuários ativos
```

## Uso do card

```text
cards gerados
/
usuários ativos
```

## Compartilhamento

```text
cards compartilhados
/
cards gerados
```

# 100. North Star Metric

Métrica principal:

```text
dias com leitura registrada
por usuário ativo
```

O sucesso do Folhea não deve ser medido principalmente por:

```text
contas criadas
livros cadastrados
page views
```

O comportamento que representa valor é:

> o usuário continuar lendo e registrando.

# 101. Critérios funcionais de aceite

## CA01

Usuário consegue autenticar-se.

## CA02

Usuário consegue cadastrar um livro.

## CA03

Usuário consegue registrar páginas, minutos ou ambos.

## CA04

Não é possível registrar sessão sem páginas nem minutos.

## CA05

Usuário consegue editar sessão.

## CA06

Usuário consegue excluir sessão.

## CA07

Métricas são recalculadas.

## CA08

Usuário consegue finalizar livro.

## CA09

Usuário consegue reabrir livro.

## CA10

Finalização é idempotente.

## CA11

Streak respeita as regras definidas.

## CA12

Streak não é limitado pelo período.

## CA13

Hoje, 7 dias, 30 dias e Todo o período funcionam corretamente.

## CA14

Usuário consegue gerar card 9:16.

## CA15

Card apresenta as quatro métricas.

## CA16

Foto pode ser usada como fundo.

## CA17

Foto não é enviada ao backend.

## CA18

Card pode ser baixado.

## CA19

Quando suportado, card pode ser compartilhado usando recursos do sistema.

## CA20

Usuário não consegue acessar dados de outro usuário.

# 102. Critérios PWA

## CP01

Site funciona normalmente sem instalação.

## CP02

PWA possui manifesto válido.

## CP03

PWA pode ser instalada em ambientes compatíveis.

## CP04

Quando instalada, abre em modo standalone.

## CP05

Assets principais podem ser carregados do cache.

## CP06

Operações online exibem erro adequado sem conexão.

## CP07

Nova versão pode substituir versão armazenada pelo service worker.

# 103. Critérios SEO

## CS01

Home pública é prerenderizada.

## CS02

Páginas públicas indexáveis entregam conteúdo relevante no HTML inicial.

## CS03

Cada página pública possui title e description próprios.

## CS04

Cada página pública possui canonical correta.

## CS05

Existe `sitemap.xml`.

## CS06

Existe `robots.txt`.

## CS07

Área `/app/**` não deve ser indexada.

## CS08

URLs públicas são semanticamente legíveis.

## CS09

Open Graph funciona nas principais páginas de aquisição.

## CS10

Página inexistente responde corretamente com HTTP 404.

## CS11

Redirecionamentos permanentes utilizam status 301 ou 308.

## CS12

Não utilizar soft 404.

## CS13

Páginas públicas devem buscar atingir bons Core Web Vitals.

# 104. Fora do escopo do v1

Não implementar:

* Flutter;
* Android nativo;
* iOS nativo;
* microserviços;
* Kubernetes;
* Kafka;
* Redis como cache de domínio ou fila (permitido **somente** como store
  opaco de sessão OIDC, CSRF e rate limit na rede privada do Compose);
* Elasticsearch;
* GraphQL;
* WebSocket;
* Native Image;
* sincronização offline;
* IndexedDB para domínio;
* push notification;
* object storage para fotos;
* processamento de card no backend;
* ISBN;
* scanner;
* catálogo externo;
* capas automáticas;
* integração Kindle;
* integração Kobo;
* feed;
* seguidores;
* reviews;
* notas;
* comentários;
* ranking;
* clubes;
* chat;
* recomendações de livros;
* IA;
* leitor de ebook;
* preços;
* assinatura;
* loja.

# 105. Evoluções possíveis

Avaliar posteriormente:

## Timer

Cronômetro de sessão.

## ISBN

Cadastro por código de barras.

## Capas

Busca automática de metadados.

## Metas

Exemplos:

```text
20 minutos por dia
30 páginas por dia
24 livros no ano
```

## Histórico visual

Calendário semelhante a mapa de contribuições.

## Push

Lembretes de hábito.

## Offline

```text
IndexedDB
fila local
sync
resolução de conflitos
```

## Conteúdo

Blog e páginas editoriais orientadas a SEO.

## Social

Somente mediante validação de demanda.

# 106. Princípio de produto

A prioridade do Folhea não é cadastrar livros.

A prioridade é:

> tornar o ato de registrar uma leitura tão simples que o usuário queira continuar fazendo isso todos os dias.

# 107. Princípio técnico

Começar simples:

```text
1 frontend
1 backend
1 banco
1 provedor de identidade
1 reverse proxy
```

Arquitetura:

```text
Angular
+
Quarkus
+
PostgreSQL
+
Keycloak
+
Caddy
```

Não introduzir complexidade de infraestrutura sem problema real que a justifique.

# 108. Stack oficial Folhea v1

## Frontend

```text
Angular 22
TypeScript
Angular Signals
Angular Router
Angular Reactive Forms
Angular HttpClient
Tailwind CSS 4
Angular PWA
Angular SSG
Vitest
Playwright
```

Rendering:

```text
SSG para área pública
CSR para /app/**
```

## Backend

```text
Java 25 LTS
Quarkus 3.33 LTS
Quarkus REST
Hibernate ORM
Panache Repository
Hibernate Validator
Flyway
SmallRye OpenAPI
OIDC
JUnit 5
RestAssured
```

## Banco

```text
PostgreSQL 18
```

## Identidade

```text
Keycloak
OpenID Connect
Google
E-mail + senha
```

## Infraestrutura

```text
Linux
Docker
Docker Compose
Caddy
HTTPS
```

## CI/CD

```text
Git
GitHub
GitHub Actions
Docker
```

# 109. Decisão arquitetural final

```text
                         FOLHEA

                  Browser / PWA

                        Caddy
                          |
         _________________|_________________
        |                 |                 |
        |                 |                 |
   Site público          /app             /api
      SSG                CSR                |
        |                 |              Quarkus
        |              Angular              |
        |                 |          _______|_______
        |                 |         |               |
        |                 |     PostgreSQL       Keycloak
        |                 |                         |
        |                 |                        OIDC
        |                 |                         |
        |                 |                  Google / E-mail
        |
       SEO
```

Esta será a arquitetura de referência para o Folhea v1.

# 110. Diretriz final

O Folhea deve nascer preparado para dois comportamentos diferentes:

```text
Aquisição
↓
Web pública rápida, indexável e compartilhável

Uso recorrente
↓
Aplicação PWA rápida, simples e privada
```

A área pública deve ajudar novos usuários a encontrar e entender o Folhea.

A área autenticada deve ajudar usuários existentes a registrar uma leitura com o mínimo de atrito possível.

Nenhuma decisão de SEO deve piorar a experiência do aplicativo, e nenhuma decisão de PWA deve impedir o crescimento orgânico da parte pública.
