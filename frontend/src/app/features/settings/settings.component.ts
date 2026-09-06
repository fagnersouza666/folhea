import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { PwaService } from '../../core/services/pwa.service';

@Component({
  selector: 'folhea-settings',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-heading"><div><p class="eyebrow">Seu espaço</p><h1>Configurações</h1></div><a routerLink="/app/inicio" class="back-link">← Início</a></div>
    <section class="surface settings-card" aria-labelledby="account-title"><h2 id="account-title">Conta</h2><dl><div><dt>E-mail</dt><dd>{{ auth.user()?.email || 'Conta Folhea' }}</dd></div><div><dt>Fuso horário</dt><dd>{{ auth.user()?.timezone || timezone }}</dd></div></dl></section>
    <section class="surface settings-card" aria-labelledby="app-title"><h2 id="app-title">Aplicativo</h2><div class="setting-row"><div><strong>Notificações de atualização</strong><p>O Folhea avisa quando uma versão nova estiver pronta.</p></div><span class="status">Ativo</span></div><div class="setting-row"><div><strong>Conexão</strong><p>{{ pwa.online() ? 'Online — pronto para sincronizar.' : 'Sem conexão — conecte-se para registrar sua leitura.' }}</p></div><span class="status" [class.offline]="!pwa.online()">{{ pwa.online() ? 'Online' : 'Offline' }}</span></div></section>
    <button class="button button-danger signout" type="button" (click)="auth.signOut()">Sair da conta</button>
  `,
  styles: [`:host{display:grid;gap:1.2rem;max-width:42rem}.page-heading{display:flex;align-items:end;justify-content:space-between}.page-heading h1{margin:.35rem 0 0;color:var(--forest-950);font-family:Georgia,serif;font-size:2.35rem;line-height:1}.back-link{color:var(--forest-800);font-size:.8rem;font-weight:750}.settings-card{display:grid;gap:1rem;padding:1.3rem}.settings-card h2{margin:0;color:var(--forest-950);font-family:Georgia,serif;font-size:1.3rem}.settings-card dl{display:grid;gap:.8rem;margin:0}.settings-card dl div{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-top:1px solid #e1e7df;padding-top:.8rem}.settings-card dt,.settings-card dd{font-size:.82rem}.settings-card dt{color:var(--muted)}.settings-card dd{margin:0;color:var(--forest-950);font-weight:750;text-align:right}.setting-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-top:1px solid #e1e7df;padding-top:.8rem}.setting-row strong{color:var(--forest-950);font-size:.85rem}.setting-row p{margin:.3rem 0 0;color:var(--muted);font-size:.75rem;line-height:1.45}.status{flex:none;border-radius:99px;padding:.3rem .55rem;color:var(--forest-800);background:var(--forest-100);font-size:.68rem;font-weight:800}.status.offline{color:#7e3030;background:#fbe9e3}.signout{justify-self:start}.empty{padding:2rem}.empty h1{font-family:Georgia,serif}`]
})
export class SettingsComponent {
  readonly auth = inject(AuthService);
  readonly pwa = inject(PwaService);
  readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
}
