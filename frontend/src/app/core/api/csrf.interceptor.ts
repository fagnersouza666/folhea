import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { CsrfService } from './csrf.service';

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const csrfInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request);
  const withCredentials = request.clone({ withCredentials: true });
  if (!mutationMethods.has(request.method) || request.url === '/api/v1/csrf') return next(withCredentials);

  const csrf = inject(CsrfService);
  if (request.headers.has('X-CSRF-Token')) return next(withCredentials);
  return csrf.getToken().pipe(
    switchMap((token) => next(withCredentials.clone({ setHeaders: { 'X-CSRF-Token': token } }))),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 403) {
        csrf.clear();
        return csrf.getToken().pipe(
          switchMap((token) => next(withCredentials.clone({ setHeaders: { 'X-CSRF-Token': token } })))
        );
      }
      return throwError(() => error);
    })
  );
};
