import { describe, expect, it } from 'vitest';
import { AUTH_SESSION_KEY, clearAuthSession, createPrototypeSession, loadAuthSession, saveAuthSession, validateLogin } from '../src/authSession';

class MemorySessionStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('prototype authentication session', () => {
  it('validates ID and password without returning or storing the password', () => {
    expect(validateLogin('ab', '1234').valid).toBe(false);
    expect(validateLogin('player!', '1234').valid).toBe(false);
    expect(validateLogin('player01', '123').valid).toBe(false);
    expect(validateLogin(' player01 ', '1234')).toEqual({ valid: true, username: 'player01', error: null });
  });

  it('creates a display name without retaining password material', () => {
    const session = createPrototypeSession('aria@example.com', 123);
    expect(session).toEqual({ username: 'aria@example.com', displayName: 'aria', issuedAt: 123, mode: 'prototype' });
    expect(JSON.stringify(session)).not.toContain('password');
  });

  it('persists, restores, and clears a valid session', () => {
    const storage = new MemorySessionStorage();
    const session = createPrototypeSession('duelist', 456);
    saveAuthSession(storage, session);
    expect(loadAuthSession(storage)).toEqual(session);
    clearAuthSession(storage);
    expect(storage.values.has(AUTH_SESSION_KEY)).toBe(false);
    expect(loadAuthSession(storage)).toBeNull();
  });

  it('rejects malformed persisted sessions', () => {
    const storage = new MemorySessionStorage();
    storage.values.set(AUTH_SESSION_KEY, JSON.stringify({ username: 'x', mode: 'prototype' }));
    expect(loadAuthSession(storage)).toBeNull();
    storage.values.set(AUTH_SESSION_KEY, '{broken');
    expect(loadAuthSession(storage)).toBeNull();
  });
});
