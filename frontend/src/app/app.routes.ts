import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { AppShellComponent } from './layout/app-shell.component';
import { LandingComponent } from './public/landing/landing.component';
import { PublicPageComponent } from './public/public-page.component';

export const routes: Routes = [
  { path: '', component: LandingComponent, title: 'Folhea — Cada página conta' },
  { path: 'como-funciona', component: PublicPageComponent, data: { page: 'como-funciona' }, title: 'Como funciona — Folhea' },
  { path: 'recursos', component: PublicPageComponent, data: { page: 'recursos' }, title: 'Recursos — Folhea' },
  { path: 'sobre', component: PublicPageComponent, data: { page: 'sobre' }, title: 'Sobre — Folhea' },
  { path: 'privacidade', component: PublicPageComponent, data: { page: 'privacidade' }, title: 'Privacidade — Folhea' },
  { path: 'termos', component: PublicPageComponent, data: { page: 'termos' }, title: 'Termos — Folhea' },
  { path: 'entrar', loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent), title: 'Entrar — Folhea' },
  { path: 'app', component: AppShellComponent, canActivate: [authGuard], children: [
    { path: '', pathMatch: 'full', redirectTo: 'inicio' },
    { path: 'inicio', loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent), title: 'Início — Folhea' },
    { path: 'livros', loadComponent: () => import('./features/books/books.component').then((m) => m.BooksComponent), title: 'Livros — Folhea' },
    { path: 'livros/novo', loadComponent: () => import('./features/books/new-book.component').then((m) => m.NewBookComponent), title: 'Cadastrar livro — Folhea' },
    { path: 'ler', loadComponent: () => import('./features/reading/reading.component').then((m) => m.ReadingComponent), title: 'Registrar leitura — Folhea' },
    { path: 'ler/feedback', loadComponent: () => import('./features/reading/feedback.component').then((m) => m.FeedbackComponent), title: 'Leitura registrada — Folhea' },
    { path: 'progresso', loadComponent: () => import('./features/progress/progress.component').then((m) => m.ProgressComponent), title: 'Progresso — Folhea' }
  ] },
  { path: '**', redirectTo: '' }
];
