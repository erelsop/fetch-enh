import type { TokenStore } from '../types/auth';

export class MemoryTokenStore implements TokenStore {
  private token: string | null;
  constructor(initial?: string | null) {
    this.token = initial ?? null;
  }
  getToken(): string | null {
    return this.token ?? null;
  }
  setToken(token: string | null): void {
    this.token = token ?? null;
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



