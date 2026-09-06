import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { DashboardStore } from '../core/state/dashboard.store';
import { SeoService } from '../core/services/seo.service';
import { PwaService } from '../core/services/pwa.service';

@Component({
  selector: 'folhea-app-shell', standalone: true, imports: [RouterOutlet, RouterLink, RouterLinkActive], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main-content">Pular para o conteúdo</a>
    <div class="app-layout">
      <header class="app-header">
        <a routerLink="/app/inicio" class="brand" aria-label="Folhea, início"><span class="brand-mark">F</span><span>folhea</span></a>
        <div class="header-actions"><a routerLink="/app/configuracoes" class="settings-link" aria-label="Configurações">⚙</a><button class="profile-button" type="button" (click)="auth.signOut()" [attr.aria-label]="'Sair de ' + (auth.user()?.email ?? '')"><span class="avatar">{{ (auth.user()?.email ?? 'L')[0].toUpperCase() }}</span><span class="profile-copy"><strong>{{ auth.user()?.email }}</strong><small>Sair</small></span></button></div>
      </header>
      <main id="main-content" class="app-main">
        @if (!pwa.online()) { <div class="alert alert-error connection-alert" role="status">Você está sem conexão. Conecte-se para registrar sua leitura.</div> }
        @if (pwa.updateAvailable()) { <div class="update-alert" role="status"><span>Uma nova versão do Folhea está disponível.</span><button type="button" class="button button-secondary" (click)="pwa.activateUpdate()">Atualizar</button></div> }
        @if (store.error(); as error) { <div class="alert alert-error connection-alert" role="alert">{{ error }} <button type="button" class="dismiss" (click)="store.clearError()">Fechar</button></div> }
        <router-outlet />
      </main>
      <nav class="bottom-nav" aria-label="Navegação principal">
        <a routerLink="/app/inicio" routerLinkActive="active" [routerLinkActiveOptions]="{exact: true}"><span aria-hidden="true">⌂</span><span>Início</span></a>
        <a routerLink="/app/livros" routerLinkActive="active"><span aria-hidden="true">▤</span><span>Livros</span></a>
        <a class="record-link" routerLink="/app/ler"><span class="record-icon" aria-hidden="true">＋</span><span>Registrar</span></a>
        <a routerLink="/app/progresso" routerLinkActive="active"><span aria-hidden="true">◔</span><span>Progresso</span></a>
      </nav>
    </div>
  `
})
export class AppShellComponent {
  readonly auth = inject(AuthService);
  readonly store = inject(DashboardStore);
  readonly pwa = inject(PwaService);
  constructor() { this.store.load(); inject(SeoService).update('Folhea — Seu progresso', 'Área pessoal do Folhea.', '/app', false); }
}
