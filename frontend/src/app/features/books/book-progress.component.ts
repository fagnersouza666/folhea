import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Book } from '../../core/models/models';
import { DashboardStore } from '../../core/state/dashboard.store';

@Component({ selector: 'folhea-book-progress', standalone: true, imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush, template: `
  <div class="book-progress" [attr.aria-label]="'Progresso de ' + book.title">
    @if (store.bookStatsLoading(book.id) || book.id.startsWith('local-')) { <p class="unavailable" role="status">Atualizando progresso…</p> }
    @else if (store.bookStatsError(book.id) || !store.bookStats(book.id)) { <div class="unavailable" role="status"><p>Progresso indisponível.</p><button type="button" class="retry" (click)="store.loadBookStats(book.id)">Tentar novamente</button></div> }
    @else if (store.bookStats(book.id); as stats) {
      <div class="progress-heading"><p class="pages-read"><strong>{{ number(stats.pagesRead) }}</strong> {{ stats.totalPages ? 'de ' + number(stats.totalPages) + ' páginas' : 'páginas lidas' }}</p>@if (stats.percent !== null) { <span class="percent">{{ number(stats.percent) }}%</span> }</div>
      @if (stats.percent !== null) { <div class="progress-track" role="progressbar" [attr.aria-label]="'Conclusão de ' + book.title" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="stats.percent" [attr.aria-valuetext]="number(stats.percent) + '%'"><div [style.width.%]="stats.percent"></div></div> }
      @else { <a class="complete-metadata" [routerLink]="['/app/livros', book.id]">Informe o total de páginas para acompanhar a conclusão.</a> }
      <p class="daily-average"><strong>{{ number(stats.averagePagesPerDay) }}</strong> páginas/dia</p>
      @if (stats.firstDate) { <p class="average-hint">Média desde a primeira leitura, incluindo dias sem leitura.{{ book.status === 'FINISHED' ? ' Até a finalização.' : '' }}</p> }
      @else { <p class="average-hint">Registre a primeira leitura para começar seu ritmo.</p> }
    }
  </div>
`, styles: [`:host{display:block}.book-progress{padding-top:.75rem}.progress-heading{display:flex;align-items:baseline;justify-content:space-between;gap:.6rem}.pages-read{margin:0;color:var(--muted);font-size:.8rem}.pages-read strong{color:var(--forest-950);font-variant-numeric:tabular-nums;font-size:1rem}.percent{color:var(--forest-800);font-size:.82rem;font-weight:800;white-space:nowrap}.progress-track{height:.4rem;margin:.6rem 0 .8rem;border-radius:99px;background:var(--forest-100);overflow:hidden}.progress-track div{height:100%;background:var(--forest-800);border-radius:inherit}.daily-average{margin:.65rem 0 .15rem;color:var(--muted);font-size:.78rem}.daily-average strong{color:var(--forest-950);font-variant-numeric:tabular-nums}.average-hint{margin:.25rem 0 0;max-width:35rem;color:var(--muted);font-size:.7rem;line-height:1.5}.complete-metadata,.retry{color:var(--forest-800);font-size:.75rem;font-weight:750;text-decoration:underline;text-underline-offset:.2em}.complete-metadata{display:block;margin:.6rem 0}.retry{padding:.5rem 0;border:0;background:transparent;cursor:pointer}.unavailable{color:var(--muted);font-size:.8rem}.unavailable p{margin:0}`] })
export class BookProgressComponent {
  @Input({ required: true }) book!: Book;
  readonly store = inject(DashboardStore);
  number(value: number): string { return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value); }
}
