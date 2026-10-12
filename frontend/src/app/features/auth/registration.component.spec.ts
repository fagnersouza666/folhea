import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RegistrationComponent } from './registration.component';

describe('RegistrationComponent redirect only', () => {
  beforeEach(() => TestBed.configureTestingModule({
    imports: [RegistrationComponent], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
  }));
  afterEach(() => { TestBed.inject(HttpTestingController).verify(); TestBed.resetTestingModule(); });
  it('has no form, email or password input delegated to Folhea', () => {
    const fixture = TestBed.createComponent(RegistrationComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
  });
  it('creates an account exclusively by navigating to the BFF registration entry', () => {
    const fixture = TestBed.createComponent(RegistrationComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/auth/register"]')?.textContent).toContain('Criar conta');
    TestBed.inject(HttpTestingController).expectNone(req => req.method !== 'GET');
  });
});
