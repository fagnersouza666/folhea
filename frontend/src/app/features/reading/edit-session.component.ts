import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DashboardStore } from '../../core/state/dashboard.store';
import { readingSessionValidator } from './reading-session.validator';

@Component({
  selector: 'folhea-edit-session',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session(); as currentSession) {
      <div class="form-page"><a routerLink="/app/progresso" class="back-link">← Seu progresso</a><p class="eyebrow">Ajustar registro</p><h1>Editar leitura</h1><p class="intro">Corrija os dados da sessão. Suas métricas serão atualizadas na hora.</p>
        <form class="surface form-card" [formGroup]="form" (ngSubmit)="save()" novalidate>
          <label class="field" for="edit-book">Livro<select id="edit-book" formControlName="bookId" [attr.aria-invalid]="form.controls.bookId.invalid && form.controls.bookId.touched" [attr.aria-describedby]="form.controls.bookId.invalid && form.controls.bookId.touched ? 'edit-book-error' : null"><option value="" disabled>Escolha um livro</option>@for (book of store.books(); track book.id) { <option [value]="book.id">{{ book.title }}</option> }</select>@if (form.controls.bookId.invalid && form.controls.bookId.touched) { <span id="edit-book-error" class="field-error">Escolha um livro.</span> }</label>
          <div class="field-row"><label class="field" for="edit-pages">Páginas<input id="edit-pages" type="number" min="0" inputmode="numeric" formControlName="pages" [attr.aria-invalid]="pages.invalid && pages.touched" [attr.aria-describedby]="pages.invalid && pages.touched ? 'edit-pages-error' : null" />@if (pages.invalid && pages.touched) { <span id="edit-pages-error" class="field-error">Use zero ou um número positivo.</span> }</label><label class="field" for="edit-minutes">Minutos<input id="edit-minutes" type="number" min="0" inputmode="numeric" formControlName="minutes" [attr.aria-invalid]="minutes.invalid && minutes.touched" [attr.aria-describedby]="minutes.invalid && minutes.touched ? 'edit-minutes-error' : null" />@if (minutes.invalid && minutes.touched) { <span id="edit-minutes-error" class="field-error">Use zero ou um número positivo.</span> }</label></div>
          @if (form.hasError('emptyReading') && form.touched) { <div class="alert alert-error" role="alert">Informe páginas ou minutos para manter o registro.</div> }
          <label class="field" for="edit-date">Data<input id="edit-date" type="date" formControlName="readingDate" /></label>
          <button class="button button-primary" type="submit">Salvar registro</button>
        </form>
        <button class="button button-danger delete-button" type="button" (click)="remove()">Excluir esta sessão</button>
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
  readonly form = this.fb.group({ bookId: ['', Validators.required], readingDate: [this.store.today(), Validators.required], pages: [0, [Validators.min(0)]], minutes: [0, [Validators.min(0)]] }, { validators: readingSessionValidator });
  get pages() { return this.form.controls.pages; }
  get minutes() { return this.form.controls.minutes; }

  constructor() {
    effect(() => {
      const current = this.session();
      if (current && this.form.pristine) this.form.setValue({ bookId: current.bookId, readingDate: current.readingDate, pages: current.pages, minutes: current.minutes });
    });
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || !this.id) return;
    this.store.updateSession(this.id, this.form.getRawValue());
    void this.router.navigate(['/app/progresso']);
  }

  remove(): void {
    if (!this.id || !window.confirm('Excluir este registro de leitura?')) return;
    this.store.deleteSession(this.id);
    void this.router.navigate(['/app/progresso']);
  }
}
