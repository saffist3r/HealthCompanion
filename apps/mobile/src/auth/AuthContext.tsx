import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  clearAuthSession,
  getAccessToken,
  getAuthUser,
  loginRequest,
  subscribeAuth,
  type AuthUser,
} from '../api/auth';
import { getApiBaseUrl } from '../api/config';
import { getDeviceId } from '../api/deviceId';

type AuthContextValue = {
  ready: boolean;
  user: AuthUser | null;
  token: string | null;
  signedIn: boolean;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [t, u] = await Promise.all([getAccessToken(), getAuthUser()]);
    setToken(t);
    setUser(u);
  }, []);

  useEffect(() => {
    refresh().finally(() => setReady(true));
    return subscribeAuth(() => {
      refresh();
    });
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const apiBase = await getApiBaseUrl();
    const deviceId = await getDeviceId();
    const next = await loginRequest(apiBase, email, password, deviceId);
    const t = await getAccessToken();
    setUser(next);
    setToken(t);
    // Upload any CapAPS readings queued while signed out
    const { flushGlucosePending } = await import('../glucoseCloudSync');
    flushGlucosePending().catch(() => {});
  }, []);

  const signOut = useCallback(async () => {
    await clearAuthSession();
    setUser(null);
    setToken(null);
  }, []);

  const value = useMemo(
    () => ({
      ready,
      user,
      token,
      signedIn: Boolean(token),
      refresh,
      signIn,
      signOut,
    }),
    [ready, user, token, refresh, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
