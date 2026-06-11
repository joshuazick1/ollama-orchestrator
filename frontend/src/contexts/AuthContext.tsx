import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, setAuthLogoutCallback } from '../api';
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

  const restoreSession = useCallback(async () => {
    try {
      const response = await api.get('/auth/me');
      setUser(response.data.user);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setAuthLogoutCallback(() => {
      setUser(null);
    });
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

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
    } catch {
    } finally {
      setUser(null);
    }
  };

  const refreshToken = async () => {
    try {
      await api.post('/auth/refresh');
    } catch {
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
        login,
        logout,
        refreshToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
