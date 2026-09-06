export type BookStatus = 'READING' | 'FINISHED';

export interface User {
  id: string;
  email: string;
  timezone: string;
}

export interface Book {
  id: string;
  userId: string;
  title: string;
  author?: string;
  status: BookStatus;
  finishedOn?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReadingSession {
  id: string;
  userId: string;
  bookId: string;
  readingDate: string;
  pages: number;
  minutes: number;
}

export interface WeekStats {
  pages: number;
  minutes: number;
  booksFinished: number;
}

export interface Dashboard {
  currentStreakDays: number;
  currentBook: Pick<Book, 'id' | 'title'> | null;
  week: WeekStats;
}

export interface Stats extends WeekStats {
  currentStreakDays: number;
  period: { from: string; to: string };
}

export interface ReadingDraft {
  bookId: string;
  readingDate: string;
  pages: number;
  minutes: number;
}

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
}
