import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
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
    <section class="surface settings-card" aria-labelledby="privacy-title">
      <h2 id="privacy-title">Privacidade e dados</h2>
      <p class="privacy-copy">Baixe uma cópia dos seus dados ou exclua permanentemente sua conta e todos os registros associados.</p>
      <div class="privacy-actions">
        <button class="button" type="button" (click)="downloadData()" [disabled]="exporting() || deleting()">
          {{ exporting() ? 'Preparando download…' : 'Baixar meus dados' }}
        </button>
        <button class="button button-danger" type="button" (click)="openDeleteDialog()" [disabled]="exporting() || deleting()">Excluir minha conta</button>
      </div>
      @if (privacyError()) { <p class="privacy-error" role="alert">{{ privacyError() }}</p> }
    </section>
    <section class="surface settings-card" aria-labelledby="app-title"><h2 id="app-title">Aplicativo</h2><div class="setting-row"><div><strong>Notificações de atualização</strong><p>O Folhea avisa quando uma versão nova estiver pronta.</p></div><span class="status">Ativo</span></div><div class="setting-row"><div><strong>Conexão</strong><p>{{ pwa.online() ? 'Online — pronto para sincronizar.' : 'Sem conexão — conecte-se para registrar sua leitura.' }}</p></div><span class="status" [class.offline]="!pwa.online()">{{ pwa.online() ? 'Online' : 'Offline' }}</span></div></section>
    <button class="button button-danger signout" type="button" (click)="auth.signOut()" [disabled]="deleting()">Sair da conta</button>

    <dialog #deleteDialog class="delete-dialog" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description" (cancel)="closeDeleteDialog($event)">
      <form method="dialog" class="delete-dialog-form" (submit)="confirmDelete($event)">
        <h2 id="delete-dialog-title">Excluir conta permanentemente?</h2>
        <p id="delete-dialog-description">Esta ação apaga sua conta, livros e sessões de leitura. Não pode ser desfeita.</p>
        <label class="confirm-label"><input type="checkbox" [checked]="deleteConfirmed()" (change)="deleteConfirmed.set($any($event.target).checked)" /> Entendo que todos os meus dados serão removidos.</label>
        <div class="dialog-actions">
          <button class="button" type="button" (click)="closeDeleteDialog()">Cancelar</button>
          <button class="button button-danger" type="submit" [disabled]="!deleteConfirmed() || deleting()">{{ deleting() ? 'Excluindo…' : 'Excluir conta' }}</button>
        </div>
      </form>
    </dialog>
  `,
  styles: [`:host{display:grid;gap:1.2rem;max-width:42rem}.page-heading{display:flex;align-items:end;justify-content:space-between}.page-heading h1{margin:.35rem 0 0;color:var(--forest-950);font-family:Georgia,serif;font-size:2.35rem;line-height:1}.back-link{color:var(--forest-800);font-size:.8rem;font-weight:750}.settings-card{display:grid;gap:1rem;padding:1.3rem}.settings-card h2{margin:0;color:var(--forest-950);font-family:Georgia,serif;font-size:1.3rem}.settings-card dl{display:grid;gap:.8rem;margin:0}.settings-card dl div{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-top:1px solid #e1e7df;padding-top:.8rem}.settings-card dt,.settings-card dd{font-size:.82rem}.settings-card dt{color:var(--muted)}.settings-card dd{margin:0;color:var(--forest-950);font-weight:750;text-align:right}.privacy-copy{margin:0;color:var(--muted);font-size:.78rem;line-height:1.5}.privacy-actions{display:flex;flex-wrap:wrap;gap:.75rem}.privacy-error{margin:0;color:var(--danger);font-size:.78rem}.setting-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-top:1px solid #e1e7df;padding-top:.8rem}.setting-row strong{color:var(--forest-950);font-size:.85rem}.setting-row p{margin:.3rem 0 0;color:var(--muted);font-size:.75rem;line-height:1.45}.status{flex:none;border-radius:99px;padding:.3rem .55rem;color:var(--forest-800);background:var(--forest-100);font-size:.68rem;font-weight:800}.status.offline{color:#7e3030;background:#fbe9e3}.signout{justify-self:start}.delete-dialog{max-width:28rem;border:0;border-radius:1rem;padding:0;color:var(--forest-950);background:var(--cream-100);box-shadow:0 24px 60px rgba(20,40,30,.18)}.delete-dialog::backdrop{background:rgba(18,34,26,.45)}.delete-dialog-form{display:grid;gap:1rem;padding:1.4rem}.delete-dialog-form h2{margin:0;font-family:Georgia,serif;font-size:1.35rem}.delete-dialog-form p{margin:0;color:var(--muted);font-size:.82rem;line-height:1.55}.confirm-label{display:flex;align-items:flex-start;gap:.55rem;font-size:.8rem;line-height:1.45}.dialog-actions{display:flex;justify-content:flex-end;gap:.65rem}.empty{padding:2rem}.empty h1{font-family:Georgia,serif}`]
})
export class SettingsComponent {
  readonly auth = inject(AuthService);
  readonly pwa = inject(PwaService);
  private readonly api = inject(ApiClient);
  readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly exporting = signal(false);
  readonly deleting = signal(false);
  readonly deleteConfirmed = signal(false);
  readonly privacyError = signal<string | null>(null);
  private readonly deleteDialog = viewChild<ElementRef<HTMLDialogElement>>('deleteDialog');

  async downloadData(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.privacyError.set(null);
    try {
      const payload = await firstValueFrom(this.api.exportMe());
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `folhea-dados-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      this.privacyError.set('Não foi possível exportar seus dados. Tente novamente.');
    } finally {
      this.exporting.set(false);
    }
  }

  openDeleteDialog(): void {
    this.deleteConfirmed.set(false);
    this.privacyError.set(null);
    this.deleteDialog()?.nativeElement.showModal();
  }

  closeDeleteDialog(event?: Event): void {
    event?.preventDefault();
    this.deleteDialog()?.nativeElement.close();
  }

  async confirmDelete(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.deleteConfirmed() || this.deleting()) return;
    this.deleting.set(true);
    this.privacyError.set(null);
    try {
      await this.auth.deleteAccount();
    } catch {
      this.deleting.set(false);
      this.privacyError.set('Não foi possível excluir sua conta. Tente novamente.');
    }
  }
}
