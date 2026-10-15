import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { CsrfService } from './csrf.service';
import { PROBLEM_TYPES } from './problem-types.generated';

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const csrfInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request);
  const withCredentials = request.clone({ withCredentials: true });
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

function handleAuthError(request: { url: string; method?: string }, error: unknown, auth: AuthService) {
  if (error instanceof HttpErrorResponse && error.status === 401 && !(request.url === '/api/v1/me' && request.method === 'GET')) {
    if (error.error?.type === PROBLEM_TYPES.RECENT_AUTHENTICATION_REQUIRED) return throwError(() => error);
    if (auth.initialized() && auth.isAuthenticated()) auth.sessionExpired();
  }
  return throwError(() => error);
}
