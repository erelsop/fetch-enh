import type { AuthStrategy, TokenStore } from '../types/auth';

export class ApiKeyAuth implements AuthStrategy {
  priority?: number | undefined;
  private headerName?: string;
  private queryName?: string;
  private getApiKey: () => Promise<string | null> | string | null;

  constructor(params: { headerName?: string; queryName?: string; getApiKey: () => Promise<string | null> | string | null; priority?: number }) {
    this.headerName = params.headerName;
    this.queryName = params.queryName;
    this.getApiKey = params.getApiKey;
    this.priority = params.priority;
    if (!this.headerName && !this.queryName) {
      throw new Error(
        '[FetchEnh] ApiKeyAuth: at least one of `headerName` or `queryName` must be provided.'
      );
    }
  }

  async onRequest(request: Request): Promise<Request | void> {
    const key = await this.getApiKey();
    if (!key) return;
    if (this.headerName) {
      const headers = new Headers(request.headers);
      headers.set(this.headerName, key);
      return new Request(request, { headers });
    }
    if (this.queryName) {
      const url = new URL(request.url);
      url.searchParams.set(this.queryName, key);
      return new Request(url.toString(), request);
    }
  }
}

export class BasicAuth implements AuthStrategy {
  priority?: number | undefined;
  private username: string;
  private password: string;
  constructor(username: string, password: string, priority?: number) {
    this.username = username;
    this.password = password;
    this.priority = priority;
  }
  onRequest(request: Request): Request {
    const headers = new Headers(request.headers);
    const credentials = `${this.username}:${this.password}`;
    // Use Buffer in Node; in browsers encode UTF-8 bytes via TextEncoder so
    // that characters outside Latin-1 (e.g. café, CJK) don't throw in btoa.
    const encoded = typeof Buffer !== 'undefined'
      ? Buffer.from(credentials, 'utf8').toString('base64')
      : btoa(
          Array.from(
            new TextEncoder().encode(credentials),
            (b) => String.fromCharCode(b),
          ).join(''),
        );
    headers.set('Authorization', `Basic ${encoded}`);
    return new Request(request, { headers });
  }
}

export class CsrfTokenAuth implements AuthStrategy {
  priority?: number | undefined;
  private headerName: string;
  private getToken: () => Promise<string | null> | string | null;
  constructor(headerName: string, getToken: () => Promise<string | null> | string | null, priority?: number) {
    this.headerName = headerName;
    this.getToken = getToken;
    this.priority = priority;
  }
  async onRequest(request: Request): Promise<Request | void> {
    const token = await this.getToken();
    if (!token) return;
    const headers = new Headers(request.headers);
    headers.set(this.headerName, token);
    return new Request(request, { headers });
  }
}

export class BearerTokenAuth implements AuthStrategy {
  priority?: number | undefined;
  private store: TokenStore;
  private refreshingPromise: Promise<string | null> | null = null;
  private refresh: () => Promise<string | null>;

  constructor(store: TokenStore, refresh: () => Promise<string | null>, priority?: number) {
    this.store = store;
    this.refresh = refresh;
    this.priority = priority;
  }

  async onRequest(request: Request): Promise<Request | void> {
    const t = this.store.getToken();
    const token = t instanceof Promise ? await t : t;
    if (!token) return;
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return new Request(request, { headers });
  }

  async onAuthError(request: Request, response: Response, retry: (newRequest: Request) => Promise<Response>): Promise<Response | void> {
    // Deduplicate refresh attempts
    if (!this.refreshingPromise) {
      this.refreshingPromise = this.refresh()
        .then((newToken) => {
          this.store.setToken(newToken ?? null);
          return newToken ?? null;
        })
        .finally(() => {
          this.refreshingPromise = null;
        });
    }
    const token = await this.refreshingPromise;
    if (!token) return; // give up; let caller handle error

    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const newReq = new Request(request, { headers });
    return retry(newReq);
  }
}

export interface OAuth2TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string | null;
  scope?: string;
}

export class OAuth2ClientCredentialsAuth implements AuthStrategy {
  priority?: number | undefined;
  private tokenURL: string;
  private clientId: string;
  private clientSecret: string;
  private scope?: string;
  private store: TokenStore;
  private fetchFn: typeof fetch;
  private refreshingPromise: Promise<string | null> | null = null;
  private expiresAt: number | null = null;

  constructor(params: { tokenURL: string; clientId: string; clientSecret: string; scope?: string | string[]; tokenStore: TokenStore; priority?: number; fetchFn?: typeof fetch }) {
    // Detect a genuine browser context: `window` is defined but there is no Node.js process.
    // This intentionally does NOT fire in jsdom / test environments (Node.js + window).
    const inBrowser = typeof window !== 'undefined' &&
      (typeof process === 'undefined' || !(process as any).versions?.node);
    if (inBrowser) {
      throw new Error(
        '[FetchEnh] OAuth2ClientCredentialsAuth must not be instantiated in a browser context. ' +
        'The client_secret would be exposed to end users via the Network tab. ' +
        'Use OAuth2PKCEAuth for browser-based OAuth 2.0 instead.'
      );
    }
    this.tokenURL = params.tokenURL;
    this.clientId = params.clientId;
    this.clientSecret = params.clientSecret;
    this.scope = Array.isArray(params.scope) ? params.scope.join(' ') : params.scope;
    this.store = params.tokenStore;
    this.priority = params.priority;
    this.fetchFn = params.fetchFn || fetch;
  }

