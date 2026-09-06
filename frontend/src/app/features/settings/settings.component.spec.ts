import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client.service';
import { AuthService } from '../../core/auth/auth.service';
import { PwaService } from '../../core/services/pwa.service';
import { SettingsComponent } from './settings.component';

describe('SettingsComponent', () => {
  let exportMe: ReturnType<typeof vi.fn>;
  let authDeleteAccount: ReturnType<typeof vi.fn>;
  let signOut: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    exportMe = vi.fn(() => of({
      user: { id: 'user-1', email: 'reader@example.com', timezone: 'America/Sao_Paulo' },
      books: [{ id: 'book-1', title: 'Duna', status: 'READING' }],
      sessions: []
    }));
    authDeleteAccount = vi.fn(async () => undefined);
    signOut = vi.fn();

    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:export', configurable: true });
      Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
    }
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
        this.open = true;
      };
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
        this.open = false;
      };
    }

    TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClient, useValue: { exportMe } },
        { provide: AuthService, useValue: {
          user: signal({ email: 'reader@example.com', timezone: 'America/Sao_Paulo' }),
          signOut,
          deleteAccount: authDeleteAccount
        } },
        { provide: PwaService, useValue: { online: signal(true) } }
      ]
    });
  });

  it('renders privacy actions and account details', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#privacy-title')?.textContent).toContain('Privacidade');
    expect(fixture.nativeElement.textContent).toContain('Baixar meus dados');
    expect(fixture.nativeElement.textContent).toContain('Excluir minha conta');
    expect(fixture.nativeElement.textContent).toContain('reader@example.com');
  });

  it('downloads exported data as a JSON file', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    await fixture.componentInstance.downloadData();

    expect(exportMe).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.privacyError()).toBeNull();
  });

  it('opens an accessible delete dialog and requires confirmation', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const deleteButton = Array.from(fixture.nativeElement.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Excluir minha conta')) as HTMLButtonElement | undefined;
    expect(deleteButton).toBeTruthy();
    deleteButton!.click();
    fixture.detectChanges();

    expect(dialog.getAttribute('aria-labelledby')).toBe('delete-dialog-title');
    expect(dialog.querySelector('#delete-dialog-description')).not.toBeNull();
    expect((dialog.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('deletes the account after explicit confirmation', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    fixture.componentInstance.deleteConfirmed.set(true);
    await fixture.componentInstance.confirmDelete(new Event('submit'));

    expect(authDeleteAccount).toHaveBeenCalledTimes(1);
  });

  it('shows an alert when export fails', async () => {
    exportMe.mockReturnValueOnce(throwError(() => new Error('fail')));
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    await fixture.componentInstance.downloadData();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível exportar');
  });
});
