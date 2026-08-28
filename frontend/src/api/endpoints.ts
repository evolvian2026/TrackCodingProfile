import { api } from './client';
import type {
  AlertSummary,
  BatchAnalytics, ColumnMapping, CommitResult, ContestResponse, DifficultyAnalytics, FieldDefinition,
  FilterOptions, HistoryPoint, InstitutionRow, JobItem, JobProgress, JobSummary, LeaderboardRow,
  Overview, Paginated, Platform, PlatformMeta, PlatformProfile, RatingSeries, ScoreBreakdown,
  ScheduleStatus, SettingsResponse, StudentAlert, StudentDetail, StudentSummary, TopicAnalytics,
  TopicCount, UploadPreview, User,
} from '../types/api';

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

/** Drops empty values so the URL stays clean and the backend sees real filters only. */
export function cleanParams(params: QueryParams): QueryParams {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'all'),
  );
}

// -- auth --------------------------------------------------------------------
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ accessToken: string; user: User }>('/api/auth/login', { email, password }).then((r) => r.data),
  refresh: () => api.post<{ accessToken: string; user: User }>('/api/auth/refresh').then((r) => r.data),
  logout: () => api.post('/api/auth/logout').then(() => undefined),
  me: () => api.get<{ user: User }>('/api/auth/me').then((r) => r.data.user),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/api/auth/change-password', { currentPassword, newPassword }).then((r) => r.data),
  users: () => api.get<{ data: User[] }>('/api/auth/users').then((r) => r.data.data),
  createUser: (payload: { email: string; password: string; name: string; role: string }) =>
    api.post<{ user: User }>('/api/auth/users', payload).then((r) => r.data.user),
  updateUser: (id: string, payload: { role?: string; isActive?: boolean }) =>
    api.patch<{ user: User }>(`/api/auth/users/${id}`, payload).then((r) => r.data.user),
};

// -- students ----------------------------------------------------------------
export const studentsApi = {
  list: (params: QueryParams) =>
    api.get<Paginated<StudentSummary>>('/api/students', { params: cleanParams(params) }).then((r) => r.data),
  detail: (id: string) => api.get<{ data: StudentDetail }>(`/api/students/${id}`).then((r) => r.data.data),
  platforms: (id: string) => api.get<{ data: PlatformProfile[] }>(`/api/students/${id}/platforms`).then((r) => r.data.data),
  topics: (id: string, platform?: Platform) =>
    api
      .get<{ data: { unified: TopicCount[]; byPlatform: Record<string, TopicCount[]> } }>(`/api/students/${id}/topics`, {
        params: cleanParams({ platform }),
      })
      .then((r) => r.data.data),
  problems: (id: string, params: QueryParams) =>
    api.get<Paginated<{ id: string; platform: Platform; name: string; url: string | null; difficulty: string; points: number | null; topics: string[]; solvedAt: string | null }>>(
      `/api/students/${id}/problems`, { params: cleanParams(params) },
    ).then((r) => r.data),
  contests: (id: string, platform?: Platform) =>
    api.get<ContestResponse>(`/api/students/${id}/contests`, { params: cleanParams({ platform }) }).then((r) => r.data),
  ratings: (id: string, platform?: Platform) =>
    api.get<{ series: RatingSeries[] }>(`/api/students/${id}/ratings`, { params: cleanParams({ platform }) }).then((r) => r.data.series),
  history: (id: string, params: QueryParams = {}) =>
    api.get<{ data: HistoryPoint[] }>(`/api/students/${id}/history`, { params: cleanParams(params) }).then((r) => r.data.data),
  scorePreview: (id: string, weights: Record<string, number>) =>
    api.post<{ data: ScoreBreakdown }>(`/api/students/${id}/score-preview`, weights).then((r) => r.data.data),
  compare: (ids: string[]) => api.post<{ data: unknown[] }>('/api/students/compare', { ids }).then((r) => r.data.data),
  search: (q: string) =>
    api.get<{ data: { id: string; studentId: string; name: string; college: string | null; batch: string | null; branch: string | null; cpScore: number | null; totalSolved: number | null; handles: { platform: Platform; label: string; username: string; status: string }[] }[] }>(
      '/api/students/search', { params: { q } },
    ).then((r) => r.data.data),
  filters: () => api.get<FilterOptions>('/api/students/filters').then((r) => r.data),
  update: (id: string, payload: Record<string, unknown>) =>
    api.patch<{ data: StudentDetail }>(`/api/students/${id}`, payload).then((r) => r.data.data),
  remove: (id: string) => api.delete(`/api/students/${id}`).then(() => undefined),
  refreshOne: (id: string, payload: { platforms?: Platform[]; force?: boolean } = {}) =>
    api.post<{ jobId: string; number: number; totalItems: number }>(`/api/students/${id}/refresh`, payload).then((r) => r.data),
  refreshMany: (payload: {
    scope: 'selected' | 'batch' | 'all' | 'platform';
    studentIds?: string[]; batch?: string; college?: string; branch?: string; section?: string;
    platforms?: Platform[]; force?: boolean;
  }) => api.post<{ jobId: string; number: number; totalStudents: number; totalItems: number; skippedFresh: number }>('/api/students/refresh', payload).then((r) => r.data),
};

