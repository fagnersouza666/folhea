import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const readingSessionValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const pages = Number(control.get('pages')?.value ?? 0);
  const minutes = Number(control.get('minutes')?.value ?? 0);
  return pages > 0 || minutes > 0 ? null : { emptyReading: true };
};
