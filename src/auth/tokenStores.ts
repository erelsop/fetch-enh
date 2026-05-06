import type { TokenStore } from '../types/auth';

export class MemoryTokenStore implements TokenStore {
  private token: string | null = null;
  private expiresAtMs: number | null = null;

  constructor(initial?: string | null) {
    this.token = initial ?? null;
  }

  getToken(): string | null {
    if (this.token !== null && this.expiresAtMs !== null && Date.now() >= this.expiresAtMs) {
      this.token = null;
      this.expiresAtMs = null;
    }
    return this.token;
  }

  setToken(token: string | null): void {
    this.token = token ?? null;
    this.expiresAtMs = null;
  }

  /**
   * Stores a token with a time-to-live in milliseconds.
   * After `ttlMs` elapses, `getToken()` returns `null` automatically.
   *
   * Centralises expiry tracking so auth strategies do not need to maintain
   * their own `expiresAt` timestamps.
   *
   * @example
   * store.setTokenWithExpiry(json.access_token, json.expires_in * 1000);
   */
  setTokenWithExpiry(token: string | null, ttlMs: number | null = null): void {
    this.token = token ?? null;
    this.expiresAtMs = token !== null && ttlMs !== null ? Date.now() + ttlMs : null;
  }

  /**
   * Returns a snapshot of the stored token and its absolute expiry timestamp.
   * Useful for debugging and testing.
   */
  getAll(): { token: string | null; expiresAtMs: number | null } {
    return { token: this.getToken(), expiresAtMs: this.expiresAtMs };
  }
}

export class LocalStorageTokenStore implements TokenStore {
  private key: string;
  constructor(key = 'fetchenh_token') {
    this.key = key;
  }
  getToken(): string | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(this.key) : null;
    } catch {
      return null;
    }
  }
  setToken(token: string | null): void {
    try {
      if (typeof localStorage === 'undefined') return;
      if (token === null) localStorage.removeItem(this.key);
      else localStorage.setItem(this.key, token);
    } catch {
      // ignore
    }
  }
}



