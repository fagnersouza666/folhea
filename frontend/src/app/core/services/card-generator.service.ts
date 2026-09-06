import { Injectable } from '@angular/core';

export type CardTemplate = 'minimal' | 'photo' | 'dark';

export interface CardMetrics {
  period: string;
  streak: number;
  pages: number;
  minutes: number;
  booksFinished: number;
}

export interface CardRenderOptions {
  template: CardTemplate;
  background?: File | null;
  cropX?: number;
  cropY?: number;
  overlay?: number;
}

@Injectable({ providedIn: 'root' })
export class CardGeneratorService {
  readonly width = 1080;
  readonly height = 1920;

  async render(metrics: CardMetrics, options: CardRenderOptions): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas indisponível neste navegador.');

    const template = options.template;
    const colors = template === 'dark'
      ? { background: '#102e29', foreground: '#fffdf8', muted: '#b7d4c5', accent: '#f0b86b' }
      : { background: '#f7f4ed', foreground: '#102e29', muted: '#66726c', accent: '#d9745f' };
    context.fillStyle = colors.background;
    context.fillRect(0, 0, this.width, this.height);

    if (template === 'photo' && options.background) {
      const image = await this.loadImage(options.background);
      this.drawCover(context, image, options.cropX ?? .5, options.cropY ?? .5);
      context.fillStyle = `rgb(16 46 41 / ${Math.min(0.85, Math.max(.2, options.overlay ?? .48))})`;
      context.fillRect(0, 0, this.width, this.height);
    }

    context.fillStyle = colors.accent;
    context.fillRect(90, 150, 90, 12);
    context.fillStyle = colors.foreground;
    context.font = '800 42px Inter, Arial, sans-serif';
    context.fillText('FOLHEA', 90, 235);
    context.font = '500 30px Inter, Arial, sans-serif';
    context.fillStyle = colors.muted;
    context.fillText(metrics.period, 90, 300);

    context.fillStyle = colors.foreground;
    context.font = '700 84px Georgia, serif';
    this.wrapText(context, 'Minha semana de leitura', 90, 500, 820, 100);

    const items = [
      [`${metrics.streak}`, 'dias seguidos'],
      [`${metrics.pages}`, 'páginas'],
      [this.formatMinutes(metrics.minutes), 'de leitura'],
      [`${metrics.booksFinished}`, metrics.booksFinished === 1 ? 'livro concluído' : 'livros concluídos']
    ];
    items.forEach(([value, label], index) => {
      const y = 890 + index * 175;
      context.fillStyle = colors.accent;
      context.beginPath();
      context.arc(115, y - 18, 14, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = colors.foreground;
      context.font = '700 64px Georgia, serif';
      context.fillText(value, 165, y);
      context.fillStyle = colors.muted;
      context.font = '500 28px Inter, Arial, sans-serif';
      context.fillText(label, 165, y + 45);
    });

    context.fillStyle = colors.muted;
    context.font = '500 28px Inter, Arial, sans-serif';
    context.fillText('Cada página conta.', 90, 1770);
    context.fillStyle = colors.foreground;
    context.font = '800 34px Inter, Arial, sans-serif';
    context.fillText('folhea', 90, 1835);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível criar o card.')), 'image/png'));
  }

  private drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, cropX: number, cropY: number): void {
    const scale = Math.max(this.width / image.naturalWidth, this.height / image.naturalHeight);
    const sourceWidth = this.width / scale;
    const sourceHeight = this.height / scale;
    const x = Math.max(0, Math.min(1, cropX)) * (image.naturalWidth - sourceWidth);
    const y = Math.max(0, Math.min(1, cropY)) * (image.naturalHeight - sourceHeight);
    context.drawImage(image, x, y, sourceWidth, sourceHeight, 0, 0, this.width, this.height);
  }

  private loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler esta foto.')); };
      image.src = url;
    });
  }

  private wrapText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
    const words = text.split(' ');
    let line = '';
    let lineY = y;
    words.forEach((word) => {
      const candidate = `${line}${word} `;
      if (context.measureText(candidate).width > maxWidth && line) {
        context.fillText(line.trim(), x, lineY);
        lineY += lineHeight;
        line = `${word} `;
      } else line = candidate;
    });
    context.fillText(line.trim(), x, lineY);
  }

  private formatMinutes(minutes: number): string { return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}min` : ''}` : `${minutes}min`; }
}
