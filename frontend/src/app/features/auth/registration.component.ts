import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api/api-client.service';
import { SeoService } from '../../core/services/seo.service';

export type RegistrationState =
  | 'idle'
  | 'submitting'
  | 'success'
  | 'validation_error'
  | 'conflict_error'
  | 'provider_error'
  | 'network_error';

@Component({
  selector: 'folhea-registration',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth-page registration-page">
      <a routerLink="/" class="brand" aria-label="Voltar para Folhea"><span class="brand-mark">F</span><span>folhea</span></a>
      <section class="auth-card surface" aria-labelledby="registration-title">
        @if (state() === 'success') {
          <div class="success-state">
            <p class="eyebrow">Conta criada</p>
            <h1 id="registration-title">Seu próximo capítulo começa aqui.</h1>
            <p class="auth-intro" role="status">Cadastro concluído. Continue pelo login seguro do Folhea.</p>
            <a routerLink="/entrar" class="button button-primary submit-button">Continuar para entrar <span aria-hidden="true">→</span></a>
          </div>
        } @else {
          <p class="eyebrow">Comece pelo essencial</p>
          <h1 id="registration-title">Crie sua conta.</h1>
          <p class="auth-intro">Registre seu e-mail e escolha uma senha. Depois, entre com segurança pelo provedor de identidade do Folhea.</p>

          @if (state() === 'submitting') {
            <p class="alert alert-progress" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span> Enviando seu cadastro…</p>
          } @else if (message()) {
            <p class="alert alert-error" role="alert" aria-live="assertive">{{ message() }}</p>
          }

          <form class="registration-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div class="field">
              <label for="registration-email">E-mail <span class="required" aria-hidden="true">*</span><span class="sr-only"> obrigatório</span></label>
              <span id="registration-email-hint" class="field-hint">Use um endereço de e-mail válido.</span>
              <input id="registration-email" type="email" formControlName="email" autocomplete="email" inputmode="email" maxlength="320" required [attr.aria-invalid]="showEmailError() ? 'true' : null" [attr.aria-describedby]="emailDescription" />
              @if (showEmailError()) { <span id="registration-email-error" class="field-error" role="alert">{{ emailError }}</span> }
            </div>

            <div class="field">
              <label for="registration-password">Senha <span class="required" aria-hidden="true">*</span><span class="sr-only"> obrigatória</span></label>
              <span id="registration-password-hint" class="field-hint">Use entre 8 e 128 caracteres.</span>
              <input id="registration-password" type="password" formControlName="password" autocomplete="new-password" minlength="8" maxlength="128" required [attr.aria-invalid]="showPasswordError() ? 'true' : null" [attr.aria-describedby]="passwordDescription" />
              @if (showPasswordError()) { <span id="registration-password-error" class="field-error" role="alert">{{ passwordError }}</span> }
            </div>

            <button class="button button-primary submit-button" type="submit" [disabled]="state() === 'submitting'">Criar conta <span aria-hidden="true">→</span></button>
          </form>
          <p class="auth-footnote">Já tem uma conta? <a routerLink="/entrar">Entre com segurança</a></p>
        }
      </section>
      <p class="auth-legal">Ao continuar, você concorda com nossos <a routerLink="/termos">termos</a> e <a routerLink="/privacidade">política de privacidade</a>.</p>
    </main>
  `,
  styles: [`
    :host{display:block;min-height:100vh;background:var(--cream-100)}
    .registration-page{padding-bottom:3rem}
    .registration-page>.brand{align-self:start}
    .auth-card{width:min(100%,30rem);padding:1.5rem}
    .auth-card h1{margin:.65rem 0 .75rem;color:var(--forest-950);font-family:Georgia,serif;font-size:clamp(2.45rem,10vw,3.2rem);line-height:.98;letter-spacing:-.05em}
    .auth-intro{margin:0 0 1.8rem;color:var(--muted);line-height:1.55}
    .registration-form{display:grid;gap:1.15rem}
    .field{gap:.42rem}
    .field label{display:block}
    .field label .required{color:var(--coral)}
    .field-hint{order:1;color:var(--muted);font-size:.76rem;font-weight:500;line-height:1.4}
    .field input{order:2}
    .field-error{order:3}
    .required{color:var(--coral)}
    .alert{margin:0 0 1.15rem}
    .alert-progress{display:flex;align-items:center;gap:.6rem;color:var(--forest-950);background:var(--forest-100)}
    .submit-button{width:100%;margin-top:.35rem}
    .submit-button:disabled{cursor:wait;opacity:.7}
    .auth-footnote,.auth-legal{color:var(--muted);font-size:.8rem;text-align:center}
    .auth-footnote{margin:1.25rem 0 0}
    .auth-footnote a,.auth-legal a{color:var(--forest-800);font-weight:750;text-decoration:underline}
    .auth-legal{max-width:24rem;line-height:1.5}
    .success-state .auth-intro{margin-bottom:1.8rem}
  `]
})
export class RegistrationComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(ApiClient);
  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(320)]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]]
  });
  readonly state = signal<RegistrationState>('idle');
  readonly message = signal<string | null>(null);
  private readonly attempted = signal(false);

  constructor() {
    inject(SeoService).update('Criar conta — Folhea', 'Crie sua conta Folhea para registrar sua leitura e acompanhar seu progresso.', '/cadastro', false);
  }

  get email() { return this.form.controls.email; }
  get password() { return this.form.controls.password; }
  get emailDescription(): string { return this.showEmailError() ? 'registration-email-hint registration-email-error' : 'registration-email-hint'; }
  get passwordDescription(): string { return this.showPasswordError() ? 'registration-password-hint registration-password-error' : 'registration-password-hint'; }
  get emailError(): string {
    if (this.email.hasError('required')) return 'Informe seu e-mail.';
    if (this.email.hasError('maxlength')) return 'Use um e-mail com até 320 caracteres.';
    return 'Informe um e-mail válido.';
  }
  get passwordError(): string {
    if (this.password.hasError('required')) return 'Informe uma senha.';
    if (this.password.hasError('minlength')) return 'Use uma senha com pelo menos 8 caracteres.';
    if (this.password.hasError('maxlength')) return 'Use uma senha com no máximo 128 caracteres.';
    return 'Confira sua senha.';
  }

  showEmailError(): boolean { return this.email.invalid && (this.email.touched || this.attempted()); }
  showPasswordError(): boolean { return this.password.invalid && (this.password.touched || this.attempted()); }

  submit(): void {
    if (this.state() === 'submitting') return;
    this.attempted.set(true);
    this.message.set(null);
    const email = this.email.value.trim();
    if (email !== this.email.value) this.email.setValue(email);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.state.set('validation_error');
      return;
    }

    this.state.set('submitting');
    this.api.register({ email, password: this.password.value }).subscribe({
      next: () => {
        this.password.reset();
        this.state.set('success');
        this.message.set(null);
      },
      error: (error: unknown) => {
        this.state.set(this.classifyError(error));
        this.message.set(this.messageFor(this.state()));
      }
    });
  }

  private classifyError(error: unknown): RegistrationState {
    const status = error instanceof HttpErrorResponse
      ? error.status
      : typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 0;
    if (status === 0) return 'network_error';
    if (status === 400) return 'validation_error';
    if (status === 409) return 'conflict_error';
    return 'provider_error';
  }

  private messageFor(state: RegistrationState): string {
    switch (state) {
      case 'validation_error': return 'Confira os dados informados e tente novamente.';
      case 'conflict_error': return 'Não foi possível concluir o cadastro.';
      case 'network_error': return 'A operação não foi confirmada. Verifique sua conexão e tente novamente.';
      default: return 'Não foi possível concluir o cadastro. Tente novamente mais tarde.';
    }
  }
}
