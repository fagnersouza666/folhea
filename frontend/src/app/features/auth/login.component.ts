import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SeoService } from '../../core/services/seo.service';

@Component({ selector: 'folhea-login', standalone: true, imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush, template: `
  <main class="auth-page"><a routerLink="/" class="brand" aria-label="Voltar para Folhea"><span class="brand-mark">F</span><span>folhea</span></a><section class="auth-card surface"><p class="eyebrow">Bem-vindo de volta</p><h1>Continue sua leitura.</h1><p class="auth-intro">Entre com segurança pelo provedor de identidade do Folhea. Seus tokens permanecem no servidor.</p><button class="button button-primary submit-button" type="button" (click)="submit()">Entrar <span aria-hidden="true">→</span></button><p class="auth-footnote">Ainda não tem uma conta? <a routerLink="/cadastro">Cadastre-se</a></p></section><p class="auth-legal">Ao continuar, você concorda com nossos <a routerLink="/termos">termos</a> e <a routerLink="/privacidade">política de privacidade</a>.</p></main>
`, styles: [`:host{display:block;min-height:100vh;background:var(--cream-100)}.auth-page{display:grid;justify-items:center;padding:1.5rem 1rem 3rem}.auth-page>.brand{align-self:start;margin-bottom:4rem;color:var(--forest-900);font-size:1.35rem}.auth-card{width:min(100%,28rem);padding:1.5rem}.auth-card h1{margin:.65rem 0 .75rem;color:var(--forest-950);font-family:Georgia,serif;font-size:2.6rem;line-height:.98;letter-spacing:-.05em}.auth-intro{margin:0 0 1.8rem;color:var(--muted);line-height:1.55}.auth-card form{display:grid;gap:1.1rem}.submit-button{width:100%;margin-top:.4rem}.auth-footnote,.auth-legal{color:var(--muted);font-size:.8rem;text-align:center}.auth-footnote a,.auth-legal a{color:var(--forest-800);font-weight:750;text-decoration:underline}.auth-legal{max-width:24rem;line-height:1.5}`] })
export class LoginComponent {
  private readonly auth = inject(AuthService);
  constructor() { inject(SeoService).update('Entrar — Folhea', 'Entre no Folhea para registrar sua leitura e acompanhar seu progresso.', '/entrar', false); }
  submit(): void { this.auth.signIn(); }
}
