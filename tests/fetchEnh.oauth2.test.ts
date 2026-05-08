import FetchEnh from '../src';
import { OAuth2ClientCredentialsAuth, OAuth2PKCEAuth } from '../src/auth/strategies';
import { MemoryTokenStore } from '../src/auth/tokenStores';
import fetchMock from 'jest-fetch-mock';

beforeEach(() => {
  fetchMock.resetMocks();
});

test('OAuth2 Client Credentials adds Authorization header', async () => {
  const tokenStore = new MemoryTokenStore(null);
  const api = new FetchEnh({ baseURL: 'https://api.test' });

  // Token endpoint
  fetchMock
    .mockResponseOnce(JSON.stringify({ access_token: 'cc-token', token_type: 'Bearer', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } })
    .mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });

  api.useAuthStrategy(new OAuth2ClientCredentialsAuth({ tokenURL: 'https://auth.test/token', clientId: 'id', clientSecret: 'secret', tokenStore }));

  const res = await api.get({ endpoint: '/protected' });
  expect(res).toEqual({ ok: true });

  // First call was token; second was API
  expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/protected');
  const headers = fetchMock.mock.calls[1][1]?.headers as any;
  expect(headers.get('Authorization')).toBe('Bearer cc-token');
});

test('OAuth2 Client Credentials refreshes on 401 and retries', async () => {
  const tokenStore = new MemoryTokenStore(null);
  const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });

  // First: fetch token; API returns 401; Strategy refreshes; API returns 200
  fetchMock
    .mockResponseOnce(JSON.stringify({ access_token: 't1', expires_in: 10 }), { status: 200, headers: { 'content-type': 'application/json' } })
    .mockResponseOnce('', { status: 401 })
    .mockResponseOnce(JSON.stringify({ access_token: 't2', expires_in: 10 }), { status: 200, headers: { 'content-type': 'application/json' } })
    .mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });

  api.useAuthStrategy(new OAuth2ClientCredentialsAuth({ tokenURL: 'https://auth.test/token', clientId: 'id', clientSecret: 'secret', tokenStore }));

  const out = await api.get({ endpoint: '/protected' });
  if (out instanceof Response) {
    expect(await out.json()).toEqual({ ok: true });
  } else {
    expect(out).toEqual({ ok: true });
  }
  // Verify Authorization header on final request uses refreshed token
  const headers = fetchMock.mock.calls[3][1]?.headers as any;
  expect(headers.get('Authorization')).toBe('Bearer t2');
});

test('OAuth2 PKCE-style using provided token/refresh functions', async () => {
  const accessStore = new MemoryTokenStore(null);
  const refreshStore = new MemoryTokenStore('r1');

  const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });

  const getAccessToken = async () => ({ access_token: 'a1', expires_in: 5, refresh_token: 'r1' });
  const refreshWithRefreshToken = async (rt: string) => ({ access_token: rt === 'r1' ? 'a2' : 'a3', expires_in: 5, refresh_token: 'r2' });

  api.useAuthStrategy(new OAuth2PKCEAuth({ tokenStore: accessStore, refreshTokenStore: refreshStore, getAccessToken, refreshWithRefreshToken }));

  // First resource call succeeds with a1
  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  const ok1 = await api.get({ endpoint: '/x' });
  expect(ok1).toEqual({ ok: true });
  const h1 = fetchMock.mock.calls[0][1]?.headers as any;
  expect(h1.get('Authorization')).toBe('Bearer a1');

  // Next call returns 401, triggers refresh using r1 -> a2, then 200
  fetchMock
    .mockResponseOnce('', { status: 401 })
    .mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  const ok2 = await api.get({ endpoint: '/y' });
  if (ok2 instanceof Response) {
    expect(await ok2.json()).toEqual({ ok: true });
  } else {
    expect(ok2).toEqual({ ok: true });
  }
  const h2 = fetchMock.mock.calls[2][1]?.headers as any;
  expect(h2.get('Authorization')).toBe('Bearer a2');
});

test('OAuth2PKCEAuth: refresh failure clears refresh store and falls through to acquire', async () => {
  const accessStore = new MemoryTokenStore('stale-access-token');
  const refreshStore = new MemoryTokenStore('dead-refresh-token');
  const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });

  const getAccessToken = jest.fn().mockResolvedValue({ access_token: 'a-fresh', expires_in: 5 });
  const refreshWithRefreshToken = jest.fn().mockRejectedValue(new Error('invalid_grant'));

  api.useAuthStrategy(new OAuth2PKCEAuth({
    tokenStore: accessStore,
    refreshTokenStore: refreshStore,
    getAccessToken,
    refreshWithRefreshToken,
  }));

  // 401 → onAuthError → refresh() → refreshWithRefreshToken throws → clears store → acquire() → 200
  fetchMock
    .mockResponseOnce('', { status: 401 })
    .mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });

  const out = await api.get({ endpoint: '/x' });
  expect(out).toEqual({ ok: true });
  expect(refreshWithRefreshToken).toHaveBeenCalledTimes(1);
  expect(getAccessToken).toHaveBeenCalledTimes(1);   // fall-through to acquire() fired
  expect(refreshStore.getToken()).toBeNull();          // dead refresh token cleared
});