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
   * Useful when consuming token endpoint responses that don't propagate expiry
   * through the strategy layer (e.g. a custom strategy that delegates token
   * fetching to a side-channel rather than using the built-in OAuth2 strategies).
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
  /** Sidecar `localStorage` key holding the absolute expiry timestamp. */
  private get expiryKey(): string {
    return `${this.key}_expires_at`;
  }

  constructor(key = 'fetchenh_token') {
    this.key = key;
  }

  getToken(): string | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      // Lazy-expiry on read — if the sidecar timestamp has passed, clear both
      // slots and surface `null` to the caller so the strategy can refresh.
      const expiresAtRaw = localStorage.getItem(this.expiryKey);
      if (expiresAtRaw !== null) {
        const expiresAtMs = Number(expiresAtRaw);
        if (Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs) {
          localStorage.removeItem(this.key);
          localStorage.removeItem(this.expiryKey);
          return null;
        }
      }
      return localStorage.getItem(this.key);
    } catch {
      return null;
    }
  }

  setToken(token: string | null): void {
    try {
      if (typeof localStorage === 'undefined') return;
      // Clear any sidecar expiry so a follow-up `setToken` can't inherit a
      // stale TTL from a prior `setTokenWithExpiry` call — mirrors
      // `MemoryTokenStore.setToken`.
      localStorage.removeItem(this.expiryKey);
      if (token === null) localStorage.removeItem(this.key);
      else localStorage.setItem(this.key, token);
    } catch {
      // ignore
    }
  }

  /**
   * Stores a token with a time-to-live in milliseconds. After `ttlMs` elapses,
   * `getToken()` returns `null` automatically and both the token slot and
   * its sidecar expiry slot are cleaned up on read.
   *
   * Useful when consuming token endpoint responses that don't propagate
   * expiry through the strategy layer (e.g. a custom strategy that delegates
   * token fetching to a side-channel rather than using the built-in OAuth2
   * strategies).
   *
   * **Implementation note.** `localStorage` has no native expiry semantics,
   * so the absolute expiry timestamp is persisted to a sidecar key
   * (`<key>_expires_at`). Writes are non-atomic — on a partial-write failure
   * (e.g. quota exceeded between the two `setItem` calls) the store is left
   * cleared rather than half-written. Pass `ttlMs = null` to store a token
   * without a TTL (equivalent to `setToken(token)`).
   *
   * @example
   * store.setTokenWithExpiry(json.access_token, json.expires_in * 1000);
   */
  setTokenWithExpiry(token: string | null, ttlMs: number | null = null): void {
    try {
      if (typeof localStorage === 'undefined') return;
      // Clear both slots first so a partial write can't leave a stale state.
      localStorage.removeItem(this.key);
      localStorage.removeItem(this.expiryKey);
      if (token === null) return;
      localStorage.setItem(this.key, token);
      if (ttlMs !== null && Number.isFinite(ttlMs) && ttlMs > 0) {
        localStorage.setItem(this.expiryKey, String(Date.now() + ttlMs));
      }
    } catch {
      // ignore
    }
  }

  /**
   * Returns a snapshot of the stored token and its absolute expiry timestamp.
   * Useful for debugging and testing. Mirrors `MemoryTokenStore.getAll()`.
   */
  getAll(): { token: string | null; expiresAtMs: number | null } {
    try {
      if (typeof localStorage === 'undefined') return { token: null, expiresAtMs: null };
      const token = this.getToken();
      const raw = localStorage.getItem(this.expiryKey);
      const expiresAtMs = raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : null;
      return { token, expiresAtMs };
    } catch {
      return { token: null, expiresAtMs: null };
    }
  }
}



