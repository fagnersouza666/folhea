# Bug Report — Folhea

> Data: 06/09/2026 | Stack: Java 25, Quarkus 3.33.3, Hibernate ORM/Panache, Flyway, OIDC BFF, PostgreSQL 18, Angular 22, TypeScript
> Modo: **full**
> **Status:** corrigido em 06/09/2026 — os 20 itens abaixo foram implementados conforme o plano de correções.
> Arquivos analisados: 44 Java de produção, 47 TypeScript do frontend, 3 migrations SQL, `application.properties`, `Caddyfile`, `docker-compose.yml` e testes amostrados

Grafo consultado: `list_projects`, `index_repository`, `index_status`, `get_architecture` (rotas, hotspots, entry points), `search_code`, `check_index_coverage`. Limitação: parse parcial em `backend/src/main/resources/db/migration/V001__initial_schema.sql` linhas 19–20 — o arquivo foi lido por completo no source. Cobertura sem gap registrado nos arquivos citados; sinal best-effort, não prova de completude.

---

## Sumário

| Severidade | Quantidade |
|------------|------------|
| CRITICO    | 0          |
| ALTO       | 10         |
| MEDIO      | 7          |
| BAIXO      | 3          |
| **Total**  | **20**     |

**Veredicto:** ATENÇÃO → **RESOLVIDO** (06/09/2026)

Não há bug CRÍTICO de corrupção de dados, injeção SQL ou crash no fluxo autenticado feliz. Os itens ALTO/MÉDIO/BAIXO listados abaixo foram corrigidos; o relatório permanece como registro histórico da análise.

---

## CRITICO

Nenhum. Os fluxos de ownership (`findOwned` com `userId`), queries Panache parametrizadas, CSRF + Origin no BFF e o Caddy reescrevendo `X-Forwarded-For` estão sólidos.

---

## ALTO

### BUG-001: Eventos de analytics nunca passam no filtro CSRF

**Arquivo:** `frontend/src/app/core/analytics/analytics.service.ts`
**Linha(s):** 60-72

**O que acontece:**
`track()` envia `POST /api/v1/analytics/events` com `navigator.sendBeacon` (ou `fetch` keepalive). Nenhum dos dois passa pelo interceptor Angular, então o header `X-CSRF-Token` não é enviado.

**Por que é um problema:**
`SecurityBoundaryFilter` trata POST autenticado como mutação e exige CSRF + Origin. Em qualquer navegador com `sendBeacon` (quase todos), o evento é abortado com 403 antes de `AnalyticsResource`. A telemetria do produto descrita em `docs/quality-and-release.md` não chega ao backend. O fallback `fetch` também não envia o token.

**Código problemático:**
```typescript
if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
  navigator.sendBeacon(this.endpoint, new Blob([payload], { type: 'application/json' }));
  return;
}

if (typeof fetch === 'function') {
  void fetch(this.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
    credentials: 'include',
    keepalive: true
  }).catch(() => undefined);
}
```

**Solução:**
```typescript
track(event: ProductEvent, properties: AnalyticsProperties = {}): void {
  if (typeof window === 'undefined') return;
  const payload = {
    event,
    occurredAt: new Date().toISOString(),
    properties: safeAnalyticsProperties(properties)
  };
  this.http.post(this.endpoint, payload, {
    withCredentials: true,
    headers: { Accept: 'application/json' }
  }).pipe(catchError(() => EMPTY)).subscribe();
}
```

Use o `HttpClient` (o `csrfInterceptor` já anexa o token) ou obtenha o token via `CsrfService.getToken()` e envie `X-CSRF-Token` no `fetch`/`sendBeacon`.

**Explicação da correção:**
Mutações autenticadas só são aceitas com o synchronizer token. Sem o header, o filtro aborta; com o `HttpClient`, o interceptor já existente cobre o contrato.

---

### BUG-002: Livro otimista usa `local-book-*` como UUID na sessão

**Arquivo:** `frontend/src/app/core/state/dashboard.store.ts`
**Linha(s):** 117-130
**Também:** `frontend/src/app/features/books/new-book.component.ts` linha 12

**O que acontece:**
`addBook()` insere um livro com `id: local-book-${Date.now()}` e devolve esse objeto. `NewBookComponent.submit()` navega imediatamente para `/app/ler`. A lista de livros inclui o ID fake. Se o usuário registrar leitura antes do `POST /books` retornar (rede lenta) ou se o POST falhar e o livro otimista for removido depois da seleção, o `bookId` enviado não é UUID.

**Por que é um problema:**
Jackson falha ao desserializar `"bookId": "local-book-1757…"` e a API responde 400 (`JSON inválido`). O onboarding mais comum (cadastrar livro → registrar leitura) quebra exatamente quando a rede não é instantânea.

