import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DashboardStore } from '../../core/state/dashboard.store';
import { BookProgressComponent } from '../books/book-progress.component';
import { notFutureDateValidator, readingSessionValidator, wholeNumberValidator } from './reading-session.validator';
import { MAX_SESSION_MINUTES, MAX_SESSION_PAGES } from './reading-limits';

@Component({
  selector: 'folhea-edit-session',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, BookProgressComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.sessionsError(); as error) { <div class="alert alert-error" role="alert">{{ error }} <button type="button" class="dismiss" (click)="retry()">Tentar novamente</button></div> }
    @if (session() && !store.getBook(session()?.bookId)) {
      @if (store.booksError(); as error) { <div class="alert alert-error" role="alert">{{ error }} <button type="button" class="dismiss" (click)="retry()">Tentar novamente</button></div> }
    }
    @if ((store.sessionsLoading() || store.sessionDetailLoading()) && !session()) {
      <div class="loading surface" role="status">Carregando sessão…</div>
    } @else if (session(); as currentSession) {
      <div class="form-page"><a routerLink="/app/progresso" class="back-link">← Seu progresso</a><p class="eyebrow">Ajustar registro</p><h1>Editar leitura</h1><p class="intro">Corrija os dados da sessão. Suas métricas serão atualizadas na hora.</p>
        <form class="surface form-card" [formGroup]="form" (ngSubmit)="save()" novalidate>
          <div class="field"><label for="edit-book">Livro</label><select id="edit-book" formControlName="bookId" [attr.aria-invalid]="form.controls.bookId.invalid && form.controls.bookId.touched" [attr.aria-describedby]="form.controls.bookId.invalid && form.controls.bookId.touched ? 'edit-book-error' : null"><option value="" disabled>Escolha um livro</option>@for (book of store.selectableBooks(); track book.id) { <option [value]="book.id">{{ book.title }}</option> }</select>@if (form.controls.bookId.invalid && form.controls.bookId.touched) { <span id="edit-book-error" class="field-error">Escolha um livro.</span> }</div>
          @if (store.getBook(form.controls.bookId.value); as selectedBook) { <section aria-label="Progresso do livro selecionado"><folhea-book-progress [book]="selectedBook" /></section> }
          @if (store.booksHasMore()) { <button class="button button-secondary" type="button" [disabled]="store.booksLoading()" (click)="store.loadMoreBooks()">Carregar mais livros</button> }<div class="field-row"><div class="field"><label for="edit-pages">Páginas</label><input id="edit-pages" type="number" min="0" [max]="maxPages" inputmode="numeric" formControlName="pages" [attr.aria-invalid]="pages.invalid && pages.touched" [attr.aria-describedby]="pages.invalid && pages.touched ? 'edit-pages-error' : null" />@if (pages.invalid && pages.touched) { <span id="edit-pages-error" class="field-error">Use um valor entre 0 e {{ maxPages }}.</span> }</div><div class="field"><label for="edit-minutes">Minutos</label><input id="edit-minutes" type="number" min="0" [max]="maxMinutes" inputmode="numeric" formControlName="minutes" [attr.aria-invalid]="minutes.invalid && minutes.touched" [attr.aria-describedby]="minutes.invalid && minutes.touched ? 'edit-minutes-error' : null" />@if (minutes.invalid && minutes.touched) { <span id="edit-minutes-error" class="field-error">Use um valor entre 0 e {{ maxMinutes }}.</span> }</div></div>
          @if (form.hasError('emptyReading') && form.touched) { <div class="alert alert-error" role="alert">Informe páginas ou minutos para manter o registro.</div> }
          <div class="field"><label for="edit-date">Data</label><input id="edit-date" type="date" [max]="store.today()" formControlName="readingDate" [attr.aria-invalid]="form.controls.readingDate.invalid && form.controls.readingDate.touched" />@if (form.controls.readingDate.invalid && form.controls.readingDate.touched) { <span class="field-error" role="alert">Informe uma data válida até hoje.</span> }</div>
          <button class="button button-primary" type="submit" [disabled]="busy()">{{ busy() ? 'Salvando…' : 'Salvar registro' }}</button>
        </form>
        <button class="button button-danger delete-button" type="button" (click)="remove()" [disabled]="busy()">Excluir esta sessão</button>
      </div>
    } @else { <section class="empty surface"><h1>Sessão não encontrada</h1><a routerLink="/app/progresso" class="button button-primary">Voltar para progresso</a></section> }
  `,
  styles: [`:host{display:block}.form-page{max-width:34rem}.back-link{display:inline-block;margin-bottom:3rem;color:var(--forest-800);font-size:.8rem;font-weight:750}.form-page h1{margin:.65rem 0 .8rem;color:var(--forest-950);font-family:Georgia,serif;font-size:clamp(2.5rem,9vw,4.2rem);line-height:.98;letter-spacing:-.05em}.intro{margin:0 0 1.75rem;color:var(--muted);line-height:1.55}.form-card{display:grid;gap:1.15rem;padding:1.25rem}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.delete-button{margin-top:1.25rem}.empty{display:grid;justify-items:center;gap:1rem;padding:3rem;text-align:center}.empty h1{color:var(--forest-950);font-family:Georgia,serif}`]
})
export class EditSessionComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly store = inject(DashboardStore);
  readonly id = this.route.snapshot.paramMap.get('id');
  readonly session = computed(() => this.store.getSession(this.id));
  readonly busy = signal(false);
  readonly maxPages = MAX_SESSION_PAGES;
  readonly maxMinutes = MAX_SESSION_MINUTES;
  readonly form = this.fb.group({ bookId: ['', Validators.required], readingDate: [this.store.today(), [Validators.required, notFutureDateValidator(() => this.store.today())]], pages: [0, [Validators.min(0), Validators.max(MAX_SESSION_PAGES), wholeNumberValidator]], minutes: [0, [Validators.min(0), Validators.max(MAX_SESSION_MINUTES), wholeNumberValidator]] }, { validators: readingSessionValidator });
  get pages() { return this.form.controls.pages; }
  get minutes() { return this.form.controls.minutes; }

  constructor() {
    this.retry();
    effect(() => {
      const current = this.session();
      if (current && this.form.pristine) this.form.setValue({ bookId: current.bookId, readingDate: current.readingDate, pages: current.pages, minutes: current.minutes });
    });
  }

  retry(): void { if (this.id) this.store.loadSession(this.id); }

  save(): void {
    if (this.busy()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid || !this.id) return;
    this.busy.set(true);
    const raw = this.form.getRawValue();
    this.store.updateSession(this.id, { ...raw, pages: raw.pages ?? 0, minutes: raw.minutes ?? 0 }).subscribe({
      next: () => void this.router.navigate(['/app/progresso']),
      error: () => this.busy.set(false)
    });
  }

  remove(): void {
    if (this.busy() || !this.id || !window.confirm('Excluir este registro de leitura?')) return;
    this.busy.set(true);
    this.store.deleteSession(this.id).subscribe({
      next: () => void this.router.navigate(['/app/progresso']),
      error: () => this.busy.set(false)
    });
  }
}
