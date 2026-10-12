import { ChangeDetectionStrategy, Component, inject, Input, OnChanges, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api-client.service';
import { Book } from '../../core/models/models';

@Component({ selector: 'folhea-book-cover', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: `
  @if (book.cover && !failed()) { <img [src]="url()" [alt]="'Capa de ' + book.title" loading="lazy" decoding="async" (error)="failed.set(true)" /> }
  @else { <div class="placeholder" [attr.aria-label]="book.cover ? 'Capa indisponível' : 'Livro sem capa'"><span aria-hidden="true">{{ book.title[0] }}</span></div>@if (book.cover) { <p class="cover-status">Capa indisponível</p><button type="button" class="cover-retry" (click)="retry()">Tentar capa novamente</button> } }
`, styles: [`:host{display:block;flex:none;width:4.5rem}img,.placeholder{display:block;width:100%;aspect-ratio:2/3;border-radius:.4rem .65rem .65rem .4rem;object-fit:cover}.placeholder{display:grid;place-items:center;color:var(--forest-950);background:var(--amber);font-family:Georgia,serif;font-size:2rem;box-shadow:inset .35rem 0 rgb(185 115 53 / 25%)}.cover-status{margin:.4rem 0 0;color:var(--muted);font-size:.65rem;line-height:1.4}.cover-retry{padding:.3rem 0;border:0;background:transparent;color:var(--forest-800);font-size:.65rem;text-decoration:underline;cursor:pointer}`] })
export class BookCoverComponent implements OnChanges {
  @Input({ required: true }) book!: Book;
  readonly failed = signal(false);
  private readonly api = inject(ApiClient);
  private identity = '';
  private attempt = 0;
  ngOnChanges(): void {
    const identity = this.book.id + ':' + (this.book.cover?.version ?? '');
    if (this.identity !== identity) { this.identity = identity; this.attempt = 0; this.failed.set(false); }
  }
  url(): string {
    const url = this.api.bookCoverUrl(this.book.id, this.book.cover?.version ?? '');
    return this.attempt ? url + '&retry=' + this.attempt : url;
  }
  retry(): void { this.attempt++; this.failed.set(false); }
}
