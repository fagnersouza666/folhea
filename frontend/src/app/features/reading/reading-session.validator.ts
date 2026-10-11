import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const readingSessionValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const pages = Number(control.get('pages')?.value ?? 0);
  const minutes = Number(control.get('minutes')?.value ?? 0);
  return pages > 0 || minutes > 0 ? null : { emptyReading: true };
};

/** Numeric inputs may emit null for an omitted optional value. */
export const wholeNumberValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null =>
  control.value == null || Number.isInteger(control.value) ? null : { integer: true };

export const calendarDateValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: true };
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? null : { date: true };
};

export function notFutureDateValidator(today: () => string): ValidatorFn {
  return (control) => calendarDateValidator(control) ?? (control.value > today() ? { future: true } : null);
}