**Código problemático:**
```typescript
const optimistic: Book = { id: `local-book-${Date.now()}`, title, author: author || undefined, status: 'READING', createdAt: now, updatedAt: now };
this.booksState.update((books) => [optimistic, ...books]);
```

```typescript
if (this.form.valid) { this.store.addBook(title, this.form.controls.author.value.trim()); void this.router.navigate(['/app/ler']); }
```

**Solução:**
```typescript
addBook(title: string, author = ''): Observable<Book> {
  return this.api.createBook({ title, author: author || undefined }).pipe(
    tap((book) => {
      this.booksState.update((books) => [book, ...books]);
      this.syncCurrentBook();
      this.analytics.track('book_created');
    })
  );
}
```

No componente, só navegar no `next` do Observable. Enquanto o ID real não existir, não oferecer o livro no `<select>` de leitura.

**Explicação da correção:**
A sessão exige UUID de um livro persistido e pertencente ao usuário. Otimismo na lista é aceitável; usar o ID temporário como chave de API não é.

---

### BUG-003: Tela de sucesso aparece antes da sessão existir

**Arquivo:** `frontend/src/app/features/reading/reading.component.ts`
**Linha(s):** 15
**Também:** `frontend/src/app/features/reading/feedback.component.ts` linhas 5-9; `dashboard.store.ts` linhas 173-186

**O que acontece:**
`submit()` chama `addSession()` (HTTP assíncrono) e navega na hora para `/app/ler/feedback`, que renderiza “Leitura registrada.” com páginas/minutos de `history.state`. Se a API rejeitar (livro otimista, CSRF, 401, validação), o store desfaz a sessão, mas o usuário já viu sucesso.

**Por que é um problema:**
O usuário acredita que o streak/páginas foram gravados. No F5 da home os números não batem. Combina com BUG-002: o caminho cadastro → leitura mostra sucesso e depois um alerta genérico no shell.

O mesmo padrão existe em `EditSessionComponent.save()` / `remove()` (navega para progresso sem esperar a API).

**Código problemático:**
```typescript
submit(): void {
  this.form.markAllAsTouched();
  if (this.form.valid) {
    this.store.addSession({ bookId: this.form.controls.bookId.value, readingDate: this.form.controls.readingDate.value, pages: this.pages.value, minutes: this.minutes.value });
    void this.router.navigate(['/app/ler/feedback'], { state: { pages: this.pages.value, minutes: this.minutes.value } });
  }
}
```

**Solução:**
```typescript
submit(): void {
  this.form.markAllAsTouched();
  if (this.form.invalid) return;
  this.store.addSession({
    bookId: this.form.controls.bookId.value,
    readingDate: this.form.controls.readingDate.value,
    pages: this.pages.value,
    minutes: this.minutes.value
  }).subscribe({
    next: (session) => void this.router.navigate(['/app/ler/feedback'], {
      state: { pages: session.pages, minutes: session.minutes }
    }),
    error: () => { /* o store já define a mensagem; permanecer no formulário */ }
  });
}
```

Faça `addSession` devolver o `Observable` da API (otimismo local pode continuar, mas a navegação de sucesso só no `next`).

**Explicação da correção:**
Feedback de sucesso precisa ser consequência de persistência, não do clique.

---

### BUG-004: Falha ao obter CSRF trava mutações até recarregar a página

**Arquivo:** `frontend/src/app/core/api/csrf.service.ts`
**Linha(s):** 16-28

**O que acontece:**
`getToken()` guarda o Observable em `request$` com `shareReplay({ bufferSize: 1, refCount: false })`. O `tap` que zera `request$` só roda no sucesso. Se `GET /api/v1/csrf` falhar (rede, 429, 500, 401), o erro fica cacheado e `request$` nunca é limpo.

**Por que é um problema:**
Depois de um blip de rede, todo `POST`/`PATCH`/`DELETE` reutiliza o mesmo Observable falho. `clear()` só é chamado no logout ou após 403 no interceptor. O usuário autenticado fica incapaz de registrar leitura até um F5.

**Código problemático:**
```typescript
const request$ = this.http.get<CsrfResponse>('/api/v1/csrf', { withCredentials: true }).pipe(
  map(({ token }) => token),
  tap((token) => { this.token = token; this.request$ = null; }),
  shareReplay({ bufferSize: 1, refCount: false })
);
this.request$ = request$;
```

