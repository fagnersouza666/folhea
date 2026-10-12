import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, Observable, throwError } from 'rxjs';
import { Book, BookCreate, BookPatch, Dashboard, ReadingDraft, ReadingSession, ReadingSessionPatch, Stats, User, UserExport } from '../models/models';

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/v1';

  getMe(): Observable<User> { return this.request(this.http.get<User>(`${this.baseUrl}/me`, this.options())); }
  updateMe(timezone: string): Observable<User> { return this.request(this.http.patch<User>(`${this.baseUrl}/me`, { timezone }, this.options())); }
  exportMe(): Observable<UserExport> { return this.request(this.http.get<UserExport>(`${this.baseUrl}/me/export`, this.options())); }
  deleteAccount(): Observable<void> { return this.request(this.http.delete<void>(`${this.baseUrl}/me`, { ...this.options(), body: { confirm: true } })); }
  getDashboard(): Observable<Dashboard> { return this.request(this.http.get<Dashboard>(`${this.baseUrl}/dashboard`, this.options())); }
  getBooks(limit?: number, offset?: number): Observable<Book[]> {
    return this.request(this.http.get<Book[]>(`${this.baseUrl}/books`, { ...this.options(), params: this.paginationParams(limit, offset) }));
  }
  getBook(id: string): Observable<Book> { return this.request(this.http.get<Book>(`${this.baseUrl}/books/${encodeURIComponent(id)}`, this.options())); }
  createBook(input: BookCreate, cover?: File): Observable<Book> { return this.request(this.http.post<Book>(`${this.baseUrl}/books`, cover ? this.bookMultipart(input, cover) : input, this.options())); }
  updateBook(id: string, input: BookPatch, cover?: File): Observable<Book> { return this.request(this.http.patch<Book>(`${this.baseUrl}/books/${encodeURIComponent(id)}`, cover ? this.bookMultipart(input, cover) : input, this.options())); }
  deleteBookCover(id: string): Observable<void> { return this.request(this.http.delete<void>(`${this.baseUrl}/books/${encodeURIComponent(id)}/cover`, this.options())); }
  uploadBookPhoto(id: string, photo: File): Observable<Book> {
    return this.request(this.http.put<Book>(`${this.baseUrl}/books/${encodeURIComponent(id)}/photo`, photo,
      { ...this.options(), headers: { ...this.options().headers, 'Content-Type': photo.type } }));
  }
  deleteBookPhoto(id: string): Observable<void> { return this.request(this.http.delete<void>(`${this.baseUrl}/books/${encodeURIComponent(id)}/photo`, this.options())); }
  bookPhotoUrl(id: string): string { return `${this.baseUrl}/books/${encodeURIComponent(id)}/photo`; }
  bookCoverUrl(id: string, version: string): string { return `${this.baseUrl}/books/${encodeURIComponent(id)}/cover?v=${encodeURIComponent(version)}`; }
  deleteBook(id: string): Observable<void> { return this.request(this.http.delete<void>(`${this.baseUrl}/books/${encodeURIComponent(id)}`, this.options())); }
  finishBook(id: string, finishedOn?: string): Observable<Book> {
    return this.request(this.http.post<Book>(`${this.baseUrl}/books/${encodeURIComponent(id)}/finish`, finishedOn ? { finishedOn } : {}, this.options()));
  }
  reopenBook(id: string): Observable<Book> { return this.request(this.http.delete<Book>(`${this.baseUrl}/books/${encodeURIComponent(id)}/finish`, this.options())); }
  getSessions(from?: string, to?: string, limit?: number, offset?: number): Observable<ReadingSession[]> {
    return this.request(this.http.get<ReadingSession[]>(`${this.baseUrl}/sessions`, {
      ...this.options(),
      params: this.listParams(from, to, limit, offset)
    }));
  }
  getSession(id: string): Observable<ReadingSession> { return this.request(this.http.get<ReadingSession>(`${this.baseUrl}/sessions/${encodeURIComponent(id)}`, this.options())); }
  createSession(input: ReadingDraft): Observable<ReadingSession> { return this.request(this.http.post<ReadingSession>(`${this.baseUrl}/sessions`, input, this.options())); }
  updateSession(id: string, input: ReadingSessionPatch): Observable<ReadingSession> { return this.request(this.http.patch<ReadingSession>(`${this.baseUrl}/sessions/${encodeURIComponent(id)}`, input, this.options())); }
  deleteSession(id: string): Observable<void> { return this.request(this.http.delete<void>(`${this.baseUrl}/sessions/${encodeURIComponent(id)}`, this.options())); }
  getStats(from?: string, to?: string, period?: string): Observable<Stats> {
    return this.request(this.http.get<Stats>(`${this.baseUrl}/stats`, { ...this.options(), params: this.statsParams(from, to, period) }));
  }

  private options() { return { withCredentials: true, headers: { Accept: 'application/json', 'Cache-Control': 'no-store' } }; }

  private bookMultipart(input: BookCreate | BookPatch, cover: File): FormData {
    const form = new FormData();
    form.append('book', new Blob([JSON.stringify(input)], { type: 'application/json' }));
    form.append('cover', cover, cover.type === 'image/png' ? 'capa.png' : 'capa.jpg');
    return form;
  }

  private periodParams(from?: string, to?: string): HttpParams {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return params;
  }

  private paginationParams(limit?: number, offset?: number): HttpParams {
    let params = new HttpParams();
    if (limit != null) params = params.set('limit', limit);
    if (offset != null) params = params.set('offset', offset);
    return params;
  }

  private listParams(from?: string, to?: string, limit?: number, offset?: number): HttpParams {
    let params = this.periodParams(from, to);
    if (limit != null) params = params.set('limit', limit);
    if (offset != null) params = params.set('offset', offset);
    return params;
  }

  private statsParams(from?: string, to?: string, period?: string): HttpParams {
    if (period) return new HttpParams().set('period', period);
    return this.periodParams(from, to);
  }

  private request<T>(request: Observable<T>): Observable<T> {
    return request.pipe(catchError((error: HttpErrorResponse) => throwError(() => error)));
  }
}
