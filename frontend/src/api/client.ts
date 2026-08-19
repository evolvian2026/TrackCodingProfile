import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

const baseURL = import.meta.env.VITE_API_URL ?? '';

export const api = axios.create({
  baseURL,
  // The refresh token lives in an http-only cookie.
  withCredentials: true,
  timeout: 60_000,
});

let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setUnauthenticatedHandler(handler: () => void) {
  onUnauthenticated = handler;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

export interface RefreshResult {
  accessToken: string;
  user: unknown;
}

/**
 * Exactly one refresh in flight at a time; every other caller awaits its result.
 *
 * This must be the ONLY path that refreshes. Refresh tokens rotate server-side,
 * so two concurrent refreshes both present the same token: the first rotates it
 * and the second is rejected as a replay, which would sign a perfectly valid
 * user out. That happens easily in practice — React StrictMode double-invokes
 * the boot effect, and two open tabs do the same thing.
 */
let refreshPromise: Promise<RefreshResult> | null = null;

export async function refreshSession(): Promise<RefreshResult> {
  refreshPromise ??= axios
    .post<RefreshResult>(`${baseURL}/api/auth/refresh`, {}, { withCredentials: true })
    .then((res) => {
      accessToken = res.data.accessToken;
      return res.data;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig & { _retried?: boolean };
    const isAuthCall = original?.url?.includes('/api/auth/login') || original?.url?.includes('/api/auth/refresh');

    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      try {
        await refreshSession();
        return api(original);
      } catch {
        accessToken = null;
        onUnauthenticated?.();
      }
    }
    return Promise.reject(error);
  },
);

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Turns any thrown value into a message worth showing a person. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined;
    if (body?.error?.message) return body.error.message;
    if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
    if (!error.response) return 'Cannot reach the server. Check that the API is running.';
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Triggers a browser download for an endpoint that returns a file. */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const response = await api.get(url, { responseType: 'blob' });

  const disposition = response.headers['content-disposition'] as string | undefined;
  const match = disposition?.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] ?? fallbackName;

  const href = URL.createObjectURL(response.data as Blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
