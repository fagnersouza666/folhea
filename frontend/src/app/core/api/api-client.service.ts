import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, Observable, throwError } from 'rxjs';
import { Book, Dashboard, ReadingDraft, ReadingSession, Stats, User } from '../models/models';

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/v1';

  getMe(): Observable<User> { return this.request(this.http.get<User>(`${this.baseUrl}/me`)); }
  getDashboard(): Observable<Dashboard> { return this.request(this.http.get<Dashboard>(`${this.baseUrl}/dashboard`)); }
  getBooks(): Observable<Book[]> { return this.request(this.http.get<Book[]>(`${this.baseUrl}/books`)); }
  createBook(input: { title: string; author?: string }): Observable<Book> { return this.request(this.http.post<Book>(`${this.baseUrl}/books`, input)); }
  createSession(input: ReadingDraft): Observable<ReadingSession> { return this.request(this.http.post<ReadingSession>(`${this.baseUrl}/sessions`, input)); }
  getStats(from?: string, to?: string): Observable<Stats> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.request(this.http.get<Stats>(`${this.baseUrl}/stats`, { params }));
  }

  private request<T>(request: Observable<T>): Observable<T> {
    return request.pipe(catchError((error: HttpErrorResponse) => throwError(() => error)));
  }
}
