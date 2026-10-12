import { ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, inject, Input, Output, signal } from '@angular/core';
import { normalizeCover } from './cover-image';

export interface CoverSelection { file: File | null; preparing: boolean; error: string | null }

@Component({ selector: 'folhea-cover-picker', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: `
  <fieldset class="cover-picker"><legend>Foto de capa <span>opcional</span></legend>
    <p [id]="prefix + '-cover-hint'">JPEG ou PNG de até 8 MB. Sua capa fica privada na sua conta.</p>
    @if (preview()) { <img class="preview" [src]="preview()" alt="Prévia da capa escolhida" /> }
    <div class="choices">
      <div class="field"><label [for]="prefix + '-cover-file'">Escolher capa</label><input [id]="prefix + '-cover-file'" type="file" accept="image/jpeg,image/png" [disabled]="disabled || preparing()" [attr.aria-describedby]="prefix + '-cover-hint'" (change)="choose($event)" /></div>
      <div class="field"><label [for]="prefix + '-cover-camera'">Usar câmera</label><input [id]="prefix + '-cover-camera'" type="file" accept="image/jpeg,image/png" capture="environment" [disabled]="disabled || preparing()" [attr.aria-describedby]="prefix + '-cover-hint'" (change)="choose($event)" /></div>
    </div>
    @if (preparing()) { <p role="status">Preparando capa…</p> }
    @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
    @if (preview() || error()) { <button class="button button-quiet" type="button" [disabled]="disabled" (click)="clear()">Descartar escolha da capa</button> }
  </fieldset>
`, styles: [`:host{display:block}.cover-picker{min-width:0;margin:0;padding:1rem;border:1px solid var(--cream-200);border-radius:.8rem}.cover-picker legend{font-weight:750}.cover-picker legend span{font-size:.72rem;color:var(--muted);font-weight:500}.cover-picker p{font-size:.8rem;line-height:1.5;color:var(--muted)}.choices{display:grid;gap:1rem}.preview{display:block;width:7rem;aspect-ratio:2/3;object-fit:cover;border-radius:.4rem;margin:1rem 0}.cover-picker input{max-width:100%;font-size:.8rem}.cover-picker .field-error{color:var(--danger)}`] })
export class CoverPickerComponent {
  @Input() prefix = 'book';
  @Input() disabled = false;
  @Output() readonly selectionChange = new EventEmitter<CoverSelection>();
  readonly preparing = signal(false);
  readonly error = signal<string | null>(null);
  readonly preview = signal<string | null>(null);
  private request = 0;

  constructor() { inject(DestroyRef).onDestroy(() => { this.request++; this.revokePreview(); }); }
  async choose(event: Event): Promise<void> {
    const field = event.target as HTMLInputElement;
    const file = field.files?.[0]; field.value = '';
    if (!file) return;
    const request = ++this.request;
    this.revokePreview(); this.error.set(null); this.preparing.set(true);
    this.selectionChange.emit({ file: null, preparing: true, error: null });
    try {
      const normalized = await normalizeCover(file);
      if (request !== this.request) return;
      this.preview.set(URL.createObjectURL(normalized)); this.preparing.set(false);
      this.selectionChange.emit({ file: normalized, preparing: false, error: null });
    } catch (cause) {
      if (request !== this.request) return;
      const message = cause instanceof Error ? cause.message : 'Não foi possível preparar a capa.';
      this.error.set(message); this.preparing.set(false);
      this.selectionChange.emit({ file: null, preparing: false, error: message });
    }
  }
  clear(): void {
    this.request++; this.revokePreview(); this.error.set(null); this.preparing.set(false);
    this.selectionChange.emit({ file: null, preparing: false, error: null });
  }
  private revokePreview(): void {
    const url = this.preview(); if (url) URL.revokeObjectURL(url); this.preview.set(null);
  }
}
