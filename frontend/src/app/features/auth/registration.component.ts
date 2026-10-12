import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'folhea-registration', standalone: true, imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth-page">
      <a routerLink="/" class="brand" aria-label="Voltar para Folhea"><span class="brand-mark">F</span><span>folhea</span></a>
      <section class="auth-card surface" aria-labelledby="registration-title">
        <p class="eyebrow">Comece pelo essencial</p><h1 id="registration-title">Crie sua conta.</h1>
        <p class="auth-intro">Continue para cadastrar sua conta com segurança na próxima tela.</p>
        <a href="/auth/register" class="button button-primary submit-button">Criar conta <span aria-hidden="true">→</span></a>
        <p class="auth-footnote">Já tem uma conta? <a href="/auth/login">Entrar</a></p>
      </section>
      <p class="auth-legal">Ao continuar, você concorda com nossos <a routerLink="/termos">termos</a> e <a routerLink="/privacidade">política de privacidade</a>.</p>
    </main>`,
  styles: [`:host{display:block;min-height:100vh;background:var(--cream-100)}.auth-page{display:grid;justify-items:center;gap:1.5rem;padding:1.5rem 1rem 3rem}.auth-page>.brand{margin-bottom:2rem}.auth-card{width:min(100%,30rem);padding:1.5rem}.auth-card h1{margin:.65rem 0 .75rem;color:var(--forest-950);font-family:Georgia,serif;font-size:clamp(2.45rem,10vw,3.2rem);line-height:.98;letter-spacing:-.05em}.auth-intro{margin:0 0 1.8rem;color:var(--muted);line-height:1.55}.submit-button{width:100%}.auth-footnote,.auth-legal{color:var(--muted);font-size:.8rem;text-align:center}.auth-footnote{margin:1.25rem 0 0}.auth-footnote a,.auth-legal a{color:var(--forest-800);font-weight:750;text-decoration:underline}.auth-legal{max-width:24rem;line-height:1.5}`]
})
export class RegistrationComponent {
  constructor() { inject(SeoService).update('Criar conta — Folhea', 'Crie sua conta para acompanhar suas leituras.', '/cadastro', false); }
}
