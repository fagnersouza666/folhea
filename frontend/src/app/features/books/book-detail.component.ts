import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DashboardStore } from '../../core/state/dashboard.store';

@Component({
  selector: 'folhea-book-detail',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (book(); as currentBook) {
      <div class="detail-page">
        <a routerLink="/app/livros" class="back-link">← Seus livros</a>
        <div class="detail-heading"><div class="book-thumb" aria-hidden="true">{{ currentBook.title[0] }}</div><div><p class="eyebrow">Livro</p><h1>{{ currentBook.title }}</h1><p class="muted">{{ currentBook.status === 'FINISHED' ? 'Finalizado' : 'Lendo agora' }}</p></div></div>
        <form class="surface form-card" [formGroup]="form" (ngSubmit)="save()" novalidate>
          <label class="field">Título<input formControlName="title" [attr.aria-invalid]="title.invalid && title.touched" />@if (title.invalid && title.touched) { <span class="field-error">Dê um título ao seu livro.</span> }</label>
          <label class="field">Autor <span class="optional">opcional</span><input formControlName="author" /></label>
          <button class="button button-primary" type="submit">Salvar alterações</button>
        </form>
        <section class="actions surface" aria-labelledby="book-actions-title">
          <h2 id="book-actions-title">Ações do livro</h2>
          @if (currentBook.status === 'READING') { <button class="button button-secondary" type="button" (click)="finish()">Marcar como finalizado</button> } @else { <button class="button button-secondary" type="button" (click)="reopen()">Reabrir livro</button> }
          <button class="button button-danger" type="button" (click)="remove()">Excluir livro</button>
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
  readonly form = this.fb.group({ title: ['', Validators.required], author: [''] });
  get title() { return this.form.controls.title; }

  constructor() {
    effect(() => {
      const current = this.book();
      if (current && this.form.pristine) this.form.setValue({ title: current.title, author: current.author ?? '' });
    });
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || !this.id) return;
    this.store.updateBook(this.id, { title: this.title.value.trim(), author: this.form.controls.author.value.trim() });
  }

  finish(): void { if (this.id) this.store.finishBook(this.id); }
  reopen(): void { if (this.id) this.store.reopenBook(this.id); }
  remove(): void {
    if (!this.id || !window.confirm('Excluir este livro e suas sessões?')) return;
    this.store.deleteBook(this.id);
    void this.router.navigate(['/app/livros']);
  }
}