**Solução:**
```typescript
getToken(): Observable<string> {
  if (this.token) return of(this.token);
  if (!this.request$) {
    this.request$ = this.http.get<CsrfResponse>('/api/v1/csrf', { withCredentials: true }).pipe(
      map(({ token }) => token),
      tap((token) => { this.token = token; }),
      catchError((error) => {
        this.request$ = null;
        this.token = null;
        return throwError(() => error);
      }),
      finalize(() => { this.request$ = null; }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }
  return this.request$;
}
```

**Explicação da correção:**
Erro não pode ser reexecutado como valor memoizado. `finalize` libera o in-flight; a próxima mutação tenta de novo.

---

### BUG-005: “Hoje” e streak no cliente usam o fuso do dispositivo, o backend usa o do usuário

**Arquivo:** `frontend/src/app/core/state/dashboard.store.ts`
**Linha(s):** 217-234
**Também:** `frontend/src/app/features/reading/reading.component.ts` linha 8 (hint: “A data usa o fuso horário do seu dispositivo.”); `backend/src/main/java/com/folhea/shared/TimeProvider.java` linhas 18-20; `StatisticsService.java` linhas 53-55

**O que acontece:**
`DashboardStore.today()` faz `Intl.DateTimeFormat('en-CA').format(new Date())` (fuso do browser). Streak, semana da home e `finishedOn` padrão saem daí. O backend calcula `today(user.timezone)` a partir do claim OIDC/`zoneinfo` (ou UTC). `calculateVisibleStats()` ainda sobrescreve as stats da API com o cálculo local.

**Por que é um problema:**
Quem lê depois da meia-noite no Brasil com `timezone=UTC` na conta (claim ausente) grava “ontem” no servidor e “hoje” no cliente, ou o inverso. O North Star do produto é “dias seguidos”; a métrica diverge entre home, progresso e API. Settings mostra o timezone da conta, mas nenhum fluxo de leitura o usa.

**Código problemático:**
```typescript
today(): string { return new Intl.DateTimeFormat('en-CA').format(new Date()); }
```

**Solução:**
```typescript
today(): string {
  const timezone = this.userTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}
```

Preencher `userTimezone` a partir de `GET /api/v1/me` (`AuthService.user()?.timezone`). No backend, não persistir `UTC` silencioso quando o claim falta se o produto assume o fuso do dispositivo — ou documentar e enviar o timezone do cliente no primeiro `/me`.

**Explicação da correção:**
Um único fuso precisa definir “hoje” em cliente e servidor, senão o streak mente na virada do dia.

---

### BUG-006: Exceções inesperadas viram 500 sem log

**Arquivo:** `backend/src/main/java/com/folhea/shared/UnhandledExceptionMapper.java`
**Linha(s):** 14-22

**O que acontece:**
O mapper de `Throwable` devolve problem+json genérico e não registra a exceção. No código de produção, o único `Logger` é o de analytics.

**Por que é um problema:**
Violação de unique em `identity_subject` (BUG-008), falha de Hibernate ou NPE em um resource aparecem como “Não foi possível concluir a operação.” sem stack no JSON logging. O incidente fica invisível em `docker compose logs backend`.

**Código problemático:**
```java
public Response toResponse(Throwable exception) {
    return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
            .type(MediaType.valueOf("application/problem+json"))
            .entity(new ProblemResponse(URI.create("https://folhea.com.br/problems/internal-error"),
                    "Erro interno", 500, "Não foi possível concluir a operação."))
            .build();
}
```

**Solução:**
```java
private static final Logger LOG = Logger.getLogger(UnhandledExceptionMapper.class);

@Override
public Response toResponse(Throwable exception) {
    LOG.error("Unhandled exception", exception);
    return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
            .type(MediaType.valueOf("application/problem+json"))
            .entity(new ProblemResponse(URI.create("https://folhea.com.br/problems/internal-error"),
                    "Erro interno", 500, "Não foi possível concluir a operação."))
            .build();
}
```

**Explicação da correção:**
A mensagem pública continua genérica; o diagnóstico vai para o log estruturado, que já mascara cookies/tokens.

---

### BUG-007: Repositório CSRF em memória cresce sem teto

**Arquivo:** `backend/src/main/java/com/folhea/security/CsrfTokenService.java`
**Linha(s):** 24, 41-48
**Também:** `backend/src/main/java/com/folhea/security/CsrfResource.java` linhas 24-34

**O que acontece:**
Tokens ficam em `ConcurrentHashMap` sem limite e sem varredura de expirados. `CsrfResource` emite um ticket novo sempre que o cookie `__Host-folhea_session` está ausente ou inválido, mesmo com o usuário já autenticado no OIDC.

