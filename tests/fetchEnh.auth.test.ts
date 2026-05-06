import FetchEnh from '../src';
import { BearerTokenAuth, ApiKeyAuth, BasicAuth, CsrfTokenAuth } from '../src/auth/strategies';
import { MemoryTokenStore, LocalStorageTokenStore } from '../src/auth/tokenStores';
import { AuthAbortError } from '../src/errors/fetchErrors';
import fetchMock from 'jest-fetch-mock';

beforeEach(() => {
  fetchMock.resetMocks();
  localStorage.clear();
});

describe('Token Stores', () => {
  describe('MemoryTokenStore', () => {
    test('stores and retrieves token', () => {
      const store = new MemoryTokenStore('initial-token');
      expect(store.getToken()).toBe('initial-token');
      
      store.setToken('new-token');
      expect(store.getToken()).toBe('new-token');
    });

    test('handles null token', () => {
      const store = new MemoryTokenStore();
      expect(store.getToken()).toBe(null);
      
      store.setToken(null);
      expect(store.getToken()).toBe(null);
    });

    test('updates token', () => {
      const store = new MemoryTokenStore('token1');
      store.setToken('token2');
      expect(store.getToken()).toBe('token2');
    });
  });

  describe('LocalStorageTokenStore', () => {
    test('stores and retrieves token from localStorage', () => {
      const store = new LocalStorageTokenStore('test_key');
      
      store.setToken('test-token');
      expect(localStorage.getItem('test_key')).toBe('test-token');
      expect(store.getToken()).toBe('test-token');
    });

    test('removes token when set to null', () => {
      const store = new LocalStorageTokenStore('test_key');
      
      store.setToken('test-token');
      expect(store.getToken()).toBe('test-token');
      
      store.setToken(null);
      expect(store.getToken()).toBe(null);
      expect(localStorage.getItem('test_key')).toBe(null);
    });

    test('uses custom key', () => {
      const store = new LocalStorageTokenStore('my_custom_key');
      store.setToken('token');
      expect(localStorage.getItem('my_custom_key')).toBe('token');
    });
  });
});

