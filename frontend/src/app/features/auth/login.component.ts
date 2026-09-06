import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({ selector: 'folhea-login', standalone: true, imports: [ReactiveFormsModule, RouterLink], changeDetection: ChangeDetectionStrategy.OnPush, template: `
  <main class="auth-page"><a routerLink="/" class="brand" aria-label="Voltar para Folhea"><span class="brand-mark">F</span><span>folhea</span></a><section class="auth-card surface"><p class="eyebrow">Bem-vindo de volta</p><h1>Continue sua leitura.</h1><p class="auth-intro">Entre para registrar sua próxima sessão e acompanhar seu progresso.</p><form [formGroup]="form" (ngSubmit)="submit()" novalidate><label class="field">E-mail<input type="email" formControlName="email" placeholder="voce@email.com" autocomplete="email" [attr.aria-invalid]="email.invalid && email.touched" aria-describedby="email-error" />@if (email.invalid && email.touched) { <span id="email-error" class="field-error">Informe um e-mail válido.</span> }</label><label class="field">Senha<input type="password" formControlName="password" placeholder="Sua senha" autocomplete="current-password" [attr.aria-invalid]="password.invalid && password.touched" />@if (password.invalid && password.touched) { <span class="field-error">A senha é obrigatória.</span> }</label><button class="button button-primary submit-button" type="submit">Entrar <span aria-hidden="true">→</span></button></form><p class="auth-footnote">Ainda não tem uma conta? <a href="mailto:oi@folhea.com.br">Fale com a gente</a></p></section><p class="auth-legal">Ao continuar, você concorda com nossos <a routerLink="/termos">termos</a> e <a routerLink="/privacidade">política de privacidade</a>.</p></main>
`, styles: [`:host{display:block;min-height:100vh;background:var(--cream-100)}.auth-page{display:grid;justify-items:center;padding:1.5rem 1rem 3rem}.auth-page>.brand{align-self:start;margin-bottom:4rem;color:var(--forest-900);font-size:1.35rem}.auth-card{width:min(100%,28rem);padding:1.5rem}.auth-card h1{margin:.65rem 0 .75rem;color:var(--forest-950);font-family:Georgia,serif;font-size:2.6rem;line-height:.98;letter-spacing:-.05em}.auth-intro{margin:0 0 1.8rem;color:var(--muted);line-height:1.55}.auth-card form{display:grid;gap:1.1rem}.submit-button{width:100%;margin-top:.4rem}.auth-footnote,.auth-legal{color:var(--muted);font-size:.8rem;text-align:center}.auth-footnote a,.auth-legal a{color:var(--forest-800);font-weight:750;text-decoration:underline}.auth-legal{max-width:24rem;line-height:1.5}`] })
export class LoginComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly auth = inject(AuthService);
  readonly form = this.fb.group({ email: ['', [Validators.required, Validators.email]], password: ['', Validators.required] });
  get email() { return this.form.controls.email; }
  get password() { return this.form.controls.password; }
  submit(): void { this.form.markAllAsTouched(); if (this.form.valid) this.auth.signIn(this.email.value); }
}
