import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DashboardStore } from '../../core/state/dashboard.store';
import { wholeNumberValidator } from '../reading/reading-session.validator';
import { CoverPickerComponent, CoverSelection } from './cover-picker.component';

@Component({ selector: 'folhea-new-book', standalone: true, imports: [ReactiveFormsModule, RouterLink, CoverPickerComponent], changeDetection: ChangeDetectionStrategy.OnPush, template: `
  <div class="form-page">
    <a routerLink="/app/livros" class="back-link">← Seus livros</a><p class="eyebrow">Sua estante</p>
    <h1>Qual livro está com você?</h1><p class="intro">Guarde os detalhes do livro e acompanhe cada página da sua leitura.</p>
    <form class="surface form-card" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="field"><label for="book-title">Título <span aria-hidden="true">*</span></label><input id="book-title" formControlName="title" placeholder="Ex.: O Hobbit" autocomplete="off" maxlength="500" [attr.aria-invalid]="title.invalid && title.touched" [attr.aria-describedby]="title.invalid && title.touched ? 'book-title-error' : null" />@if (title.invalid && title.touched) { <span id="book-title-error" class="field-error">Dê um título ao seu livro.</span> }</div>
      <div class="field"><label for="book-author">Autor <span class="optional">opcional</span></label><input id="book-author" formControlName="author" placeholder="Ex.: J. R. R. Tolkien" autocomplete="off" maxlength="500" /></div>
      <div class="field-row"><div class="field"><label for="book-edition">Edição <span class="optional">opcional</span></label><input id="book-edition" formControlName="edition" placeholder="Ex.: 2ª edição" autocomplete="off" maxlength="200" /></div>
        <div class="field"><label for="book-total-pages">Total de páginas <span aria-hidden="true">*</span></label><input id="book-total-pages" type="number" min="1" max="1000000" step="1" inputmode="numeric" formControlName="totalPages" [attr.aria-invalid]="totalPages.invalid && totalPages.touched" [attr.aria-describedby]="totalPages.invalid && totalPages.touched ? 'book-total-pages-error' : null" />@if (totalPages.invalid && totalPages.touched) { <span id="book-total-pages-error" class="field-error">Informe um total inteiro entre 1 e 1.000.000.</span> }</div>
      </div>
      <folhea-cover-picker [disabled]="busy()" (selectionChange)="cover.set($event)" />
      @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
      <button type="submit" class="button button-primary" [disabled]="busy() || cover().preparing">{{ busy() ? 'Adicionando…' : 'Adicionar livro' }} <span aria-hidden="true">→</span></button>
    </form>
  </div>
`, styles: [`:host{display:block}.form-page{max-width:38rem}.back-link{display:inline-block;margin-bottom:3rem;color:var(--forest-800);font-size:.8rem;font-weight:750}.form-page h1{margin:.65rem 0 .8rem;color:var(--forest-950);font-family:Georgia,serif;font-size:clamp(2.5rem,9vw,4.2rem);line-height:.98;letter-spacing:-.05em}.intro{margin:0 0 1.75rem;color:var(--muted);line-height:1.55}.form-card{display:grid;gap:1.2rem;padding:1.25rem}.field .optional{color:var(--muted);font-size:.72rem;font-weight:500}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.form-card .button{margin-top:.4rem}@media(max-width:480px){.field-row{grid-template-columns:1fr}}`] })
export class NewBookComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly store = inject(DashboardStore);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly cover = signal<CoverSelection>({ file: null, preparing: false, error: null });
  readonly form = this.fb.group({ title: ['', [Validators.required, Validators.maxLength(500)]], author: ['', Validators.maxLength(500)], edition: ['', Validators.maxLength(200)], totalPages: this.fb.control<number | null>(null, [Validators.required, Validators.min(1), Validators.max(1000000), wholeNumberValidator]) });
  get title() { return this.form.controls.title; }
  get totalPages() { return this.form.controls.totalPages; }
  submit(): void {
    if (this.busy() || this.cover().preparing || this.cover().error) return;
    this.form.markAllAsTouched();
    const title = this.title.value.trim();
    if (!title) { this.title.setErrors({ required: true }); return; }
    if (!this.form.valid) return;
    this.busy.set(true); this.error.set(null);
    this.store.addBook({ title, author: this.form.controls.author.value.trim() || null, edition: this.form.controls.edition.value.trim() || null, totalPages: this.totalPages.value }, this.cover().file ?? undefined).subscribe({
      next: () => void this.router.navigate(['/app/livros']),
      error: () => { this.busy.set(false); this.error.set(this.store.error() ?? 'Não foi possível adicionar o livro. Tente novamente.'); }
    });
  }
}