**Por que é um problema:**
O rate limiter tem `MAX_WINDOWS = 100_000`; o CSRF não. Um cliente autenticado que chama `GET /api/v1/csrf` sem enviar o cookie CSRF (script, app, retry) cria uma entrada nova a cada request. Entradas expiradas só saem em `isValid` daquela chave. Isso é vazamento de memória e vetor de DoS autenticado.

**Código problemático:**
```java
private final Map<String, TokenEntry> tokens = new ConcurrentHashMap<>();

public String getOrIssue(String sessionTicket) {
    requireTicket(sessionTicket);
    Instant now = clock.instant();
    TokenEntry entry = tokens.compute(sessionTicket, (ignored, existing) -> {
        if (existing != null && now.isBefore(existing.expiresAt())) return existing;
        return new TokenEntry(newToken(), now.plus(ttl));
    });
    return entry.value();
}
```

**Solução:**
Espelhar o `RateLimiter`: teto de entradas, `removeIf` de expirados a cada N operações, e recusar `getOrIssue` quando o mapa estiver cheio. Em `CsrfResource`, não gerar ticket novo em loop — recusar sem cookie válido ou reutilizar o ticket OIDC de forma estável.

**Explicação da correção:**
O mapa é estado de processo. Sem eviction e sem teto, o heap acompanha o número de tickets já emitidos, não o de sessões vivas.

---

### BUG-008: Provisionamento de usuário não é atômico

**Arquivo:** `backend/src/main/java/com/folhea/identity/CurrentUser.java`
**Linha(s):** 18-35

**O que acontece:**
`get()` faz `findByIdentitySubject` e, se null, `persist`. Não há `ON CONFLICT` / tratamento da unique `identity_subject`. Qualquer GET autenticado (`/me`, `/books`, `/sessions`, `/dashboard`, `/stats`) pode criar o usuário porque `get()` é `@Transactional` e tem efeito colateral de escrita.

**Por que é um problema:**
Dois requests em paralelo no primeiro login (duas abas no callback, ou `/me` + `/dashboard` se o initializer não serializar) tentam inserir o mesmo `identity_subject`. O segundo estoura constraint SQL, cai no mapper genérico (BUG-006, sem log) e devolve 500. O SPA dispara quatro cargas em paralelo no `DashboardStore.load()`.

**Código problemático:**
```java
UserEntity user = users.findByIdentitySubject(subject);
if (user == null) {
    user = new UserEntity();
    user.identitySubject = subject;
    user.email = email;
    user.timezone = validTimezone(identityTimezone());
    users.persist(user);
}
```

**Solução:**
```java
UserEntity user = users.findByIdentitySubject(subject);
if (user == null) {
    try {
        user = new UserEntity();
        user.identitySubject = subject;
        user.email = email;
        user.timezone = validTimezone(identityTimezone());
        users.persistAndFlush(user);
    } catch (PersistenceException ex) {
        users.getEntityManager().clear();
        user = users.findByIdentitySubject(subject);
        if (user == null) throw ex;
    }
}
```

Alternativa mais limpa: `INSERT … ON CONFLICT (identity_subject) DO NOTHING` + `find` de novo.

**Explicação da correção:**
A unique no banco já é a fonte de verdade; o código precisa tratar a corrida em vez de transformar o segundo request em 500.

---

### BUG-009: 401 em voo não encerra a sessão na UI

**Arquivo:** `frontend/src/app/core/api/csrf.interceptor.ts`
**Linha(s):** 8-26
**Também:** `frontend/src/app/core/auth/auth.service.ts` linhas 29-40; `frontend/src/app/layout/app-shell.component.ts` linha 16

**O que acontece:**
O interceptor só reage a 403 (CSRF). `restoreSession()` roda uma vez no bootstrap. Se o cookie OIDC expirar, as APIs voltam 401, o store mostra “É necessário autenticar-se.” e o header continua com e-mail e botão Sair.

**Por que é um problema:**
O usuário acha que está autenticado e tenta registrar leitura em loop. Não há redirect para `/entrar`. Mutações otimistas são revertidas com a mesma mensagem.

**Código problemático:**
```typescript
catchError((error: unknown) => {
  if (error instanceof HttpErrorResponse && error.status === 403) {
    csrf.clear();
    return csrf.getToken().pipe(
      switchMap((token) => next(withCredentials.clone({ setHeaders: { 'X-CSRF-Token': token } })))
    );
  }
  return throwError(() => error);
})
```

**Solução:**
```typescript
catchError((error: unknown) => {
  if (error instanceof HttpErrorResponse && error.status === 401) {
    inject(AuthService).signOut();
    return throwError(() => error);
  }
  if (error instanceof HttpErrorResponse && error.status === 403) {
    csrf.clear();
    return csrf.getToken().pipe(
      switchMap((token) => next(withCredentials.clone({ setHeaders: { 'X-CSRF-Token': token } })))
    );
  }
  return throwError(() => error);
})
```

