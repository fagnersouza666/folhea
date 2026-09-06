import { RESPONSE_INIT } from '@angular/core';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../core/services/seo.service';

@Component({
  selector: 'folhea-not-found',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main-content">Pular para o conteúdo</a>
    <header class="public-header container">
      <a class="brand" routerLink="/" aria-label="Folhea, início"><span class="brand-mark">F</span><span>folhea</span></a>
      <a routerLink="/" class="button button-secondary">Voltar para o início</a>
    </header>
    <main id="main-content" class="not-found container">
      <p class="not-found-code" aria-hidden="true">404</p>
      <p class="eyebrow">Folhea</p>
      <h1>Página não encontrada.</h1>
      <p class="intro">Esse caminho não existe, mas sua próxima leitura pode começar por aqui.</p>
      <a routerLink="/" class="button button-primary">Conhecer o Folhea <span aria-hidden="true">→</span></a>
    </main>
    <footer class="public-footer container"><span>© 2026 Folhea</span><span><a routerLink="/privacidade">Privacidade</a> · <a routerLink="/termos">Termos</a></span></footer>
  `,
  styles: [`
    :host { display:block; min-height:100vh; background:var(--cream-100); }
    .public-header { display:flex; align-items:center; justify-content:space-between; padding-block:1.2rem; }
    .not-found { display:grid; justify-items:start; padding-block:5rem 7rem; }
    .not-found-code { margin:0; color:var(--coral); font-size:.8rem; font-weight:850; letter-spacing:.16em; }
    .not-found h1 { max-width:40rem; margin:.7rem 0 1rem; color:var(--forest-950); font-family:Georgia,serif; font-size:clamp(2.8rem,9vw,5.5rem); line-height:.95; letter-spacing:-.06em; }
    .intro { max-width:32rem; margin:0 0 2rem; color:var(--muted); font-size:1.1rem; line-height:1.65; }
  `]
})
export class NotFoundComponent {
  constructor() {
    const responseInit = inject(RESPONSE_INIT, { optional: true });
    if (responseInit) responseInit.status = 404;
    inject(SeoService).update('Página não encontrada — Folhea', 'A página que você procura não existe no Folhea.', '/', false, null);
  }
}
