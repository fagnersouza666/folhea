import { FormControl, FormGroup } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { readingSessionValidator } from './reading-session.validator';

const session = (pages: number, minutes: number) => new FormGroup({ pages: new FormControl(pages), minutes: new FormControl(minutes) });

describe('readingSessionValidator', () => {
  it('requires pages or minutes greater than zero', () => {
    expect(readingSessionValidator(session(0, 0))).toEqual({ emptyReading: true });
  });

  it('accepts a session with pages only', () => {
    expect(readingSessionValidator(session(12, 0))).toBeNull();
  });

  it('accepts a session with minutes only', () => {
    expect(readingSessionValidator(session(0, 25))).toBeNull();
  });
});