Evitar chamar `signOut()` no próprio `GET /me` de restore (loop). Tratar 401 só em requests após `initialized`.

**Explicação da correção:**
401 no BFF significa “não há sessão”. A UI precisa refletir isso, não só o alerta de mutação.

---

### BUG-010: Dashboard e streak carregam todas as sessões do usuário

**Arquivo:** `backend/src/main/java/com/folhea/statistics/StatisticsService.java`
**Linha(s):** 43-55
**Também:** `backend/src/main/java/com/folhea/reading/ReadingSessionResource.java` linhas 43-45; `ReadingSessionRepository.allOwned`

**O que acontece:**
Cada `GET /dashboard` chama `sessions.allOwned(user.id)` só para o streak, além da janela de 7 dias. `GET /sessions` sem `from`/`to` devolve a história inteira. O frontend guarda tudo em memória e recalcula stats no cliente.

**Por que é um problema:**
Com anos de leitura diária isso vira payload e heap lineares. O índice `idx_reading_session_user_date` existe, mas a query não limita. É o clássico “funciona com 50 registros, degrada com 5 000”.

**Código problemático:**
```java
private int streak(UserEntity user) {
    return StreakCalculator.current(sessions.allOwned(user.id).stream().map(s -> s.readingDate).toList(), today(user));
}
```

**Solução:**
Consultar datas distintas em SQL até quebrar a sequência, por exemplo:

```sql
SELECT DISTINCT reading_date
FROM reading_session
WHERE user_id = :userId AND reading_date <= :today
ORDER BY reading_date DESC
LIMIT 400
```

e calcular o streak nesse conjunto. Em `GET /sessions`, exigir período (já existe `from`/`to`) e paginar; o frontend já pede stats por período.

**Explicação da correção:**
Streak só precisa das datas mais recentes até o primeiro buraco, não do histórico completo hidratado em entidades.

---

## MEDIO

### BUG-011: Páginas e minutos não têm teto

**Arquivo:** `backend/src/main/java/com/folhea/reading/ReadingSessionResource.java`
**Linha(s):** 96-109
**Também:** `frontend/src/app/features/reading/reading.component.ts` (input `type="number"` só com `min="0"`)

**O que acontece:**
`validateProgress` rejeita negativo e zero/zero, mas aceita `Integer.MAX_VALUE`. O HTML não tem `max`. A coluna SQL é `INTEGER`.

**Por que é um problema:**
Um `pages=2147483647` distorce stats, cards e streak visual. Não corrompe o banco, mas quebra o sentido das métricas.

**Solução:**
```java
private static final int MAX_PAGES = 10_000;
private static final int MAX_MINUTES = 24 * 60;

private static void validateProgress(Integer pages, Integer minutes) {
    int pageCount = pages == null ? 0 : pages;
    int minuteCount = minutes == null ? 0 : minutes;
    if (pageCount < 0 || minuteCount < 0 || (pageCount == 0 && minuteCount == 0)) {
        invalid("Informe páginas, minutos ou ambos; os valores não podem ser negativos.");
    }
    if (pageCount > MAX_PAGES || minuteCount > MAX_MINUTES) {
        invalid("Páginas ou minutos excedem o limite permitido para uma sessão.");
    }
}
```

No form: `max="10000"` / `max="1440"` e `Validators.max`.

**Explicação da correção:**
Uma sessão de leitura tem limite físico; o contrato precisa refletir isso nos dois lados.

---

### BUG-012: Mappers de 400 devolvem `exception.getMessage()` cru

**Arquivo:** `backend/src/main/java/com/folhea/shared/IllegalArgumentExceptionMapper.java`
**Linha(s):** 12-16
**Também:** `backend/src/main/java/com/folhea/shared/BadRequestExceptionMapper.java` linhas 14-16

**O que acontece:**
`BookEntity.validate()` e `ReadingSessionEntity.validateProgress()` lançam `IllegalArgumentException` em inglês (“Book title cannot be blank”). O mapper envia isso no campo `detail` do problem+json. `BadRequestException` do JAX-RS pode incluir texto interno do runtime.

**Por que é um problema:**
O restante da API é em português e sanitizado (`UnhandledExceptionMapper`, `ProblemWebExceptionMapper`). Aqui vaza mensagem de framework/entidade. Não é stack trace, mas quebra o contrato público e pode expor detalhe de parsing.

**Solução:**
```java
.entity(new ProblemResponse(URI.create("https://folhea.com.br/problems/invalid-request"),
        "Requisição inválida", 400, "A requisição não atende ao contrato esperado."))
```