// -- uploads -----------------------------------------------------------------
export const uploadsApi = {
  fields: () => api.get<{ data: FieldDefinition[] }>('/api/uploads/fields').then((r) => r.data.data),
  list: () => api.get<{ data: unknown[] }>('/api/uploads').then((r) => r.data.data),
  create: (file: File, onProgress?: (percent: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<{ data: UploadPreview }>('/api/uploads', form, {
        onUploadProgress: (event) => {
          if (event.total) onProgress?.(Math.round((event.loaded / event.total) * 100));
        },
      })
      .then((r) => r.data.data);
  },
  validate: (uploadId: string, mapping: ColumnMapping, sheetName?: string) =>
    api.post<{ data: UploadPreview }>(`/api/uploads/${uploadId}/validate`, { mapping, sheetName }).then((r) => r.data.data),
  commit: (uploadId: string, payload: { mapping: ColumnMapping; startProcessing: boolean; platforms?: Platform[]; force?: boolean }) =>
    api.post<{ data: CommitResult }>(`/api/uploads/${uploadId}/commit`, payload).then((r) => r.data.data),
  remove: (uploadId: string) => api.delete(`/api/uploads/${uploadId}`).then(() => undefined),
};

// -- jobs --------------------------------------------------------------------
export const jobsApi = {
  list: (params: QueryParams = {}) =>
    api.get<Paginated<JobSummary>>('/api/jobs', { params: cleanParams(params) }).then((r) => r.data),
  get: (id: string) => api.get<{ data: JobProgress }>(`/api/jobs/${id}`).then((r) => r.data.data),
  items: (id: string, params: QueryParams = {}) =>
    api.get<Paginated<JobItem>>(`/api/jobs/${id}/items`, { params: cleanParams(params) }).then((r) => r.data),
  retry: (id: string) => api.post<{ requeued: number }>(`/api/jobs/${id}/retry`).then((r) => r.data),
  cancel: (id: string) => api.post(`/api/jobs/${id}/cancel`).then(() => undefined),
  queueStatus: () => api.get<{ driver: string; waiting: number; active: number }>('/api/jobs/queue-status').then((r) => r.data),
  errors: (params: QueryParams = {}) =>
    api.get<Paginated<{ id: string; platform: Platform; status: string; message: string; occurredAt: string; student: { id: string; studentId: string; name: string } | null; job: { number: number } | null }>>(
      '/api/jobs/errors/recent', { params: cleanParams(params) },
    ).then((r) => r.data),
};

// -- analytics ---------------------------------------------------------------
export const analyticsApi = {
  overview: (params: QueryParams = {}) =>
    api.get<{ data: Overview }>('/api/analytics/overview', { params: cleanParams(params) }).then((r) => r.data.data),
  topics: (params: QueryParams = {}) =>
    api.get<{ data: TopicAnalytics }>('/api/analytics/topics', { params: cleanParams(params) }).then((r) => r.data.data),
  difficulty: (params: QueryParams = {}) =>
    api.get<{ data: DifficultyAnalytics }>('/api/analytics/difficulty', { params: cleanParams(params) }).then((r) => r.data.data),
  batch: (batch: string, params: QueryParams = {}) =>
    api.get<{ data: BatchAnalytics }>('/api/analytics/batch', { params: cleanParams({ ...params, batch }) }).then((r) => r.data.data),
  institutions: (groupBy: 'college' | 'university', params: QueryParams = {}) =>
    api.get<{ data: InstitutionRow[] }>('/api/analytics/university', { params: cleanParams({ ...params, groupBy }) }).then((r) => r.data.data),
  growth: (params: QueryParams = {}) =>
    api.get<{ data: { date: string; students: number; totalSolved: number; averageSolved: number | null; averageScore: number | null; averageRating: number | null }[] }>(
      '/api/analytics/growth', { params: cleanParams(params) },
    ).then((r) => r.data.data),
  recompute: () => api.post<{ message: string; count: number }>('/api/analytics/recompute').then((r) => r.data),
};

export const leaderboardApi = {
  get: (params: QueryParams = {}) =>
    api.get<Paginated<LeaderboardRow> & { sort: { sortBy: string; sortDir: string } }>('/api/leaderboard', {
      params: cleanParams(params),
    }).then((r) => r.data),
};

// -- settings ----------------------------------------------------------------
export const settingsApi = {
  get: () => api.get<SettingsResponse>('/api/settings').then((r) => r.data),
  update: (key: string, value: Record<string, unknown>, recompute = false) =>
    api.patch<{ data: { key: string; value: Record<string, unknown> }; recomputed?: number; realerted?: number }>(
      `/api/settings/${encodeURIComponent(key)}`, { value, recompute },
    ).then((r) => r.data),
  reset: (key: string, recompute = true) =>
    api
      .post<{ data: { key: string; value: Record<string, unknown> }; recomputed?: number; realerted?: number }>(
        `/api/settings/${encodeURIComponent(key)}/reset`,
        { recompute },
      )
      .then((r) => r.data),
  platforms: () => api.get<{ data: PlatformMeta[]; dataSource: string }>('/api/settings/platforms/meta').then((r) => r.data),
  purgeCache: (payload: { platform?: Platform; expiredOnly?: boolean }) =>
    api.post<{ removed: number }>('/api/settings/cache/purge', payload).then((r) => r.data),
};

// -- alerts ------------------------------------------------------------------
export const alertsApi = {
  types: () => api.get<{ data: { type: string; label: string }[] }>('/api/alerts/types').then((r) => r.data.data),
  list: (params: QueryParams = {}) =>
    api
      .get<Paginated<StudentAlert> & { summary: AlertSummary }>('/api/alerts', { params: cleanParams(params) })
      .then((r) => r.data),
  summary: (params: QueryParams = {}) =>
    api.get<{ data: AlertSummary }>('/api/alerts/summary', { params: cleanParams(params) }).then((r) => r.data.data),
  acknowledge: (id: string, acknowledged: boolean) =>
    api.post(`/api/alerts/${id}/acknowledge`, { acknowledged }).then((r) => r.data),
  recompute: () => api.post<{ message: string; evaluated: number }>('/api/alerts/recompute').then((r) => r.data),
};

// -- automation --------------------------------------------------------------
export const scheduleApi = {
  status: () => api.get<{ data: ScheduleStatus }>('/api/schedule').then((r) => r.data.data),
  runNow: () =>
    api
      .post<{ data: { ran: boolean; reason?: string; jobId?: string; jobNumber?: number } }>('/api/schedule/run-now')
      .then((r) => r.data.data),
};
