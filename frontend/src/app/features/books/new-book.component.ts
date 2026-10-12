import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Book } from '../../core/models/models';
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
        <div class="field"><label for="book-total-pages">Total de páginas <span class="optional">opcional</span></label><input id="book-total-pages" type="number" min="1" step="1" inputmode="numeric" formControlName="totalPages" [attr.aria-invalid]="totalPages.invalid && totalPages.touched" [attr.aria-describedby]="totalPages.invalid && totalPages.touched ? 'book-total-pages-error' : null" />@if (totalPages.invalid && totalPages.touched) { <span id="book-total-pages-error" class="field-error">Informe um total inteiro positivo.</span> }</div>
      </div>
      <folhea-cover-picker [disabled]="busy()" (selectionChange)="cover.set($event)" />
      @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
      <button type="submit" class="button button-primary" [disabled]="busy() || cover().preparing">{{ busy() ? (savedBook() ? 'Enviando foto…' : 'Adicionando…') : (savedBook() ? 'Tentar enviar foto novamente' : 'Adicionar livro') }} <span aria-hidden="true">→</span></button>
      @if (savedBook() && !busy()) { <button type="button" class="button button-quiet" (click)="continueWithoutPhoto()">Continuar sem foto</button> }
    </form>
  </div>
`, styles: [`:host{display:block}.form-page{max-width:38rem}.back-link{display:inline-block;margin-bottom:3rem;color:var(--forest-800);font-size:.8rem;font-weight:750}.form-page h1{margin:.65rem 0 .8rem;color:var(--forest-950);font-family:Georgia,serif;font-size:clamp(2.5rem,9vw,4.2rem);line-height:.98;letter-spacing:-.05em}.intro{margin:0 0 1.75rem;color:var(--muted);line-height:1.55}.form-card{display:grid;gap:1.2rem;padding:1.25rem}.field .optional{color:var(--muted);font-size:.72rem;font-weight:500}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.form-card .button{margin-top:.4rem}@media(max-width:480px){.field-row{grid-template-columns:1fr}}`] })
export class NewBookComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly store = inject(DashboardStore);
  private readonly destroyRef = inject(DestroyRef);
  readonly savedBook = signal<Book | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly cover = signal<CoverSelection>({ file: null, preparing: false, error: null });
  readonly form = this.fb.group({ title: ['', [Validators.required, Validators.maxLength(500)]], author: ['', Validators.maxLength(500)], edition: ['', Validators.maxLength(200)], totalPages: this.fb.control<number | null>(null, [Validators.min(1), wholeNumberValidator]) });
  get title() { return this.form.controls.title; }
  get totalPages() { return this.form.controls.totalPages; }
  submit(): void {
    if (this.busy() || this.cover().preparing || this.cover().error) return;
    if (this.savedBook()) { this.retryPhoto(); return; }
    this.form.markAllAsTouched();
    const title = this.title.value.trim();
    if (!title) { this.title.setErrors({ required: true }); return; }
    if (!this.form.valid) return;
    this.busy.set(true); this.error.set(null);
    this.store.addBook({ title, author: this.form.controls.author.value.trim() || null, edition: this.form.controls.edition.value.trim() || null, totalPages: this.totalPages.value }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (book) => {
        this.savedBook.set(book); this.form.disable({ emitEvent: false }); this.busy.set(false);
        if (this.cover().file) this.retryPhoto(); else this.continueWithoutPhoto();
      },
      error: () => { this.busy.set(false); this.error.set(this.store.error() ?? 'Não foi possível adicionar o livro. Tente novamente.'); }
    });
  }
  retryPhoto(): void {
    const book = this.savedBook(), file = this.cover().file;
    if (this.busy() || this.cover().preparing || this.cover().error || !book || !file) return;
    this.busy.set(true); this.error.set(null);
    this.store.uploadBookPhoto(book.id, file).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.busy.set(false); void this.router.navigate(['/app/livros']); },
      error: () => { this.busy.set(false); this.error.set('Livro salvo. Não foi possível enviar a foto. Tente enviar novamente ou continue sem foto.'); }
    });
  }
  continueWithoutPhoto(): void { if (!this.busy() && this.savedBook()) void this.router.navigate(['/app/livros']); }
}