Tratar regras de negócio com `ProblemException` (já usado nos resources) em vez de IAE nas entidades, ou mapear IAE conhecido para o type `invalid-book` / `invalid-reading-session`.

**Explicação da correção:**
O cliente só deve ver as mensagens do contrato; internals ficam no log.

---

### BUG-013: `load()` marca sucesso antes das requests terminarem

**Arquivo:** `frontend/src/app/core/state/dashboard.store.ts`
**Linha(s):** 45-52

**O que acontece:**
`hasLoaded = true` no início. Se dashboard/livros/sessões falharem, `AppShell` não chama `load()` de novo na navegação interna. Há retry pontual em livros/sessões, não no resumo.

**Por que é um problema:**
Primeira carga com 502/timeout deixa a home vazia até F5. `reload()` existe mas quase nenhum template o dispara no erro do dashboard.

**Solução:**
```typescript
load(): void {
  if (this.hasLoaded || this.loadingState()) return;
  this.loadDashboard();
  this.loadBooks();
  this.loadSessions();
  this.loadStats(this.periodState());
}

loadDashboard(): void {
  this.loadingState.set(true);
  this.api.getDashboard().subscribe({
    next: (dashboard) => {
      this.dashboardState.set(dashboard);
      this.loadingState.set(false);
      this.hasLoaded = true;
    },
    error: (error: unknown) => {
      this.loadingState.set(false);
      this.hasLoaded = false;
      this.errorState.set(this.errorMessage(error, 'Não foi possível carregar seu resumo.'));
    }
  });
}
```

**Explicação da correção:**
`hasLoaded` deve significar “já temos um dashboard válido”, não “já disparamos o HTTP”.

---

### BUG-014: Deep link de livro/sessão mostra “não encontrado” enquanto os dados ainda não chegaram

**Arquivo:** `frontend/src/app/features/books/book-detail.component.ts`
**Linha(s):** 27-28, 41
**Também:** `frontend/src/app/features/reading/edit-session.component.ts` linhas 24, 34-35

**O que acontece:**
O template trata `store.getBook(id) === undefined` como “Livro não encontrado”. `getBook` só olha o array em memória. No first paint após F5 em `/app/livros/:id`, `loadBooks()` ainda não retornou.

**Por que é um problema:**
Deep link e PWA aberta numa URL interna piscam o empty state (ou o usuário clica “Voltar” antes do load). Não é 404 real.

**Solução:**
```html
@if (store.booksLoading() && !book()) {
  <div class="loading surface" role="status">Carregando livro…</div>
} @else if (book(); as currentBook) {
  <!-- detalhe -->
} @else {
  <section class="empty surface">Livro não encontrado</section>
}
```

O mesmo para sessão (`sessionsLoading()`).

**Explicação da correção:**
Ausência temporária no store não é ausência no servidor.

---

### BUG-015: `bookId` omitido na criação da sessão vira 404 de livro

**Arquivo:** `backend/src/main/java/com/folhea/reading/ReadingSessionResource.java`
**Linha(s):** 90-93, 105-107

**O que acontece:**
Não há `@Valid` nos records (nenhum resource do projeto usa). `ensureBookOwned(user.id, null)` devolve 404 “Livro não encontrado” em vez de 400 “Informe o livro”.

**Por que é um problema:**
Cliente com body `{ "pages": 10, "minutes": 8, "readingDate": "2026-09-06" }` recebe 404 e pode assumir ID errado. O `@NotNull` do record nunca dispara.

**Solução:**
```java
public Response create(@Valid CreateSessionRequest request) { ... }

private void ensureBookOwned(UUID userId, UUID bookId) {
    if (bookId == null) invalid("Informe o livro da sessão.");
    if (books.findOwned(userId, bookId) == null) {
        throw new ProblemException(404, "https://folhea.com.br/problems/book-not-found",
                "Livro não encontrado", "Livro inexistente ou não pertencente ao usuário.");
    }
}
```

**Explicação da correção:**
Campo obrigatório ausente é 400; 404 fica para UUID existente de outro dono ou inexistente.

---

### BUG-016: Flyway `baseline-on-migrate=true` em todos os perfis

**Arquivo:** `backend/src/main/resources/application.properties`
**Linha(s):** 15-16

**O que acontece:**
`quarkus.flyway.baseline-on-migrate=true` não está restrito a `%dev`. Em um banco não vazio sem histórico Flyway, o baseline marca o schema como aplicado e **pula** `V001`.

**Por que é um problema:**
Restore parcial, dump manual ou ambiente criado à mão pode subir o app sem as constraints `book_finished_status_consistent` / `reading_session_book_owner_fk`. Os testes de entidade não salvam esse ambiente.

