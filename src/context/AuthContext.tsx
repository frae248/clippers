import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiRequest, setInMemoryToken } from '../lib/api';
import type { User } from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, username: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUserDirect: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiRequest<{ user: User; token: string }>('/api/auth/me');
      setInMemoryToken(data.token);
      setUser(data.user);
    } catch {
      setInMemoryToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiRequest<{ user: User; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setInMemoryToken(data.token);
    setUser(data.user);
  }, []);

  const register = useCallback(async (email: string, password: string, username: string) => {
    const data = await apiRequest<{ user: User; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, username }),
    });
    setInMemoryToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
      setInMemoryToken(null);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        refreshUser,
        setUserDirect: setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
