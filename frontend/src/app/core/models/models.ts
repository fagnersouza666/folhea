export type BookStatus = 'READING' | 'FINISHED';
export type StatsPeriod = 'today' | '7' | '30' | 'all';

export interface User {
  id: string;
  email: string;
  timezone: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserExport {
  user: User;
  books: Book[];
  sessions: ReadingSession[];
  covers?: (BookCover & { bookId: string; dataBase64: string })[];
  photos?: { bookId: string; contentType: 'image/jpeg'; sha256: string; byteSize: number; createdAt: string; updatedAt: string; dataBase64: string }[];
}

export interface BookCover {
  mediaType: 'image/jpeg' | 'image/png';
  byteSize: number;
  width: number;
  height: number;
  version: string;
}

export interface BookStats {
  pagesRead: number;
  totalPages: number | null;
  percent: number | null;
  averagePagesPerDay: number;
  firstDate: string | null;
  referenceDate: string;
  elapsedDays: number;
}

/** Official session progress, projected from the top-level book response. */
export interface BookProgress {
  pagesRead: number;
  totalPages: number | null;
  averagePagesPerReadingDay: number | null;
  progressPercent: number | null;
}

export interface BookCreate {
  title: string;
  author?: string | null;
  edition?: string | null;
  totalPages?: number | null;
}

export interface Book {
  id: string;
  userId?: string;
  title: string;
  author?: string | null;
  edition?: string | null;
  totalPages?: number | null;
  cover?: BookCover | null;
  hasPhoto?: boolean;
  // Absent on optimistic/older responses: never substitute calendar statistics.
  pagesRead?: number;
  averagePagesPerReadingDay?: number | null;
  progressPercent?: number | null;
  // Optimistic and older responses do not yet have confirmed metrics.
  stats?: BookStats;
  status: BookStatus;
  finishedOn?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReadingSession {
  id: string;
  userId?: string;
  bookId: string;
  readingDate: string;
  pages: number;
  minutes: number;
  createdAt?: string;
  updatedAt?: string;
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

export interface BookPatch { title?: string; author?: string | null; edition?: string | null; totalPages?: number | null; }
export interface ReadingSessionPatch {
  bookId?: string;
  readingDate?: string;
  pages?: number;
  minutes?: number;
}

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
}