**Solução:**
```properties
%dev.quarkus.flyway.baseline-on-migrate=true
%test.quarkus.flyway.baseline-on-migrate=true
%prod.quarkus.flyway.baseline-on-migrate=false
```

**Explicação da correção:**
Baseline é conveniência de desenvolvimento; em produção a história de migrations precisa ser explícita.

---

### BUG-017: Compose padrão sobe Keycloak com `start-dev`

**Arquivo:** `docker-compose.yml`
**Linha(s):** 29
**Também:** `docs/operations.md` (já pede `start --optimized` em produção)

**O que acontece:**
O serviço `keycloak` usa `command: ["start-dev", …]`. O README indica `docker compose up` como stack local e o runbook de operação usa o mesmo compose, com um aviso para substituir o comando em produção.

**Por que é um problema:**
Quem seguir só o compose em um host público deixa o IdP em modo desenvolvimento (hostname relaxado, defaults de dev). O risco é operacional, não um bug de código da API.

**Solução:**
Separar `docker-compose.yml` (dev) e `docker-compose.prod.yml` com `start --optimized`, ou tornar o command `${KEYCLOAK_START_COMMAND:-start-dev}` sem default inseguro no overlay de produção.

**Explicação da correção:**
O default executável precisa ser o modo que o ambiente pretende; o aviso em markdown não impede `compose up` em um VPS.

---

## BAIXO

### BUG-018: `drawCover` divide por `naturalWidth`/`naturalHeight` sem guarda

**Arquivo:** `frontend/src/app/core/services/card-generator.service.ts`
**Linha(s):** 89-95

**O que acontece:**
Imagem decodificada com dimensão 0 (arquivo quebrado que ainda dispara `onload`) gera `scale = Infinity` e `drawImage` com origem inválida.

**Solução:**
```typescript
if (image.naturalWidth < 1 || image.naturalHeight < 1) {
  throw new Error('Não foi possível ler esta foto.');
}
```

---

### BUG-019: Listener `appinstalled` não é removido

**Arquivo:** `frontend/src/app/layout/app-shell.component.ts`
**Linha(s):** 41-44

**O que acontece:**
`addEventListener('appinstalled', this.onInstalled)` no constructor, sem `ngOnDestroy`. Em logout há navegação full-page, então o impacto prático é baixo.

**Solução:** implementar `OnDestroy` e `removeEventListener('appinstalled', this.onInstalled)`.

---

### BUG-020: Token state OIDC em memória sem eviction periódica

**Arquivo:** `backend/src/main/java/com/folhea/security/ServerTokenStateManager.java`
**Linha(s):** 26-40, 51-55

**O que acontece:**
Access/refresh tokens ficam no `ConcurrentHashMap` até `getTokens` ver expiração ou `deleteTokens` no logout. Login é limitado por IP (`login-per-ip`), então o risco é menor que o do CSRF (BUG-007), mas sessões abandonadas retêm tokens até o processo reiniciar.

**Solução:** a mesma varredura periódica do rate limiter, com teto e `removeIf` por `expiresAt`.

---

## Observações Gerais

Pontos positivos (não são bugs):

- Ownership consistente: `findOwned` sempre filtra `userId`; V002 amarra `(book_id, user_id)` na sessão.
- Sem concatenação SQL; Panache com placeholders.
- CSRF synchronizer + Origin/Referer + cookie `__Host-` HttpOnly; Caddy apaga e reinsere `X-Forwarded-For` com `{remote_host}` — o filtro de rate limit que lê o header é seguro **neste** edge.
- Problem+json na maior parte dos mappers, sem vazar stack no 500.
- `RateLimiter` com `ConcurrentHashMap`, lock, teto e janela; testes com `Clock` mutável.
- Jackson `fail-on-unknown-properties`, limite de body 64 KiB no Quarkus e no Caddy.
- Frontend: `withCredentials`, `encodeURIComponent` nos IDs, cards revogam object URLs no destroy.

Falsos positivos descartados:

- `.subscribe()` no `DashboardStore`: `providedIn: 'root'` e `HttpClient` completa; não é leak de componente.
- `orElse(null)` em `CurrentUser` no e-mail: coluna nullable, e o update ignora claim ausente.
- `X-Forwarded-For` no `AbuseProtectionFilter`: mitigado pelo Caddyfile (strip + `{remote_host}`).
- Catch de `RuntimeException` em timezone: fallback UTC intencional.

Prioridade sugerida: BUG-001, BUG-002, BUG-003, BUG-004, BUG-005, BUG-006, BUG-008.

---

## Revisão pontual — RedisSecurityStoreTest (06/09/2026)

