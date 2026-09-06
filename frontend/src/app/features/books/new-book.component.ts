import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DashboardStore } from '../../core/state/dashboard.store';

@Component({ selector: 'folhea-new-book', standalone: true, imports: [ReactiveFormsModule, RouterLink], changeDetection: ChangeDetectionStrategy.OnPush, template: `
  <div class="form-page"><a routerLink="/app/livros" class="back-link">← Seus livros</a><p class="eyebrow">Primeiro passo</p><h1>Qual livro está com você?</h1><p class="intro">Cadastre só o essencial. Você pode editar depois.</p><form class="surface form-card" [formGroup]="form" (ngSubmit)="submit()" novalidate><label class="field">Título <span aria-hidden="true">*</span><input formControlName="title" placeholder="Ex.: O Hobbit" autocomplete="off" [attr.aria-invalid]="title.invalid && title.touched" />@if (title.invalid && title.touched) { <span class="field-error">Dê um título ao seu livro.</span> }</label><label class="field">Autor <span class="optional">opcional</span><input formControlName="author" placeholder="Ex.: J. R. R. Tolkien" autocomplete="off" /></label><button type="submit" class="button button-primary">Adicionar livro <span aria-hidden="true">→</span></button></form></div>
`, styles: [`:host{display:block}.form-page{max-width:34rem}.back-link{display:inline-block;margin-bottom:3rem;color:var(--forest-800);font-size:.8rem;font-weight:750}.form-page h1{margin:.65rem 0 .8rem;color:var(--forest-950);font-family:Georgia,serif;font-size:clamp(2.5rem,9vw,4.2rem);line-height:.98;letter-spacing:-.05em}.intro{margin:0 0 1.75rem;color:var(--muted);line-height:1.55}.form-card{display:grid;gap:1.2rem;padding:1.25rem}.field>span:first-child{color:var(--coral)}.field .optional{color:var(--muted);font-size:.72rem;font-weight:500}.form-card .button{margin-top:.4rem}`] })
export class NewBookComponent {
  private readonly fb = inject(NonNullableFormBuilder); private readonly router = inject(Router); private readonly store = inject(DashboardStore);
  readonly form = this.fb.group({ title: ['', Validators.required], author: [''] }); get title() { return this.form.controls.title; }
  submit(): void { this.form.markAllAsTouched(); const title = this.title.value.trim(); if (!title) { this.title.setErrors({ required: true }); return; } if (this.form.valid) { this.store.addBook(title, this.form.controls.author.value.trim()); void this.router.navigate(['/app/ler']); } }
}
