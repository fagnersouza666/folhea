import { FormControl, FormGroup } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { calendarDateValidator, notFutureDateValidator, readingSessionValidator, wholeNumberValidator } from './reading-session.validator';

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


describe('calendar dates and integer quantities', () => {
  it('accepts an omitted optional number but rejects fractions', () => {
    expect(wholeNumberValidator(new FormControl(null))).toBeNull();
    expect(wholeNumberValidator(new FormControl(1.5))).toEqual({ integer: true });
  });
  it('rejects impossible dates and future days using the account calendar', () => {
    expect(calendarDateValidator(new FormControl('2026-02-30'))).toEqual({ date: true });
    const validate = notFutureDateValidator(() => '2026-09-05');
    expect(validate(new FormControl('2026-09-06'))).toEqual({ future: true });
    expect(validate(new FormControl('2026-09-05'))).toBeNull();
  });
});
