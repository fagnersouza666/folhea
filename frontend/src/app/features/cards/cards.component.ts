import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardStore } from '../../core/state/dashboard.store';
import { CardGeneratorService, CardTemplate } from '../../core/services/card-generator.service';
import { StatsPeriod } from '../../core/models/models';

@Component({
  selector: 'folhea-cards',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-heading"><div><p class="eyebrow">Pequenas vitórias</p><h1>Seu card</h1></div><a routerLink="/app/progresso" class="back-link">← Progresso</a></div>
    <p class="intro">Transforme seu ritmo de leitura em uma imagem 9:16 para guardar ou compartilhar.</p>
    @if (error) { <div class="alert alert-error" role="alert">{{ error }}</div> }
    <div class="card-workspace">
      <section class="preview-panel surface" aria-labelledby="preview-title"><h2 id="preview-title" class="sr-only">Prévia do card</h2><div class="card-preview" [class.dark]="template === 'dark'" [class.photo]="template === 'photo'" [style.backgroundImage]="template === 'photo' && backgroundUrl ? 'url(' + backgroundUrl + ')' : null"><div class="preview-overlay"></div><div class="preview-content"><span class="preview-brand">FOLHEA</span><span class="preview-period">{{ periodLabel }}</span><strong>Minha semana<br />de leitura</strong><div class="preview-metrics"><span><b>{{ metrics().streak }}</b> dias seguidos</span><span><b>{{ metrics().pages }}</b> páginas</span><span><b>{{ formatMinutes(metrics().minutes) }}</b> de leitura</span><span><b>{{ metrics().booksFinished }}</b> {{ metrics().booksFinished === 1 ? 'livro concluído' : 'livros concluídos' }}</span></div><small>Cada página conta.</small></div></div></section>
      <section class="controls" aria-labelledby="controls-title"><h2 id="controls-title">Personalize</h2>
        <fieldset><legend>Período</legend><div class="choice-grid period-grid">@for (option of periods; track option.id) { <button type="button" [class.selected]="store.period() === option.id" [attr.aria-pressed]="store.period() === option.id" (click)="selectPeriod(option.id)">{{ option.label }}</button> }</div></fieldset>
        <fieldset><legend>Modelo</legend><div class="choice-grid">@for (option of templates; track option.id) { <button type="button" [class.selected]="template === option.id" [attr.aria-pressed]="template === option.id" (click)="chooseTemplate(option.id)"><span class="template-swatch" [class.dark-swatch]="option.id === 'dark'" [class.photo-swatch]="option.id === 'photo'" aria-hidden="true"></span>{{ option.label }}</button> }</div></fieldset>
        <label class="upload-field" for="card-background">Foto de fundo <span>opcional</span><input id="card-background" type="file" accept="image/jpeg,image/png,image/webp,image/avif" (change)="selectBackground($event)" aria-describedby="card-background-hint" /><small id="card-background-hint">A foto permanece no seu dispositivo e não é enviada ao Folhea.</small></label>
        @if (template === 'photo' && backgroundUrl) { <div class="range-fields"><label for="card-crop-x">Enquadramento horizontal<input id="card-crop-x" type="range" min="0" max="1" step=".01" [value]="cropX" (input)="cropX = numberValue($event)" /></label><label for="card-crop-y">Enquadramento vertical<input id="card-crop-y" type="range" min="0" max="1" step=".01" [value]="cropY" (input)="cropY = numberValue($event)" /></label><label for="card-overlay">Overlay<input id="card-overlay" type="range" min=".2" max=".85" step=".01" [value]="overlay" (input)="overlay = numberValue($event)" /></label></div> }
        <div class="action-row"><button class="button button-primary" type="button" [disabled]="busy" (click)="download()">{{ busy ? 'Gerando…' : 'Salvar PNG' }}</button><button class="button button-secondary" type="button" [disabled]="busy" (click)="share()">Compartilhar</button></div>
      </section>
    </div>
  `,
  styles: [`
    :host{display:grid;gap:.8rem}.page-heading{display:flex;align-items:end;justify-content:space-between;gap:1rem}.page-heading h1{margin:.35rem 0 0;color:var(--forest-950);font-family:Georgia,serif;font-size:2.35rem;line-height:1}.back-link{color:var(--forest-800);font-size:.8rem;font-weight:750}.intro{max-width:38rem;margin:0 0 1rem;color:var(--muted);line-height:1.55}.card-workspace{display:grid;gap:1rem}.preview-panel{display:grid;place-items:center;padding:1rem;background:#e9e4da}.card-preview{position:relative;isolation:isolate;width:min(100%,20rem);aspect-ratio:9/16;overflow:hidden;border-radius:1rem;background:var(--cream-100);background-position:center;background-size:cover;box-shadow:0 1rem 2rem rgb(23 63 53 / 18%)}.card-preview.dark{color:var(--cream-50);background:var(--forest-950)}.card-preview.photo{color:var(--cream-50)}.preview-overlay{position:absolute;inset:0;z-index:-1;background:rgb(16 46 41 / .48)}.card-preview:not(.photo) .preview-overlay{display:none}.preview-content{display:grid;align-content:space-between;height:100%;padding:12% 11%}.preview-brand{color:var(--coral);font-size:.7rem;font-weight:850;letter-spacing:.1em}.dark .preview-brand,.photo .preview-brand{color:var(--amber)}.preview-period{color:var(--muted);font-size:.58rem}.dark .preview-period,.photo .preview-period{color:#b7d4c5}.preview-content strong{margin-top:22%;font-family:Georgia,serif;font-size:1.6rem;line-height:1.08}.preview-metrics{display:grid;gap:.7rem;margin-top:auto;margin-bottom:auto}.preview-metrics span{display:grid;gap:.1rem;color:var(--muted);font-size:.58rem}.dark .preview-metrics span,.photo .preview-metrics span{color:#b7d4c5}.preview-metrics b{color:var(--forest-950);font-family:Georgia,serif;font-size:1.15rem}.dark .preview-metrics b,.photo .preview-metrics b{color:var(--cream-50)}.preview-content small{color:var(--muted);font-size:.58rem}.dark .preview-content small,.photo .preview-content small{color:#b7d4c5}.controls{display:grid;gap:1.1rem;padding-bottom:1rem}.controls h2{margin:.4rem 0 0;color:var(--forest-950);font-family:Georgia,serif;font-size:1.35rem}.controls fieldset{display:grid;gap:.55rem;border:0;margin:0;padding:0}.controls legend,.upload-field{color:var(--forest-950);font-size:.8rem;font-weight:800}.choice-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem}.choice-grid button{display:flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.8rem;border:1px solid #cbd8cf;border-radius:.7rem;color:var(--forest-800);background:var(--cream-50);font-size:.75rem;font-weight:750}.choice-grid button.selected{border-color:var(--forest-800);color:var(--cream-50);background:var(--forest-800)}.template-swatch{width:.8rem;height:.8rem;border-radius:50%;background:var(--cream-200)}.dark-swatch{background:var(--forest-950)}.photo-swatch{background:linear-gradient(135deg,var(--coral),var(--forest-800))}.upload-field{display:grid;gap:.45rem}.upload-field span,.upload-field small{color:var(--muted);font-size:.7rem;font-weight:500}.upload-field input{width:100%;border:1px dashed #a9bdb0;border-radius:.7rem;padding:.65rem;background:var(--cream-50);font-size:.75rem}.range-fields{display:grid;gap:.6rem}.range-fields label{display:grid;gap:.3rem;color:var(--muted);font-size:.72rem}.range-fields input{accent-color:var(--forest-800)}.action-row{display:flex;gap:.6rem}.action-row .button{flex:1}.button:disabled{cursor:wait;opacity:.6}@media(min-width:760px){.card-workspace{grid-template-columns:minmax(18rem,22rem) 1fr;align-items:start}.preview-panel{position:sticky;top:1rem}.controls{padding:1rem 0 0 1rem}.card-preview{width:100%}}
  `]
})
export class CardsComponent implements OnDestroy {
  readonly store = inject(DashboardStore);
  private readonly generator = inject(CardGeneratorService);
  readonly periods: { id: StatsPeriod; label: string }[] = [{ id: 'today', label: 'Hoje' }, { id: '7', label: '7 dias' }, { id: '30', label: '30 dias' }, { id: 'all', label: 'Tudo' }];
  readonly templates: { id: CardTemplate; label: string }[] = [{ id: 'minimal', label: 'Minimal' }, { id: 'photo', label: 'Foto' }, { id: 'dark', label: 'Dark' }];
  readonly metrics = computed(() => { const stats = this.store.stats(); const dashboard = this.store.dashboard(); return { streak: stats?.currentStreakDays ?? dashboard?.currentStreakDays ?? 0, pages: stats?.pages ?? dashboard?.week.pages ?? 0, minutes: stats?.minutes ?? dashboard?.week.minutes ?? 0, booksFinished: stats?.booksFinished ?? dashboard?.week.booksFinished ?? 0 }; });
  template: CardTemplate = 'minimal';
  background: File | null = null;
  backgroundUrl: string | null = null;
  cropX = .5;
  cropY = .5;
  overlay = .48;
  busy = false;
  error: string | null = null;
  private blob: Blob | null = null;
  private blobUrl: string | null = null;

  get periodLabel(): string { return this.periods.find((period) => period.id === this.store.period())?.label ?? '7 dias'; }
  selectPeriod(period: StatsPeriod): void { this.store.selectPeriod(period); }
  chooseTemplate(template: CardTemplate): void { this.template = template; this.blob = null; }
  selectBackground(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { this.error = 'Escolha uma imagem válida.'; return; }
    if (this.backgroundUrl) URL.revokeObjectURL(this.backgroundUrl);
    this.background = file;
    this.backgroundUrl = URL.createObjectURL(file);
    this.template = 'photo';
    this.blob = null;
    this.error = null;
  }

  numberValue(event: Event): number { return Number((event.target as HTMLInputElement).value); }

  async download(): Promise<void> {
    const blob = await this.render();
    if (!blob) return;
    const link = document.createElement('a');
    link.href = this.objectUrl(blob);
    link.download = 'folhea-card.png';
    link.click();
  }

  async share(): Promise<void> {
    const blob = await this.render();
    if (!blob) return;
    const file = new File([blob], 'folhea-card.png', { type: 'image/png' });
    const canShare = typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare({ files: [file] }));
    if (canShare) {
      try { await navigator.share({ title: 'Meu progresso no Folhea', text: 'Cada página conta.', files: [file] }); return; } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; }
    }
    await this.download();
  }

  ngOnDestroy(): void { if (this.backgroundUrl) URL.revokeObjectURL(this.backgroundUrl); if (this.blobUrl) URL.revokeObjectURL(this.blobUrl); }

  private async render(): Promise<Blob | null> {
    if (this.blob) return this.blob;
    this.busy = true;
    this.error = null;
    try { this.blob = await this.generator.render({ ...this.metrics(), period: this.periodLabel }, { template: this.template, background: this.background, cropX: this.cropX, cropY: this.cropY, overlay: this.overlay }); return this.blob; }
    catch { this.error = 'Não foi possível gerar o card neste dispositivo.'; return null; }
    finally { this.busy = false; }
  }

  private objectUrl(blob: Blob): string { if (this.blobUrl) URL.revokeObjectURL(this.blobUrl); this.blobUrl = URL.createObjectURL(blob); return this.blobUrl; }
  formatMinutes(minutes: number): string { return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}min` : ''}` : `${minutes}min`; }
}
