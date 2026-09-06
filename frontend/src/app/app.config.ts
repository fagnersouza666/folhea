import { ApplicationConfig, inject, isDevMode, PLATFORM_ID, provideAppInitializer } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { provideRouter, withEnabledBlockingInitialNavigation, withViewTransitions } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { AuthService } from './core/auth/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withEnabledBlockingInitialNavigation(), withViewTransitions()),
    provideHttpClient(withFetch()),
    provideAppInitializer(() => {
      const auth = inject(AuthService);
      return isPlatformBrowser(inject(PLATFORM_ID)) ? auth.restoreSession() : undefined;
    }),
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' })
  ]
};
