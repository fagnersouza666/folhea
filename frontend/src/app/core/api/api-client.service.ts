import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, Observable, throwError } from 'rxjs';
import { Book, BookPatch, Dashboard, ReadingDraft, ReadingSession, ReadingSessionPatch, Stats, User } from '../models/models';

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/v1';

  getMe(): Observable<User> { return this.request(this.http.get<User>(`${this.baseUrl}/me`)); }
  getDashboard(): Observable<Dashboard> { return this.request(this.http.get<Dashboard>(`${this.baseUrl}/dashboard`)); }
  getBooks(): Observable<Book[]> { return this.request(this.http.get<Book[]>(`${this.baseUrl}/books`)); }
  getBook(id: string): Observable<Book> { return this.request(this.http.get<Book>(`${this.baseUrl}/books/${encodeURIComponent(id)}`)); }
  createBook(input: { title: string; author?: string }): Observable<Book> { return this.request(this.http.post<Book>(`${this.baseUrl}/books`, input)); }
  updateBook(id: string, input: BookPatch): Observable<Book> { return this.request(this.http.patch<Book>(`${this.baseUrl}/books/${encodeURIComponent(id)}`, input)); }
  deleteBook(id: string): Observable<void> { return this.request(this.http.delete<void>(`${this.baseUrl}/books/${encodeURIComponent(id)}`)); }
  finishBook(id: string, finishedOn?: string): Observable<Book> {
    return this.request(this.http.post<Book>(`${this.baseUrl}/books/${encodeURIComponent(id)}/finish`, finishedOn ? { finishedOn } : {}));
  }
  reopenBook(id: string): Observable<Book> { return this.request(this.http.delete<Book>(`${this.baseUrl}/books/${encodeURIComponent(id)}/finish`)); }
  getSessions(from?: string, to?: string): Observable<ReadingSession[]> {
    return this.request(this.http.get<ReadingSession[]>(`${this.baseUrl}/sessions`, { params: this.periodParams(from, to) }));
  }
  createSession(input: ReadingDraft): Observable<ReadingSession> { return this.request(this.http.post<ReadingSession>(`${this.baseUrl}/sessions`, input)); }
  updateSession(id: string, input: ReadingSessionPatch): Observable<ReadingSession> { return this.request(this.http.patch<ReadingSession>(`${this.baseUrl}/sessions/${encodeURIComponent(id)}`, input)); }
  deleteSession(id: string): Observable<void> { return this.request(this.http.delete<void>(`${this.baseUrl}/sessions/${encodeURIComponent(id)}`)); }
  getStats(from?: string, to?: string): Observable<Stats> {
    return this.request(this.http.get<Stats>(`${this.baseUrl}/stats`, { params: this.periodParams(from, to) }));
  }

  private periodParams(from?: string, to?: string): HttpParams {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return params;
  }

  private request<T>(request: Observable<T>): Observable<T> {
    return request.pipe(catchError((error: HttpErrorResponse) => throwError(() => error)));
  }
}
