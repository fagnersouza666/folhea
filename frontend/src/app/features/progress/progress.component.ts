import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardStore } from '../../core/state/dashboard.store';
import { AnalyticsService } from '../../core/analytics/analytics.service';

@Component({ selector: 'folhea-progress', standalone: true, imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush, template: `
  <div class="page-heading"><div><p class="eyebrow">Visão geral</p><h1>Seu progresso</h1></div><a routerLink="/app/ler" class="button button-primary">+ Registrar</a></div><section class="hero-stat surface"><span class="stat-label">Streak atual</span><strong>{{ store.dashboard()?.currentStreakDays ?? 17 }} <small>dias seguidos</small></strong><div class="week-dots" aria-label="Seus últimos sete dias"><i class="read"></i><i class="read"></i><i class="read"></i><i class="read"></i><i class="read"></i><i class="read"></i><i class="today"></i></div></section><h2 class="section-heading">Esta semana</h2><div class="metric-list"><div class="metric-row surface"><span class="metric-icon pages">↗</span><span><strong>{{ store.dashboard()?.week?.pages ?? 134 }}</strong><small>páginas lidas</small></span><span class="trend">+12%</span></div><div class="metric-row surface"><span class="metric-icon time">◷</span><span><strong>{{ formatMinutes(store.dashboard()?.week?.minutes ?? 138) }}</strong><small>de leitura</small></span><span class="trend">+8%</span></div><div class="metric-row surface"><span class="metric-icon finished">✓</span><span><strong>{{ store.dashboard()?.week?.booksFinished ?? 1 }}</strong><small>livro finalizado</small></span><span class="trend">este mês</span></div></div><section class="share-card"><div><p class="eyebrow">Pequenas vitórias</p><h2>Seu hábito merece um card.</h2><p>Guarde a evolução desta semana ou compartilhe com quem também ama ler.</p></div><button class="button button-secondary" type="button" (click)="createCard()">{{ shared ? 'Card criado ✓' : 'Criar card' }}</button></section>
`, styles: [`:host{display:grid;gap:1.3rem}.page-heading{display:flex;align-items:end;justify-content:space-between;gap:1rem}.page-heading h1{margin:.35rem 0 0;color:var(--forest-950);font-family:Georgia,serif;font-size:2.35rem;line-height:1}.hero-stat{padding:1.35rem}.stat-label{color:var(--muted);font-size:.78rem;font-weight:700}.hero-stat strong{display:block;margin:.35rem 0 1.2rem;color:var(--forest-950);font-family:Georgia,serif;font-size:3.6rem;line-height:1}.hero-stat strong small{font-family:inherit;font-size:1rem}.week-dots{display:flex;gap:.55rem}.week-dots i{width:1.35rem;height:1.35rem;border-radius:50%;background:#dce6de}.week-dots i.read{background:var(--forest-800)}.week-dots i.today{border:3px solid var(--coral);background:var(--amber)}.section-heading{margin:.5rem 0 0;color:var(--forest-950);font-family:Georgia,serif;font-size:1.35rem}.metric-list{display:grid;gap:.7rem}.metric-row{display:flex;align-items:center;gap:.85rem;padding:1rem}.metric-icon{display:grid;place-items:center;width:2.6rem;height:2.6rem;border-radius:.7rem;font-weight:800}.metric-icon.pages{color:var(--coral);background:#fae9df}.metric-icon.time{color:var(--forest-800);background:var(--forest-100)}.metric-icon.finished{color:#99672c;background:#fff0d5}.metric-row span:nth-child(2){display:grid;gap:.18rem;flex:1}.metric-row strong{color:var(--forest-950);font-family:Georgia,serif;font-size:1.15rem}.metric-row small,.trend{color:var(--muted);font-size:.72rem}.trend{align-self:start}.share-card{display:flex;align-items:end;justify-content:space-between;gap:1rem;border-radius:var(--radius-card);padding:1.3rem;color:#eff9f1;background:var(--forest-900)}.share-card h2{margin:.4rem 0;font-family:Georgia,serif;font-size:1.4rem}.share-card p:last-of-type{max-width:22rem;margin:0;color:#b7d4c5;font-size:.8rem;line-height:1.5}@media(max-width:460px){.share-card{align-items:start;flex-direction:column}.share-card .button{width:100%}}`]
})
export class ProgressComponent {
  readonly store = inject(DashboardStore);
  private readonly analytics = inject(AnalyticsService);
  shared = false;

  constructor() { this.analytics.track('stats_viewed', { screen: 'progress' }); }

  createCard(): void {
    this.shared = true;
    this.analytics.track('card_created', { source: 'progress' });
  }

  shareCard(): void { this.analytics.track('card_shared', { source: 'progress' }); }
  downloadCard(): void { this.analytics.track('card_downloaded', { source: 'progress' }); }

  formatMinutes(minutes: number): string { return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}min` : `${minutes}min`; }
}