  private isExpiredSoon(): boolean {
    if (!this.expiresAt) return false;
    return Date.now() >= this.expiresAt - 60_000; // refresh 60s early
  }

  private async fetchToken(): Promise<string | null> {
    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    body.set('client_id', this.clientId);
    body.set('client_secret', this.clientSecret);
    if (this.scope) body.set('scope', this.scope);

    const res = await this.fetchFn(this.tokenURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(
        `[FetchEnh] OAuth2ClientCredentialsAuth: token endpoint returned HTTP ${res.status}` +
        (errorText ? `. Response: ${errorText}` : '.')
      );
    }
    const json = await res.json() as OAuth2TokenResponse;
    if (!json?.access_token || typeof json.access_token !== 'string') {
      throw new Error(
        '[FetchEnh] OAuth2ClientCredentialsAuth: token endpoint response is missing a valid `access_token` string.'
      );
    }
    const token = json.access_token;
    this.expiresAt = json.expires_in ? (Date.now() + json.expires_in * 1000) : null;
    this.store.setToken(token);
    return token;
  }

  private async ensureToken(): Promise<string | null> {
    const current = await Promise.resolve(this.store.getToken() as any);
    if (current && !this.isExpiredSoon()) return current;
    if (!this.refreshingPromise) {
      this.refreshingPromise = this.fetchToken().finally(() => { this.refreshingPromise = null; });
    }
    return this.refreshingPromise;
  }

  async onRequest(request: Request): Promise<Request | void> {
    const token = await this.ensureToken();
    if (!token) return;
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return new Request(request, { headers });
  }

  async onAuthError(request: Request, response: Response, retry: (newRequest: Request) => Promise<Response>): Promise<Response | void> {
    if (!this.refreshingPromise) {
      this.refreshingPromise = this.fetchToken().finally(() => { this.refreshingPromise = null; });
    }
    const token = await this.refreshingPromise;
    if (!token) return;
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const newReq = new Request(request, { headers });
    return retry(newReq);
  }
}

export class OAuth2PKCEAuth implements AuthStrategy {
  priority?: number | undefined;
  private store: TokenStore;
  private refreshStore?: TokenStore;
  private getAccessToken: () => Promise<OAuth2TokenResponse>;
  private refreshWithRefreshToken?: (refreshToken: string) => Promise<OAuth2TokenResponse>;
  private refreshingPromise: Promise<string | null> | null = null;
  private expiresAt: number | null = null;

  constructor(params: { tokenStore: TokenStore; refreshTokenStore?: TokenStore; getAccessToken: () => Promise<OAuth2TokenResponse>; refreshWithRefreshToken?: (refreshToken: string) => Promise<OAuth2TokenResponse>; priority?: number }) {
    this.store = params.tokenStore;
    this.refreshStore = params.refreshTokenStore;
    this.getAccessToken = params.getAccessToken;
    this.refreshWithRefreshToken = params.refreshWithRefreshToken;
    this.priority = params.priority;
  }

  private isExpiredSoon(): boolean {
    if (!this.expiresAt) return false;
    return Date.now() >= this.expiresAt - 60_000;
  }

  private async acquire(): Promise<string | null> {
    const res = await this.getAccessToken();
    const token = res.access_token || null;
    this.expiresAt = res.expires_in ? (Date.now() + res.expires_in * 1000) : null;
    this.store.setToken(token);
    if (this.refreshStore && res.refresh_token) this.refreshStore.setToken(res.refresh_token);
    return token;
  }

  private async refresh(): Promise<string | null> {
    const refreshToken = this.refreshStore ? await Promise.resolve(this.refreshStore.getToken() as any) : null;
    if (!refreshToken || !this.refreshWithRefreshToken) return this.acquire();
    const res = await this.refreshWithRefreshToken(refreshToken);
    const token = res.access_token || null;
    this.expiresAt = res.expires_in ? (Date.now() + res.expires_in * 1000) : null;
    this.store.setToken(token);
    if (this.refreshStore && res.refresh_token) this.refreshStore.setToken(res.refresh_token);
    return token;
  }

  private async ensureToken(): Promise<string | null> {
    const current = await Promise.resolve(this.store.getToken() as any);
    if (current && !this.isExpiredSoon()) return current;
    if (!this.refreshingPromise) {
      this.refreshingPromise = this.acquire().finally(() => { this.refreshingPromise = null; });
    }
    return this.refreshingPromise;
  }

  async onRequest(request: Request): Promise<Request | void> {
    const token = await this.ensureToken();
    if (!token) return;
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return new Request(request, { headers });
  }

  async onAuthError(request: Request, response: Response, retry: (newRequest: Request) => Promise<Response>): Promise<Response | void> {
    if (!this.refreshingPromise) {
      this.refreshingPromise = this.refresh().finally(() => { this.refreshingPromise = null; });
    }
    const token = await this.refreshingPromise;
    if (!token) return;
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const newReq = new Request(request, { headers });
    return retry(newReq);
  }
}
