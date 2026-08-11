import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ttm_user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('ttm_token')));

  useEffect(() => {
    const token = localStorage.getItem('ttm_token');
    if (!token) return setLoading(false);
    api.get('/auth/me')
      .then(({ data }) => {
        setUser(data.user);
        localStorage.setItem('ttm_user', JSON.stringify(data.user));
      })
      .catch(() => {
        localStorage.removeItem('ttm_token');
        localStorage.removeItem('ttm_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    async login(username, password) {
      const { data } = await api.post('/auth/login', { username, password });
      localStorage.setItem('ttm_token', data.token);
      localStorage.setItem('ttm_user', JSON.stringify(data.user));
      setUser(data.user);
      return data.user;
    },
    async switchRole(activeRole) {
      const { data } = await api.post('/auth/switch-role', { activeRole });
      localStorage.setItem('ttm_token', data.token);
      localStorage.setItem('ttm_user', JSON.stringify(data.user));
      setUser(data.user);
      return data.user;
    },
    logout() {
      localStorage.removeItem('ttm_token');
      localStorage.removeItem('ttm_user');
      setUser(null);
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
