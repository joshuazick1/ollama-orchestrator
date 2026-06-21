import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '../api';
import { setAuthLogoutCallback } from '../api/client';
import { toastSuccess, toastError } from '../utils/toast';

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  createdAt: number;
  lastLogin?: number;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authEnabled: boolean | null;
  setupRequired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);

  const restoreSession = useCallback(async () => {
    try {
      const response = await api.get('/auth/me');
      setUser(response.data.user);
    } catch (error) {
      console.error('AuthContext: restoreSession failed', error);
      setUser(null);
    }
  }, []);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/orchestrator/auth/status');
      if (!response.ok) {
        throw new Error('status ' + response.status);
      }
      const data = (await response.json()) as { enabled: boolean; setupRequired?: boolean };
      setAuthEnabled(data.enabled);
      if (data.setupRequired !== undefined) {
        setSetupRequired(data.setupRequired);
      }
    } catch {
      // API failed - fall back to env var
      setAuthEnabled(import.meta.env.VITE_ORCHESTRATOR_AUTH_ENABLED !== 'false');
    }
  }, []);

  useEffect(() => {
    setAuthLogoutCallback(() => {
      setUser(null);
    });
  }, []);

  useEffect(() => {
    // Run both async operations and set isLoading false only after both complete
    Promise.all([restoreSession(), fetchAuthStatus()]).finally(() => {
      setIsLoading(false);
    });
  }, [restoreSession, fetchAuthStatus]);

  const login = async (email: string, password: string) => {
    try {
      const response = await api.post('/auth/login', { username: email, password });
      setUser(response.data.user);
      toastSuccess('Login successful');
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Login failed');
      throw error;
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('AuthContext: logout failed', error);
      toastError('Logout failed. Please try again.');
    } finally {
      setUser(null);
    }
  };

  const refreshToken = async () => {
    try {
      await api.post('/auth/refresh');
    } catch (error) {
      console.error('AuthContext: refreshToken failed', error);
      setUser(null);
      throw new Error('Session expired');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        authEnabled,
        setupRequired,
        login,
        logout,
        refreshToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
