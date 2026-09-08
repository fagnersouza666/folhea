import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client.service';
import { RegistrationComponent } from './registration.component';

describe('RegistrationComponent', () => {
  let register: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    register = vi.fn(() => of({ id: 'user-1', email: 'reader@example.com' }));
    TestBed.configureTestingModule({
      imports: [RegistrationComponent],
      providers: [provideRouter([]), { provide: ApiClient, useValue: { register } }]
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders only the approved fields with accessible labels and instructions', () => {
    const fixture = TestBed.createComponent(RegistrationComponent);
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const email = fixture.nativeElement.querySelector('#registration-email') as HTMLInputElement;
    const password = fixture.nativeElement.querySelector('#registration-password') as HTMLInputElement;

    expect(form.querySelectorAll('input')).toHaveLength(2);
    expect(email.type).toBe('email');
    expect(email.autocomplete).toBe('email');
    expect(email.maxLength).toBe(320);
    expect(email.getAttribute('aria-describedby')).toBe('registration-email-hint');
    expect(password.type).toBe('password');
    expect(password.autocomplete).toBe('new-password');
    expect(password.minLength).toBe(8);
    expect(password.maxLength).toBe(128);
    expect(password.getAttribute('aria-describedby')).toBe('registration-password-hint');
    expect(form.querySelector('#registration-email-hint')?.textContent).toContain('e-mail válido');
    expect(form.querySelector('#registration-password-hint')?.textContent).toContain('8 e 128');
    expect(form.querySelector('#registration-confirm-password')).toBeNull();
    expect(form.querySelector('#registration-name')).toBeNull();
  });

  it('shows field errors and does not submit invalid values', () => {
    const fixture = TestBed.createComponent(RegistrationComponent);
    fixture.detectChanges();
    fixture.componentInstance.submit();
    fixture.detectChanges();

    const email = fixture.nativeElement.querySelector('#registration-email') as HTMLInputElement;
    const password = fixture.nativeElement.querySelector('#registration-password') as HTMLInputElement;
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toContain('registration-email-error');
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(password.getAttribute('aria-describedby')).toContain('registration-password-error');
    expect(fixture.nativeElement.querySelector('#registration-email-error')?.textContent).toContain('e-mail');
    expect(fixture.nativeElement.querySelector('#registration-password-error')?.textContent).toContain('senha');
    expect(register).not.toHaveBeenCalled();
  });

  it('normalizes only the email and submits the approved payload', () => {
    const fixture = TestBed.createComponent(RegistrationComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ email: '  Reader@Example.com  ', password: 'leitura-segura' });
    fixture.componentInstance.submit();

    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith({ email: 'Reader@Example.com', password: 'leitura-segura' });
    expect(fixture.componentInstance.state()).toBe('success');
    expect(fixture.componentInstance.password.value).toBe('');
  });

  it('prevents concurrent submissions while the request is pending', () => {
    const request = new Subject<{ id: string; email: string }>();
    register.mockReturnValue(request.asObservable());
    const fixture = TestBed.createComponent(RegistrationComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ email: 'reader@example.com', password: 'leitura-segura' });

    fixture.componentInstance.submit();
    fixture.componentInstance.submit();

    expect(register).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.state()).toBe('submitting');
    request.next({ id: 'user-1', email: 'reader@example.com' });
    expect(fixture.componentInstance.state()).toBe('success');
  });

  it.each([
    [400, 'validation_error', 'Confira os dados'],
    [409, 'conflict_error', 'Não foi possível concluir o cadastro'],
    [503, 'provider_error', 'Tente novamente mais tarde'],
    [0, 'network_error', 'operação não foi confirmada']
  ] as const)('maps HTTP %s to a safe %s state', (status, state, message) => {
    register.mockReturnValue(throwError(() => new HttpErrorResponse({ status, statusText: 'Failure', error: { detail: 'internal secret' } })));
    const fixture = TestBed.createComponent(RegistrationComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ email: 'reader@example.com', password: 'leitura-segura' });
    fixture.componentInstance.submit();
    fixture.detectChanges();

    expect(fixture.componentInstance.state()).toBe(state);
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(fixture.nativeElement.textContent).not.toContain('internal secret');
  });
});
