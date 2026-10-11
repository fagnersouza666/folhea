import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardStore } from '../../core/state/dashboard.store';

@Component({ selector: 'folhea-feedback', standalone: true, imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush, template: `
  <div class="feedback-page">
    <div class="success-mark" aria-hidden="true">✓</div><p class="eyebrow">Muito bem</p>
    <h1>Leitura registrada.</h1><p class="intro">Seu progresso acaba de ganhar mais uma página.</p>
    <section class="surface recap" aria-label="Leitura registrada">
      <div><strong>{{ pages }}</strong><span>páginas</span></div>
      <div><strong>{{ minutes }}</strong><span>minutos</span></div>
      <div><strong>@if (summary(); as dashboard) { {{ dashboard.currentStreakDays }} } @else { <span aria-hidden="true">—</span><span class="sr-only">{{ store.loading() ? 'Atualizando' : 'Indisponível' }}</span> }</strong><span>dias seguidos</span></div>
    </section>
    <section class="surface weekly" aria-labelledby="feedback-week">
      <h2 id="feedback-week">Esta semana</h2>
      @if (store.loading()) { <p role="status">Atualizando seu progresso…</p> }
      @else if (summary(); as dashboard) { <p>{{ dashboard.week.pages }} páginas · {{ formatMinutes(dashboard.week.minutes) }} de leitura</p> }
      @else {
        <div role="alert"><p>Seu registro foi salvo. As métricas semanais estão indisponíveis.</p><button type="button" class="button button-secondary" (click)="store.loadDashboard()">Tentar novamente</button></div>
      }
    </section>
    <div class="feedback-actions"><a routerLink="/app/ler" class="button button-primary">Registrar outra <span aria-hidden="true">→</span></a><a routerLink="/app/inicio" class="button button-secondary">Concluir</a></div>
    <a routerLink="/app/cards" class="progress-link">Criar um card</a><a routerLink="/app/progresso" class="progress-link">Ver meu progresso</a>
  </div>
`, styles: [`:host{display:block}.feedback-page{display:grid;justify-items:center;max-width:38rem;margin-inline:auto;padding-block:2rem;text-align:center}.success-mark{display:grid;place-items:center;width:4.5rem;height:4.5rem;margin-bottom:1.5rem;border-radius:50%;color:var(--forest-900);background:var(--amber);font-size:2rem;font-weight:800}.feedback-page h1{margin:.65rem 0 .75rem;color:var(--forest-950);font-family:Georgia,serif;font-size:clamp(2.6rem,9vw,4.5rem);line-height:.95;letter-spacing:-.05em}.intro{margin:0;color:var(--muted);line-height:1.55}.recap{display:grid;grid-template-columns:repeat(3,1fr);width:100%;margin:2rem 0;padding:1.4rem .7rem}.recap div{display:grid;gap:.3rem;border-right:1px solid #e0e7df}.recap div:last-child{border:0}.recap strong{color:var(--forest-950);font-family:Georgia,serif;font-size:1.7rem}.recap span{color:var(--muted);font-size:.7rem}.weekly{width:100%;padding:1rem;margin-bottom:1.5rem}.weekly h2{margin:0 0 .5rem;font-family:Georgia,serif;font-size:1.3rem}.weekly p{margin:0;color:var(--muted)}.feedback-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:.7rem}.progress-link{margin-top:1.4rem;color:var(--forest-800);font-size:.8rem;font-weight:750;text-decoration:underline;text-underline-offset:4px}`] })
export class FeedbackComponent {
  formatMinutes(minutes: number): string { return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}min` : `${minutes}min`; }
  readonly store = inject(DashboardStore); readonly pages = history.state?.pages ?? 0; readonly minutes = history.state?.minutes ?? 0;
  readonly summary = computed(() => this.store.loading() || this.store.dashboardError() ? null : this.store.dashboard());
}
