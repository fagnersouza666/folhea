import { describe, expect, it } from 'vitest';
import { CardGeneratorService } from './card-generator.service';

describe('CardGeneratorService', () => {
  it('uses the Folhea 9:16 export dimensions', () => {
    const generator = new CardGeneratorService();
    expect(generator.width).toBe(1080);
    expect(generator.height).toBe(1920);
  });
});
