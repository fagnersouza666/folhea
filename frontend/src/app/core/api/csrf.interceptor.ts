import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { CsrfService } from './csrf.service';

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const publicRegistrationPaths = new Set(['/api/v1/registration', '/api/v1/auth/register', '/api/v1/register']);

export const csrfInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request);
  const withCredentials = request.clone({ withCredentials: true });
  // Registration is public and does not have an authenticated CSRF token yet.
  if (request.method === 'POST' && publicRegistrationPaths.has(request.url)) return next(withCredentials);
  const auth = inject(AuthService);
  if (!mutationMethods.has(request.method) || request.url === '/api/v1/csrf') {
    return next(withCredentials).pipe(catchError((error: unknown) => handleAuthError(request, error, auth)));
  }

  const csrf = inject(CsrfService);
  if (request.headers.has('X-CSRF-Token')) {
    return next(withCredentials).pipe(catchError((error: unknown) => handleAuthError(request, error, auth)));
  }
  return csrf.getToken().pipe(
    switchMap((token) => next(withCredentials.clone({ setHeaders: { 'X-CSRF-Token': token } }))),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 403) {
        csrf.clear();
        return csrf.getToken().pipe(
          switchMap((token) => next(withCredentials.clone({ setHeaders: { 'X-CSRF-Token': token } }))),
          catchError((retryError: unknown) => handleAuthError(request, retryError, auth))
        );
      }
      return handleAuthError(request, error, auth);
    })
  );
};

function handleAuthError(request: { url: string }, error: unknown, auth: AuthService) {
  if (error instanceof HttpErrorResponse && error.status === 401 && request.url !== '/api/v1/me') {
    if (auth.initialized() && auth.isAuthenticated()) auth.signOut();
  }
  return throwError(() => error);
}
