import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = '@health_companion/access_token';
const USER_KEY = '@health_companion/user';

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
  return user;
}