Modo **quick** nos arquivos desta correção: `application.properties`,
`RedisSecurityStoreTest.java`. Nenhum CRÍTICO/ALTO novo. O acoplamento a
`redis://127.0.0.1:6379` era falso verde local (redis-server de sistema);
Dev Services agora provisiona `redis:7-alpine` e o teste recusa a porta 6379.

---

## Revisão pontual — 404 em `/auth/login` no `ng serve` (06/09/2026)

Modo **quick** nos arquivos desta correção: `frontend/proxy.conf.json`,
`frontend/angular.json`, `frontend/src/app/core/auth/dev-proxy.spec.ts`,
`infra/keycloak/folhea-realm.dev.template.json`, `scripts/ci/validate-oidc-surface.mjs`.

Nenhum CRÍTICO/ALTO novo. Causa raiz confirmada em runtime: o Angular
tratava `GET /auth/login` (e até `/api/v1/me`) como rota SPA e renderizava
`NotFoundComponent`. O proxy local replica o Caddy (`/auth` e `/api` →
Quarkus em `:8080`). O alvo é só `http://localhost:8080` (não é open
proxy). `/auth/login` continua sendo o BFF, não uma rota Angular.

`ClockProducer` injeta `Optional<String>` em `folhea.clock.fixed-instant`.
`defaultValue=""` no SmallRye é tratado como propriedade ausente
(SRCFG00014) e o `quarkus:dev` não sobe — a tela em `/auth/login` passava
a ser o erro “Error restarting Quarkus”.

---

## Revisão pontual — Entrar não abre o IdP no `ng serve` (06/09/2026)

Modo **quick** nos arquivos desta correção: `application.properties`,
`SessionCookiePolicy.java`, `SessionCookieSettings.java`,
`BffSessionCookieFilter.java`, `CsrfResource.java`,
`SecurityBoundaryFilter.java`, `UserResource.java`,
`infra/keycloak/render-realm.sh`, `docker-compose.override.example.yml`,
`frontend/proxy.conf.json`.

Nenhum CRÍTICO/ALTO novo em produção. `%prod` continua com OIDC, cookie
`__Host-` e hostname público via Caddy. Causa raiz local: `%dev` tinha
`quarkus.oidc.enabled=false`, então `GET /auth/login` respondia 303 para
`/app/inicio` sem sessão e o `authGuard` devolvia `/entrar`. O Keycloak
também crashava (`/opt/keycloak/data/import` inexistente) e não publicava
`8180` no host. O `%dev` agora inicia o code flow em
`http://localhost:8180`, o override publica essa porta, o proxy envia
`X-Forwarded-Host: localhost:4200` e o cookie CSRF local é `folhea_session`
(HTTP não aceita `__Host-`). `NotAuthorizedExceptionMapper` não pode
engolir `UnauthorizedException` em `/auth/*` como problem+json — isso
transformava o challenge OIDC (302) em 401 e o botão Entrar parecia morto.
No `%dev` o mapper reencaminha o `ChallengeData` do `HttpAuthenticator`. A
substituição do secret no realm usa `sed` (a imagem Keycloak não tem gettext);
`&` e `\\` no valor são escapados no script gerado (`scripts/tests/test-render-realm.sh`).

---

## Revisão pontual — SCRAM sem senha no `quarkus:dev` (07/09/2026)

Modo **quick** nos arquivos desta correção: `scripts/dev-backend.sh`,
`scripts/tests/test-dev-backend.sh`, `backend/.gitignore`,
`docker-compose.yml`.

Nenhum CRÍTICO/ALTO novo. Causa raiz confirmada em runtime: `./mvnw quarkus:dev`
foi iniciado em `backend/`, onde não havia `.env`. O Quarkus lê `.env` só do
diretório de trabalho; `quarkus.datasource.password=${DB_PASSWORD:}` resolveu
para vazio e o Postgres em `localhost:5433` recusou SCRAM. O Flyway falhou no
start e o proxy do `ng serve` mostrou o stack trace em `/auth/login`.

O `dev-backend.sh` agora cria `backend/.env` → `../.env` quando o caminho
está ausente, mantém o symlink correto, substitui um symlink apontando para
outro alvo e avisa sem sobrescrever se o alvo já é um arquivo regular. O link é gitignored. O healthcheck do Keycloak deixou de
usar `wget` (ausente na imagem `quay.io/keycloak/keycloak:26.7.3`) e passou a
sondar `127.0.0.1:9000/health/ready` via `/dev/tcp` em bash; `$line` no
Compose é escapado como `$$line`. Quatorze containers `postgres:18` órfãos de
Testcontainers (label `org.testcontainers=true`) foram removidos da
workstation; não entram no repositório.

