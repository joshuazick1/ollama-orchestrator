import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthProvider, useAuth } from '../AuthContext';

const { mockGet, mockPost } = vi.hoisted(() => {
  return {
    mockGet: vi.fn(),
    mockPost: vi.fn(),
  };
});

vi.mock('../../api', () => ({
  api: {
    get: mockGet,
    post: mockPost,
  },
  setAuthLogoutCallback: vi.fn(),
}));

vi.mock('../../utils/toast', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

describe('AuthContext', () => {
  const originalEnv = import.meta.env;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    import.meta.env.VITE_ORCHESTRATOR_AUTH_ENABLED = originalEnv.VITE_ORCHESTRATOR_AUTH_ENABLED;
  });

  describe('authEnabled behavior', () => {
    it('authEnabled reflects /api/orchestrator/auth/status response when API succeeds', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ enabled: false, setupRequired: false }),
      });
      global.fetch = mockFetch;

      mockGet.mockResolvedValue({ data: { user: null } });

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.authEnabled).toBe(false);
      expect(mockFetch).toHaveBeenCalledWith('/api/orchestrator/auth/status');

      delete (global as Record<string, unknown>).fetch;
    });

    it('authEnabled falls back to env var when API fails', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;

      mockGet.mockResolvedValue({ data: { user: null } });

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.authEnabled).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('/api/orchestrator/auth/status');

      delete (global as Record<string, unknown>).fetch;
    });

    it('authEnabled falls back to false when env var is "false" and API fails', async () => {
      import.meta.env.VITE_ORCHESTRATOR_AUTH_ENABLED = 'false';

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;

      mockGet.mockResolvedValue({ data: { user: null } });

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.authEnabled).toBe(false);

      delete (global as Record<string, unknown>).fetch;
    });
  });

  describe('setupRequired behavior', () => {
    it('setupRequired is exposed when API returns it as true', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ enabled: true, setupRequired: true }),
      });
      global.fetch = mockFetch;

      mockGet.mockResolvedValue({ data: { user: null } });

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.setupRequired).toBe(true);
      expect(result.current.authEnabled).toBe(true);

      delete (global as Record<string, unknown>).fetch;
    });

    it('setupRequired is false when API returns it as false', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ enabled: true, setupRequired: false }),
      });
      global.fetch = mockFetch;

      mockGet.mockResolvedValue({ data: { user: null } });

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.setupRequired).toBe(false);
      expect(result.current.authEnabled).toBe(true);

      delete (global as Record<string, unknown>).fetch;
    });

    it('setupRequired defaults to false when API does not return it', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ enabled: true }),
      });
      global.fetch = mockFetch;

      mockGet.mockResolvedValue({ data: { user: null } });

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.setupRequired).toBe(false);

      delete (global as Record<string, unknown>).fetch;
    });
  });

  describe('isLoading behavior', () => {
    it('isLoading is true until both /api/orchestrator/auth/status and /auth/me resolve', async () => {
      let resolveAuthMe: (value: unknown) => void;
      const authMePromise = new Promise(resolve => {
        resolveAuthMe = resolve;
      });

      let resolveAuthStatus: (value: unknown) => void;
      const authStatusPromise = new Promise(resolve => {
        resolveAuthStatus = resolve;
      });

      mockGet.mockReturnValue(authMePromise);

      const mockFetch = vi.fn().mockReturnValue(authStatusPromise);
      global.fetch = mockFetch;

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      expect(result.current.isLoading).toBe(true);

      resolveAuthStatus!({ ok: true, json: async () => ({ enabled: true }) });
      await waitFor(() => expect(result.current.isLoading).toBe(true));

      resolveAuthMe!({ data: { user: null } });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      delete (global as Record<string, unknown>).fetch;
    });

    it('isLoading becomes false even if /auth/me fails', async () => {
      let resolveAuthStatus: (value: unknown) => void;
      const authStatusPromise = new Promise(resolve => {
        resolveAuthStatus = resolve;
      });

      mockGet.mockRejectedValue(new Error('Unauthorized'));

      const mockFetch = vi.fn().mockReturnValue(authStatusPromise);
      global.fetch = mockFetch;

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      expect(result.current.isLoading).toBe(true);

      resolveAuthStatus!({ ok: true, json: async () => ({ enabled: true }) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.user).toBeNull();

      delete (global as Record<string, unknown>).fetch;
    });
  });
});
