import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { notFutureDateValidator } from '../reading/reading-session.validator';
import { DashboardStore } from '../../core/state/dashboard.store';

@Component({
  selector: 'folhea-book-detail',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.booksError(); as error) { <div class="alert alert-error" role="alert">{{ error }} <button type="button" class="dismiss" (click)="retry()">Tentar novamente</button></div> }
    @if ((store.booksLoading() || store.bookDetailLoading()) && !book()) {
      <div class="loading surface" role="status">Carregando livro…</div>
    } @else if (book(); as currentBook) {
      <div class="detail-page">
        <a routerLink="/app/livros" class="back-link">← Seus livros</a>
        <div class="detail-heading"><div class="book-thumb" aria-hidden="true">{{ currentBook.title[0] }}</div><div><p class="eyebrow">Livro</p><h1>{{ currentBook.title }}</h1><p class="muted">{{ currentBook.status === 'FINISHED' ? 'Finalizado' : 'Lendo agora' }}</p></div></div>
        @if (message()) { <p class="alert alert-success" role="status">{{ message() }}</p> }<form class="surface form-card" [formGroup]="form" (ngSubmit)="save()" novalidate>
          <div class="field"><label for="detail-book-title">Título</label><input id="detail-book-title" formControlName="title" maxlength="500" [attr.aria-invalid]="title.invalid && title.touched" [attr.aria-describedby]="title.invalid && title.touched ? 'detail-book-title-error' : null" />@if (title.invalid && title.touched) { <span id="detail-book-title-error" class="field-error">Dê um título ao seu livro.</span> }</div>
          <div class="field"><label for="detail-book-author">Autor <span class="optional">opcional</span></label><input id="detail-book-author" formControlName="author" maxlength="500" /></div>
          <button class="button button-primary" type="submit" [disabled]="busy()">{{ busy() ? 'Salvando…' : 'Salvar alterações' }}</button>
        </form>
        <section class="actions surface" aria-labelledby="book-actions-title">
          <h2 id="book-actions-title">Ações do livro</h2>
          @if (currentBook.status === 'READING') { <div class="field"><label for="finished-date">Data da finalização</label><input id="finished-date" type="date" [max]="store.today()" [formControl]="finishedOn" [attr.aria-invalid]="finishedOn.invalid && finishedOn.touched" />@if (finishedOn.invalid && finishedOn.touched) { <span class="field-error" role="alert">Informe uma data válida até hoje.</span> }</div><button class="button button-secondary" type="button" (click)="finish()" [disabled]="busy()">Marcar como finalizado</button> } @else { <button class="button button-secondary" type="button" (click)="reopen()" [disabled]="busy()">Reabrir livro</button> }
          <button class="button button-danger" type="button" (click)="remove()" [disabled]="busy()">Excluir livro</button>
        </section>
      </div>
    } @else {
      <section class="empty surface"><h1>Livro não encontrado</h1><p>Esse livro pode ter sido removido ou não pertence à sua biblioteca.</p><a class="button button-primary" routerLink="/app/livros">Voltar para livros</a></section>
    }
  `,
  styles: [`
    :host{display:block}.detail-page{max-width:38rem}.back-link{display:inline-block;margin-bottom:2.5rem;color:var(--forest-800);font-size:.8rem;font-weight:750}.detail-heading{display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem}.book-thumb{display:grid;flex:none;place-items:center;width:4.5rem;height:6rem;border-radius:.45rem .8rem .8rem .45rem;color:var(--forest-950);background:var(--amber);font-family:Georgia,serif;font-size:2.2rem;box-shadow:inset .4rem 0 rgb(185 115 53 / 25%)}.detail-heading h1{margin:.35rem 0 .25rem;color:var(--forest-950);font-family:Georgia,serif;font-size:clamp(2.2rem,8vw,3.6rem);line-height:1;letter-spacing:-.05em}.muted{margin:0;color:var(--muted);font-size:.85rem}.form-card{display:grid;gap:1.1rem;padding:1.25rem}.field .optional,.hint{color:var(--muted);font-size:.72rem;font-weight:500}.actions{display:grid;gap:.8rem;margin-top:1rem;padding:1.25rem}.actions h2{margin:0 0 .25rem;color:var(--forest-950);font-family:Georgia,serif;font-size:1.25rem}.empty{display:grid;justify-items:center;padding:3rem 1.5rem;text-align:center}.empty h1{color:var(--forest-950);font-family:Georgia,serif}.empty p{color:var(--muted);line-height:1.5}
  `]
})
export class BookDetailComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly store = inject(DashboardStore);
  readonly id = this.route.snapshot.paramMap.get('id');
  readonly book = computed(() => this.store.getBook(this.id));
  readonly busy = signal(false);
  readonly message = signal<string | null>(null);
  readonly finishedOn = new FormControl(this.store.today(), { nonNullable: true, validators: [Validators.required, notFutureDateValidator(() => this.store.today())] });
  readonly form = this.fb.group({ title: ['', [Validators.required, Validators.maxLength(500)]], author: ['', Validators.maxLength(500)] });
  get title() { return this.form.controls.title; }

  constructor() {
    this.retry();
    effect(() => {
      const current = this.book();
      if (current && this.form.pristine) this.form.setValue({ title: current.title, author: current.author ?? '' });
    });
  }

  retry(): void { if (this.id) this.store.loadBook(this.id); }

  save(): void {
    if (this.busy()) return;
    this.form.markAllAsTouched();
    const title = this.title.value.trim();
    if (!title) { this.title.setErrors({ required: true }); return; }
    if (this.form.invalid || !this.id) return;
    this.run(this.store.updateBook(this.id, { title, author: this.form.controls.author.value.trim() }), 'Alterações salvas.');
  }

  finish(): void {
    this.finishedOn.markAsTouched();
    if (this.id && this.finishedOn.valid) this.run(this.store.finishBook(this.id, this.finishedOn.value), 'Livro finalizado.');
  }
  reopen(): void { if (this.id) this.run(this.store.reopenBook(this.id), 'Livro reaberto.'); }
  remove(): void {
    if (this.busy() || !this.id || !window.confirm('Excluir este livro e suas sessões?')) return;
    this.busy.set(true);
    this.store.deleteBook(this.id).subscribe({
      next: () => void this.router.navigate(['/app/livros']),
      error: () => this.busy.set(false)
    });
  }

  private run(action: Observable<unknown>, success: string): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set(null);
    action.subscribe({
      next: () => { this.busy.set(false); this.message.set(success); this.form.markAsPristine(); },
      error: () => this.busy.set(false)
    });
  }
}