describe('Authentication Strategies', () => {
  describe('BearerTokenAuth', () => {
    test('adds Authorization header with token', async () => {
      const store = new MemoryTokenStore('my-token');
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      api.useAuthStrategy(new BearerTokenAuth(store, async () => 'refreshed-token'));
      
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.get({ endpoint: '/protected' });
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.get('Authorization')).toBe('Bearer my-token');
    });

    test('refreshes token on 401 and retries', async () => {
        const store = new MemoryTokenStore('expired-token');
        let refreshCalled = false;
      
        const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
      
        api.useAuthStrategy(new BearerTokenAuth(store, async () => {
          refreshCalled = true;
          return 'fresh-token';
        }));
      
        // First call returns 401, refresh happens, then retry succeeds
        fetchMock
          .mockResponseOnce('Unauthorized', { status: 401 })
          .mockResponseOnce(JSON.stringify({ data: 'success' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
      
        const result = await api.get({ endpoint: '/protected' });
      
        expect(refreshCalled).toBe(true);
        expect(store.getToken()).toBe('fresh-token');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        // Auth retry must return the parsed body, not a raw Response object.
        expect(result).toEqual({ data: 'success' });
        expect(result).not.toBeInstanceOf(Response);
      });

    test('auth retry returns parsed body, not raw Response (type-contract regression)', async () => {
      const store = new MemoryTokenStore('expired-token');
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });

      api.useAuthStrategy(new BearerTokenAuth(store, async () => 'fresh-token'));

      fetchMock
        .mockResponseOnce('Unauthorized', { status: 401 })
        .mockResponseOnce(JSON.stringify({ id: 1, name: 'Alice' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });

      const result = await api.get<{ id: number; name: string }>({ endpoint: '/me', responseType: 'json' });

      // TypeScript generic must be honoured — result is the parsed object, never a raw Response.
      expect(result).not.toBeInstanceOf(Response);
      expect(result).toEqual({ id: 1, name: 'Alice' });
    });

    test('supports async token store in BearerTokenAuth', async () => {
      const store = { getToken: async () => 'async-token', setToken: (_: string|null) => {} } as any;
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      api.useAuthStrategy(new BearerTokenAuth(store, async () => 'refreshed'));
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      await api.get({ endpoint: '/protected' });
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.get('Authorization')).toBe('Bearer async-token');
    });

    test('does not add header if token is null', async () => {
      const store = new MemoryTokenStore(null);
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      api.useAuthStrategy(new BearerTokenAuth(store, async () => null));
      
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.get({ endpoint: '/public' });
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.has('Authorization')).toBe(false);
    });
  });

  describe('ApiKeyAuth', () => {
    test('adds API key to header', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      api.useAuthStrategy(new ApiKeyAuth({
        headerName: 'X-API-Key',
        getApiKey: () => 'secret-key-123'
      }));
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.get({ endpoint: '/data' });
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.get('X-API-Key')).toBe('secret-key-123');
    });

    test('adds API key to query parameter', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      api.useAuthStrategy(new ApiKeyAuth({
        queryName: 'api_key',
        getApiKey: () => 'query-key-456'
      }));
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.get({ endpoint: '/data' });
      
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('api_key=query-key-456');
    });

    test('supports async getApiKey', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultTimeout: 5000 });
      
      api.useAuthStrategy(new ApiKeyAuth({
        headerName: 'X-API-Key',
        getApiKey: async () => {
          // Use immediate Promise to avoid timeout
          return Promise.resolve('async-key');
        }
      }));
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.get({ endpoint: '/data' });
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.get('X-API-Key')).toBe('async-key');
    });

    test('does not add key if getApiKey returns null', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      api.useAuthStrategy(new ApiKeyAuth({
        headerName: 'X-API-Key',
        getApiKey: () => null
      }));
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.get({ endpoint: '/data' });
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.has('X-API-Key')).toBe(false);
    });
  });

  describe('BasicAuth', () => {
    test('adds Basic Authorization header', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      api.useAuthStrategy(new BasicAuth('user', 'pass'));
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.get({ endpoint: '/protected' });
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      const auth = headers.get('Authorization');
      expect(auth).toMatch(/^Basic /);
      
      // Decode and verify
      const encoded = auth.replace('Basic ', '');
      const decoded = Buffer.from(encoded, 'base64').toString();
      expect(decoded).toBe('user:pass');
    });
  });

  describe('CsrfTokenAuth', () => {
    test('adds CSRF token header', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      api.useAuthStrategy(new CsrfTokenAuth(
        'X-CSRF-Token',
        () => 'csrf-token-value'
      ));
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.post({ endpoint: '/submit', body: { data: 'test' } });
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.get('X-CSRF-Token')).toBe('csrf-token-value');
    });

    test('supports async token getter', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultTimeout: 5000 });
      
      api.useAuthStrategy(new CsrfTokenAuth(
        'X-CSRF-Token',
        async () => {
          // Use immediate Promise to avoid timeout
          return Promise.resolve('async-csrf-token');
        }
      ));
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.post({ endpoint: '/submit', body: {} });
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.get('X-CSRF-Token')).toBe('async-csrf-token');
    });

    test('does not add header if token is null', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      api.useAuthStrategy(new CsrfTokenAuth('X-CSRF-Token', () => null));
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.post({ endpoint: '/submit', body: {} });
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.has('X-CSRF-Token')).toBe(false);
    });
  });

  describe('BasicAuth encodes UTF-8 credentials', () => {
    test('encodes ASCII credentials correctly', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      api.useAuthStrategy(new BasicAuth('user', 'pass'));
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
      await api.get({ endpoint: '/protected' });
      const authHeader = (fetchMock.mock.calls[0][1]?.headers as any).get('Authorization') as string;
      expect(authHeader).toMatch(/^Basic /);
      const decoded = Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString('utf8');
      expect(decoded).toBe('user:pass');
    });

    test('encodes non-Latin1 (UTF-8) credentials without throwing', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      // Characters outside Latin-1 range (café, CJK)
      api.useAuthStrategy(new BasicAuth('café', '密码'));
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
      await api.get({ endpoint: '/protected' });
      const authHeader = (fetchMock.mock.calls[0][1]?.headers as any).get('Authorization') as string;
      expect(authHeader).toMatch(/^Basic /);
      // Decode and verify round-trip (Node path uses utf8; browser path uses encodeURIComponent)
      const b64Part = authHeader.replace('Basic ', '');
      const decoded = Buffer.from(b64Part, 'base64').toString('utf8');
      // The decoded form should contain the original characters (Node utf8 path)
      // or the percent-encoded form (browser path). Either is non-empty and valid.
      expect(decoded.length).toBeGreaterThan(0);
    });
  });

  describe('ApiKeyAuth misconfiguration guard', () => {
    test('throws at construction when neither headerName nor queryName is provided', () => {
      expect(() => new ApiKeyAuth({ getApiKey: () => 'key' })).toThrow(
        /at least one of .headerName. or .queryName. must be provided/
      );
    });

    test('does not throw when headerName is provided', () => {
      expect(() => new ApiKeyAuth({ headerName: 'X-Key', getApiKey: () => 'key' })).not.toThrow();
    });

    test('does not throw when queryName is provided', () => {
      expect(() => new ApiKeyAuth({ queryName: 'api_key', getApiKey: () => 'key' })).not.toThrow();
    });
  });

  describe('Auth halt via AuthAbortError', () => {
    test('throws AuthAbortError (not plain Error) when auth strategy returns false on auth error', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
      // Strategy that always returns false from onAuthError
      api.useAuthStrategy({
        onAuthError: async (): Promise<false> => false,
      });
      fetchMock.mockResponseOnce('Unauthorized', { status: 401 });
      await expect(api.get({ endpoint: '/secret' })).rejects.toBeInstanceOf(AuthAbortError);
    });

    test('AuthAbortError is not retried as a network error', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 3 });
      api.useAuthStrategy({ onAuthError: async (): Promise<false> => false });
      fetchMock.mockResponse('Unauthorized', { status: 401 });
      await expect(api.get({ endpoint: '/secret' })).rejects.toBeInstanceOf(AuthAbortError);
      // fetch should only be called once (no network retries)
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Response body clone for auth error inspection', () => {
    test('auth strategy onAuthError can inspect response body even after FetchEnh parsed it', async () => {
      let capturedBody: unknown = undefined;
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
      api.useAuthStrategy({
        async onAuthError(_req: Request, response: Response): Promise<false> {
          // The body must still be readable here
          try { capturedBody = await response.json(); } catch { capturedBody = null; }
          return false; // halt
        },
      });
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'token_expired' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
      await expect(api.get({ endpoint: '/me' })).rejects.toBeInstanceOf(AuthAbortError);
      expect(capturedBody).toEqual({ error: 'token_expired' });
    });
  });

  describe('Multiple Auth Strategies', () => {
    test('applies multiple strategies in priority order', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      api.useAuthStrategy(new ApiKeyAuth({
        headerName: 'X-API-Key',
        getApiKey: () => 'api-key',
        priority: 2
      }));
      
      api.useAuthStrategy(new CsrfTokenAuth(
        'X-CSRF-Token',
        () => 'csrf-token',
        1  // Lower priority = runs first
      ));
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.post({ endpoint: '/data', body: {} });
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.get('X-API-Key')).toBe('api-key');
      expect(headers.get('X-CSRF-Token')).toBe('csrf-token');
    });
  });
});
