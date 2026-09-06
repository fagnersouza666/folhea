import { describe, expect, it } from 'vitest';
import { addDays, calendarDate, currentStreak, periodStats } from './reading-statistics';
import { Book, ReadingSession } from '../models/models';

const session = (readingDate: string, pages = 10, minutes = 0): ReadingSession => ({ id: readingDate, bookId: 'book', readingDate, pages, minutes });
const book = (finishedOn?: string): Book => ({ id: finishedOn ?? 'book', title: 'Livro', status: 'FINISHED', finishedOn });

describe('reading statistics', () => {
  it('counts a streak from yesterday when today has no reading', () => {
    expect(currentStreak([session('2026-09-05'), session('2026-09-04')], '2026-09-06')).toBe(2);
  });

  it('does not count a zero-progress session as reading', () => {
    expect(currentStreak([session('2026-09-06', 0, 0)], '2026-09-06')).toBe(0);
  });

  it('handles multiple sessions on one day and a broken sequence', () => {
    expect(currentStreak([session('2026-09-06'), session('2026-09-06'), session('2026-09-04')], '2026-09-06')).toBe(1);
  });

  it('sums period metrics and only counts books finished inside the period', () => {
    const stats = periodStats([session('2026-09-05', 20, 30), session('2026-09-01', 10, 15)], [book('2026-09-05'), book('2026-08-31')], '2026-09-01', '2026-09-06', 4);
    expect(stats).toMatchObject({ pages: 30, minutes: 45, booksFinished: 1, currentStreakDays: 4 });
  });

  it('adds calendar days without local timezone drift', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('formats today in the account timezone', () => {
    const instant = new Date('2026-09-06T02:30:00Z');
    expect(calendarDate(instant, 'America/Sao_Paulo')).toBe('2026-09-05');
    expect(calendarDate(instant, 'UTC')).toBe('2026-09-06');
  });
});
