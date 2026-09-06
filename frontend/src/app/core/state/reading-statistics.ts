import { Book, ReadingSession, Stats } from '../models/models';

/** A reading day is counted once even when it contains multiple sessions. */
export function currentStreak(sessions: readonly ReadingSession[], today: string): number {
  const days = new Set(sessions.filter(hasProgress).map((session) => session.readingDate));
  let cursor = days.has(today) ? today : addDays(today, -1);
  if (!days.has(cursor)) return 0;

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function periodStats(
  sessions: readonly ReadingSession[],
  books: readonly Book[],
  from: string,
  to: string,
  streak: number
): Stats {
  const periodSessions = sessions.filter((session) => hasProgress(session)
    && session.readingDate >= from && session.readingDate <= to);
  return {
    period: { from, to },
    currentStreakDays: streak,
    pages: periodSessions.reduce((sum, session) => sum + session.pages, 0),
    minutes: periodSessions.reduce((sum, session) => sum + session.minutes, 0),
    booksFinished: books.filter((book) => book.status === 'FINISHED'
      && Boolean(book.finishedOn)
      && book.finishedOn! >= from && book.finishedOn! <= to).length
  };
}

export function hasProgress(session: Pick<ReadingSession, 'pages' | 'minutes'>): boolean {
  return session.pages > 0 || session.minutes > 0;
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function startOfPeriod(period: 'today' | '7' | '30', today: string): string {
  return period === 'today' ? today : addDays(today, period === '7' ? -6 : -29);
}
