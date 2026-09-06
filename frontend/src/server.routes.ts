import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: 'app/**', renderMode: RenderMode.Client },
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'como-funciona', renderMode: RenderMode.Prerender },
  { path: 'recursos', renderMode: RenderMode.Prerender },
  { path: 'sobre', renderMode: RenderMode.Prerender },
  { path: 'privacidade', renderMode: RenderMode.Prerender },
  { path: 'termos', renderMode: RenderMode.Prerender },
  { path: 'entrar', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Server, status: 404 }
];
