import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BookProgressComponent } from '../books/book-progress.component';
import { BookCoverComponent } from '../books/book-cover.component';
import { DashboardStore } from '../../core/state/dashboard.store';
import { notFutureDateValidator, readingSessionValidator, wholeNumberValidator } from './reading-session.validator';
import { MAX_SESSION_MINUTES, MAX_SESSION_PAGES } from './reading-limits';

@Component({ selector: 'folhea-reading', standalone: true, imports: [ReactiveFormsModule, RouterLink, BookProgressComponent, BookCoverComponent], changeDetection: ChangeDetectionStrategy.OnPush, template: `
  <div class="form-page"><a routerLink="/app/inicio" class="back-link">← Início</a><p class="eyebrow">Mais uma página</p><h1>Registrar leitura</h1><p class="intro">Um registro rápido para manter seu ritmo visível.</p>@if (store.booksError(); as error) { <div class="alert alert-error" role="alert">{{ error }} <button class="dismiss" type="button" (click)="store.loadBooks()">Tentar novamente</button></div> }@if (store.sessionsError(); as error) { <div class="alert alert-error" role="alert">{{ error }} A leitura precisa de conexão para sincronizar. <button class="dismiss" type="button" (click)="store.loadSessions()">Tentar novamente</button></div> } @if (store.booksLoading() && store.books().length === 0) { <div class="loading surface" role="status"><span class="spinner"></span> Carregando livros…</div> } @else if (store.books().length === 0) { <section class="empty surface"><h2>Cadastre um livro primeiro.</h2><a routerLink="/app/livros/novo" class="button button-primary">Cadastrar livro</a></section> } @else { <form class="surface form-card" [formGroup]="form" (ngSubmit)="submit()" novalidate><div class="field"><label for="reading-book">Livro</label><select id="reading-book" formControlName="bookId" [attr.aria-invalid]="form.controls.bookId.invalid && form.controls.bookId.touched" [attr.aria-describedby]="form.controls.bookId.invalid && form.controls.bookId.touched ? 'reading-book-error' : null"><option value="" disabled>Escolha um livro</option>@for (book of store.selectableBooks(); track book.id) { <option [value]="book.id">{{ book.title }}</option> }</select>@if (form.controls.bookId.invalid && form.controls.bookId.touched) { <span id="reading-book-error" class="field-error">Escolha um livro.</span> }</div>@if (store.booksHasMore()) { <button class="button button-secondary" type="button" [disabled]="store.booksLoading()" (click)="store.loadMoreBooks()">Carregar mais livros</button> }@if (store.getBook(form.controls.bookId.value); as selectedBook) { <section class="selected-book" aria-label="Progresso do livro selecionado"><folhea-book-cover [book]="selectedBook" /><folhea-book-progress [book]="selectedBook" /></section> }<div class="field-row"><div class="field"><label for="reading-pages">Páginas <span class="optional">opcional</span></label><input id="reading-pages" type="number" min="0" [max]="maxPages" inputmode="numeric" formControlName="pages" placeholder="32" [attr.aria-invalid]="pages.invalid && pages.touched" [attr.aria-describedby]="pages.invalid && pages.touched ? 'reading-pages-error' : null" />@if (pages.invalid && pages.touched) { <span id="reading-pages-error" class="field-error">Use um valor entre 0 e {{ maxPages }}.</span> }</div><div class="field"><label for="reading-minutes">Minutos <span class="optional">opcional</span></label><input id="reading-minutes" type="number" min="0" [max]="maxMinutes" inputmode="numeric" formControlName="minutes" placeholder="25" [attr.aria-invalid]="minutes.invalid && minutes.touched" [attr.aria-describedby]="minutes.invalid && minutes.touched ? 'reading-minutes-error' : null" />@if (minutes.invalid && minutes.touched) { <span id="reading-minutes-error" class="field-error">Use um valor entre 0 e {{ maxMinutes }}.</span> }</div></div><div class="field"><label for="reading-date">Data</label><input id="reading-date" type="date" [max]="store.today()" formControlName="readingDate" [attr.aria-invalid]="form.controls.readingDate.invalid && form.controls.readingDate.touched" aria-describedby="reading-date-hint" />@if (form.controls.readingDate.invalid && form.controls.readingDate.touched) { <span class="field-error" role="alert">Informe uma data válida até hoje.</span> }<span id="reading-date-hint" class="hint">A data usa o fuso horário da sua conta.</span></div>@if (form.hasError('emptyReading') && form.touched) { <div id="reading-empty-error" class="alert alert-error" role="alert">Informe páginas ou minutos para registrar a sessão.</div> }<button type="submit" class="button button-primary" [disabled]="busy()">{{ busy() ? 'Registrando…' : 'Registrar leitura' }} <span aria-hidden="true">→</span></button></form> }
`, styles: [`:host{display:block}.form-page{max-width:34rem}.back-link{display:inline-block;margin-bottom:3rem;color:var(--forest-800);font-size:.8rem;font-weight:750}.form-page h1{margin:.65rem 0 .8rem;color:var(--forest-950);font-family:Georgia,serif;font-size:clamp(2.5rem,9vw,4.2rem);line-height:.98;letter-spacing:-.05em}.intro{margin:0 0 1.75rem;color:var(--muted);line-height:1.55}.form-card{display:grid;gap:1.15rem;padding:1.25rem}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.field .optional,.hint{color:var(--muted);font-size:.72rem;font-weight:500}.hint{font-weight:400}.selected-book{display:flex;align-items:start;gap:1rem;padding:.75rem 0;border-block:1px solid var(--cream-200)}.selected-book folhea-book-progress{flex:1;min-width:0}.form-card .button{margin-top:.4rem}.empty{display:grid;justify-items:center;gap:1rem;padding:2rem;text-align:center}.empty h2{margin:0;color:var(--forest-950);font-family:Georgia,serif;font-size:1.35rem}`] })
export class ReadingComponent {
  private readonly fb = inject(NonNullableFormBuilder); private readonly router = inject(Router); readonly store = inject(DashboardStore);
  private readonly route = inject(ActivatedRoute);
  readonly today = this.store.today();
  readonly busy = signal(false);
  readonly maxPages = MAX_SESSION_PAGES;
  readonly maxMinutes = MAX_SESSION_MINUTES;
  readonly form = this.fb.group({ bookId: ['', Validators.required], readingDate: [this.today, [Validators.required, notFutureDateValidator(() => this.store.today())]], pages: [0, [Validators.min(0), Validators.max(MAX_SESSION_PAGES), wholeNumberValidator]], minutes: [0, [Validators.min(0), Validators.max(MAX_SESSION_MINUTES), wholeNumberValidator]] }, { validators: readingSessionValidator });
  get pages() { return this.form.controls.pages; } get minutes() { return this.form.controls.minutes; }
  constructor() {
    const linkedBook = this.route.snapshot.queryParamMap.get('bookId');
    if (linkedBook) this.store.loadBook(linkedBook);
    effect(() => {
      const preferred = this.route.snapshot.queryParamMap.get('bookId') ?? this.store.currentBook()?.id ?? this.store.selectableBooks()[0]?.id;
      if (!this.form.controls.bookId.value && preferred && this.store.getBook(preferred)) this.form.controls.bookId.setValue(preferred);
    });
  }
  submit(): void {
    if (this.busy()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.store.addSession({
      bookId: this.form.controls.bookId.value,
      readingDate: this.form.controls.readingDate.value,
      pages: this.pages.value ?? 0,
      minutes: this.minutes.value ?? 0
    }).subscribe({
      next: (session) => void this.router.navigate(['/app/ler/feedback'], { state: { pages: session.pages, minutes: session.minutes } }),
      error: () => this.busy.set(false)
    });
  }
}
