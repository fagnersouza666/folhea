import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Book } from '../../core/models/models';
import { DashboardStore } from '../../core/state/dashboard.store';

@Component({ selector: 'folhea-book-progress', standalone: true, imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush, template: `
  <div class="book-progress" [attr.aria-label]="'Progresso de ' + book.title">
    @if (store.bookStatsLoading(book.id) || book.id.startsWith('local-')) { <p class="unavailable" role="status">Atualizando progresso…</p> }
    @else if (store.bookStatsError(book.id) || !store.bookStats(book.id)) { <div class="unavailable" role="status"><p>Progresso indisponível.</p><button type="button" class="retry" (click)="store.loadBookStats(book.id)">Tentar novamente</button></div> }
    @else if (store.bookStats(book.id); as stats) {
      <div class="progress-heading"><p class="pages-read"><strong>{{ number(stats.pagesRead) }}</strong> {{ stats.totalPages ? 'de ' + number(stats.totalPages) + ' páginas' : 'páginas lidas' }}</p>@if (stats.progressPercent !== null) { <span class="percent">{{ number(stats.progressPercent) }}%</span> }</div>
      @if (stats.progressPercent !== null) { <div class="progress-track" role="progressbar" [attr.aria-label]="'Conclusão de ' + book.title" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="stats.progressPercent" [attr.aria-valuetext]="number(stats.progressPercent) + '%'"><div [style.width.%]="stats.progressPercent"></div></div> }
      @else { <a class="complete-metadata" [routerLink]="['/app/livros', book.id]">Informe o total de páginas para acompanhar a conclusão.</a> }
      @if (stats.averagePagesPerReadingDay !== null) { <p class="daily-average"><strong>{{ average(stats.averagePagesPerReadingDay) }}</strong> páginas por dia de leitura</p><p class="average-hint">Média dos dias em que você registrou páginas neste livro.</p> }
      @else { <p class="average-hint">Sem leituras com páginas. Registre páginas para acompanhar seu ritmo.</p> }
    }
  </div>
`, styles: [`:host{display:block}.book-progress{padding-top:.75rem}.progress-heading{display:flex;align-items:baseline;justify-content:space-between;gap:.6rem}.pages-read{margin:0;color:var(--muted);font-size:.8rem}.pages-read strong{color:var(--forest-950);font-variant-numeric:tabular-nums;font-size:1rem}.percent{color:var(--forest-800);font-size:.82rem;font-weight:800;white-space:nowrap}.progress-track{height:.4rem;margin:.6rem 0 .8rem;border-radius:99px;background:var(--forest-100);overflow:hidden}.progress-track div{height:100%;background:var(--forest-800);border-radius:inherit}.daily-average{margin:.65rem 0 .15rem;color:var(--muted);font-size:.78rem}.daily-average strong{color:var(--forest-950);font-variant-numeric:tabular-nums}.average-hint{margin:.25rem 0 0;max-width:35rem;color:var(--muted);font-size:.7rem;line-height:1.5}.complete-metadata,.retry{color:var(--forest-800);font-size:.75rem;font-weight:750;text-decoration:underline;text-underline-offset:.2em}.complete-metadata{display:block;margin:.6rem 0}.retry{padding:.5rem 0;border:0;background:transparent;cursor:pointer}.unavailable{color:var(--muted);font-size:.8rem}.unavailable p{margin:0}`] })
export class BookProgressComponent {
  @Input({ required: true }) book!: Book;
  readonly store = inject(DashboardStore);
  number(value: number): string { return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value); }
  average(value: number): string { return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value); }
}
