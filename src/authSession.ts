export interface AuthSession {
  username: string;
  displayName: string;
  issuedAt: number;
  mode: 'prototype';
}

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoginValidation {
  valid: boolean;
  username: string;
  error: string | null;
}

export const AUTH_SESSION_KEY = 'neon-blade.auth-session.v1';

export function validateLogin(usernameInput: string, password: string): LoginValidation {
  const username = usernameInput.trim();
  if (username.length < 3) return { valid: false, username, error: 'ID must be at least 3 characters.' };
  if (username.length > 32) return { valid: false, username, error: 'ID must be 32 characters or fewer.' };
  if (!/^[A-Za-z0-9_.@-]+$/.test(username)) return { valid: false, username, error: 'Use letters, numbers, dot, dash, underscore, or @.' };
  if (password.length < 4) return { valid: false, username, error: 'Password must be at least 4 characters.' };
  return { valid: true, username, error: null };
}

export function createPrototypeSession(username: string, now = Date.now()): AuthSession {
  const normalized = username.trim();
  const displayName = normalized.split('@')[0].slice(0, 16) || 'PLAYER';
  return { username: normalized, displayName, issuedAt: now, mode: 'prototype' };
}

export function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuthSession>;
  return candidate.mode === 'prototype'
    && typeof candidate.username === 'string'
    && candidate.username.length >= 3
    && typeof candidate.displayName === 'string'
    && candidate.displayName.length > 0
    && typeof candidate.issuedAt === 'number'
    && Number.isFinite(candidate.issuedAt);
}

export function loadAuthSession(storage?: SessionStorageLike): AuthSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isAuthSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveAuthSession(storage: SessionStorageLike | undefined, session: AuthSession): AuthSession {
  try { storage?.setItem(AUTH_SESSION_KEY, JSON.stringify(session)); } catch { /* Session remains in memory. */ }
  return session;
}

export function clearAuthSession(storage?: SessionStorageLike): void {
  try { storage?.removeItem(AUTH_SESSION_KEY); } catch { /* In-memory logout still proceeds. */ }
}
