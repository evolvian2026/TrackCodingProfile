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

/** One refresh in flight at a time; everyone else waits for its result. */
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  refreshPromise ??= axios
    .post<{ accessToken: string }>(`${baseURL}/api/auth/refresh`, {}, { withCredentials: true })
    .then((res) => {
      accessToken = res.data.accessToken;
      return res.data.accessToken;
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
        await refreshAccessToken();
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
