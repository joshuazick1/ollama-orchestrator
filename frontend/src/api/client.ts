import axios, { AxiosError } from 'axios';
import { ApiError } from './errors';

type LogoutFn = () => void;
let authLogoutCallback: LogoutFn | null = null;

let csrfToken: string | null = null;

function getCsrfFromCookies(): string | null {
  const match = document.cookie.match(/csrf-token=([^;]+)/);
  return match ? match[1] : null;
}

export const setAuthLogoutCallback = (fn: LogoutFn) => {
  authLogoutCallback = fn;
};

export const apiClient = axios.create({
  baseURL: '/api/orchestrator',
  timeout: 30000,
});

apiClient.interceptors.request.use(
  config => {
    if (csrfToken) {
      config.headers['X-CSRF-Token'] = csrfToken;
    }
    return config;
  },
  error => Promise.reject(error)
);

apiClient.interceptors.response.use(
  response => {
    csrfToken = getCsrfFromCookies();
    return response;
  },
  (error: AxiosError) => {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data as { error?: string; details?: unknown };

      if (status === 401 && authLogoutCallback) {
        authLogoutCallback();
      }

      let message = 'An error occurred';
      if (data?.error) {
        message = data.error;
      } else if (status === 404) {
        message = 'Resource not found';
      } else if (status === 500) {
        message = 'Internal server error';
      } else if (status >= 400 && status < 500) {
        message = 'Request error';
      }

      throw new ApiError(message, status, data?.details);
    } else if (error.request) {
      throw new ApiError(
        'Network error - please check your connection',
        undefined,
        'NETWORK_ERROR'
      );
    } else {
      throw new ApiError(error.message || 'Unknown error', undefined, error.code);
    }
  }
);
