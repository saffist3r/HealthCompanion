import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = '@health_companion/access_token';
const USER_KEY = '@health_companion/user';
const LAST_EMAIL_KEY = '@health_companion/last_email';
const REFRESHED_AT_KEY = '@health_companion/token_refreshed_at';
/** Refresh at most this often; the token itself lasts much longer. */
const REFRESH_EVERY_MS = 12 * 60 * 60 * 1000;

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
};

type AuthListener = () => void;
const listeners = new Set<AuthListener>();

export function subscribeAuth(listener: AuthListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyAuth() {
  listeners.forEach((l) => l());
}

export async function getAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export async function setAuthSession(token: string, user: AuthUser): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  notifyAuth();
}

export async function getLastEmail(): Promise<string> {
  return (await AsyncStorage.getItem(LAST_EMAIL_KEY)) || '';
}

export async function clearAuthSession(): Promise<void> {
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
  notifyAuth();
}

export async function loginRequest(
  apiBase: string,
  email: string,
  password: string,
  deviceId: string
): Promise<AuthUser> {
  const res = await fetch(`${apiBase.replace(/\/$/, '')}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
    },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (typeof data?.detail === 'string' && data.detail) || `Login failed (${res.status})`
    );
  }
  const user = data.user as AuthUser;
  await setAuthSession(data.accessToken, user);
  await AsyncStorage.multiSet([
    [LAST_EMAIL_KEY, user.email],
    [REFRESHED_AT_KEY, String(Date.now())],
  ]);
  return user;
}

/**
 * Trade the stored token for a fresh one so the session slides forward while the app is used.
 * Network errors are ignored; only a 401 (token already dead) signs the user out.
 */
export async function refreshAuthSession(apiBase: string, deviceId: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) return;
  const last = Number((await AsyncStorage.getItem(REFRESHED_AT_KEY)) || 0);
  if (Date.now() - last < REFRESH_EVERY_MS) return;
  let res: Response;
  try {
    res = await fetch(`${apiBase.replace(/\/$/, '')}/api/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': deviceId },
    });
  } catch {
    return;
  }
  if (res.status === 401) {
    await clearAuthSession();
    return;
  }
  if (!res.ok) return;
  const data = await res.json().catch(() => null);
  if (!data?.accessToken) return;
  await setAuthSession(data.accessToken, data.user as AuthUser);
  await AsyncStorage.setItem(REFRESHED_AT_KEY, String(Date.now()));
}
