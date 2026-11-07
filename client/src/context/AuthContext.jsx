import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { authApi } from '../api/auth.js';
import { refreshSession, setAccessToken } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // until the refresh cookie has been tried

  // Local sign-out only (used when the server already rejected the session).
  const logout = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  // User-initiated sign-out: end the session on the server too, then clear locally.
  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* already invalid: fine */
    }
    logout();
  }, [logout]);

  const handleAuth = useCallback(({ token, user }) => {
    setAccessToken(token);
    setUser(user);
    return user;
  }, []);

  const login = useCallback((creds) => authApi.login(creds).then(handleAuth), [handleAuth]);
  const register = useCallback((data) => authApi.register(data).then(handleAuth), [handleAuth]);

  // Restore the session from the httpOnly refresh cookie (no token is ever kept in storage).
  useEffect(() => {
    try {
      localStorage.removeItem('na_token'); // left over from the old localStorage login
    } catch {
      /* storage unavailable */
    }
    refreshSession()
      .then((data) => setUser(data?.user ?? null))
      .catch(() => setUser(null)) // server unreachable: show the login page
      .finally(() => setLoading(false));
  }, []);

  // Fired by the API client on a 401: the token expired or was revoked.
  useEffect(() => {
    const expired = () => {
      toast.error('Your session expired. Please log in again.', { id: 'session-expired' });
      logout();
    };
    window.addEventListener('auth:logout', expired);
    return () => window.removeEventListener('auth:logout', expired);
  }, [logout]);

  const value = useMemo(() => ({ user, loading, login, register, logout, signOut }), [user, loading, login, register, logout, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
