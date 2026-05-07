/**
 * fetchEnh.critical.test.ts
 *
 * Targeted tests for critical code paths: error class names, content-type
 * handling, retry mechanics, interceptor/auth abort, and response type parsing.
 */

import FetchEnh from '../src';
import {
  FetchError,
  RetryError,
  TimeoutError,
  UnsupportedResponseTypeError,
  InterceptorAbortError,
  AuthAbortError,
} from '../src/errors/fetchErrors';
import { defaultBackoffDelay } from '../src/core/retryEngine';
import { BearerTokenAuth } from '../src/auth/strategies';
import { MemoryTokenStore } from '../src/auth/tokenStores';
import type { AuthStrategy } from '../src/types/auth';
import fetchMock from 'jest-fetch-mock';

beforeEach(() => {
  fetchMock.resetMocks();
  jest.useRealTimers();
});

describe('error class this.name property', () => {
  test('FetchError.name === "FetchError"', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
    try {
      await api.get({ endpoint: '/missing' });
      throw new Error('expected to throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(FetchError);
      expect(e.name).toBe('FetchError');
    }
  });

  test('RetryError.name === "RetryError"', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 1 });
    api.setBackoffStrategy({ computeDelay: () => 0 });
    fetchMock.mockResponse('', { status: 503 });
    try {
      await api.get({ endpoint: '/fail' });
      throw new Error('expected to throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RetryError);
      expect(e.name).toBe('RetryError');
    }
  });

  test('UnsupportedResponseTypeError.name === "UnsupportedResponseTypeError"', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    fetchMock.mockResponseOnce('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    try {
      await api.get({ endpoint: '/data', responseType: 'bogus' as any });
      throw new Error('expected to throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(UnsupportedResponseTypeError);
      expect(e.name).toBe('UnsupportedResponseTypeError');
    }
  });

  test('TimeoutError.name === "TimeoutError" and toJSON has correct shape', () => {
    const err = new TimeoutError({ elapsedMs: 5000 });
    expect(err.name).toBe('TimeoutError');
    expect(err.toJSON()).toEqual({
      name: 'TimeoutError',
      message: 'Request timed out.',
      code: 'ETIMEDOUT',
      elapsedMs: 5000,
    });
  });

  test('TimeoutError.toJSON works with no params', () => {
    const err = new TimeoutError();
    expect(err.name).toBe('TimeoutError');
    const json = err.toJSON();
    expect(json.name).toBe('TimeoutError');
    expect(json.code).toBe('ETIMEDOUT');
    expect(json.elapsedMs).toBeUndefined();
  });
});

describe('URLSearchParams body does not get Content-Type: application/json', () => {
  test('URLSearchParams body does not receive Content-Type: application/json', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const params = new URLSearchParams({ foo: 'bar', baz: '1' });
    await api.post({ endpoint: '/form', body: params as any });
    const sentHeaders = fetchMock.mock.calls[0][1]?.headers as Headers;
    // fetch itself will set application/x-www-form-urlencoded — we must NOT
    // have overwritten it with application/json
    const ct = sentHeaders?.get?.('Content-Type') ?? null;
    expect(ct).not.toBe('application/json');
  });
});

describe('granular retry setters', () => {
  test('setRetryClassifier: custom classifier prevents retry on 503', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 2 });
    // Never retry anything
    api.setRetryClassifier({ shouldRetry: () => false });

    fetchMock.mockResponse('', { status: 503 });
    await expect(api.get({ endpoint: '/data' })).rejects.toThrow();
    // Only 1 call — custom classifier prevented any retries
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('setRetryClassifier(null) reverts to built-in default (retries on 503)', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 1 });
    api.setRetryClassifier({ shouldRetry: () => false });
    api.setRetryClassifier(null); // revert
    api.setBackoffStrategy({ computeDelay: () => 0 });

    fetchMock
      .mockResponseOnce('', { status: 503 })
      .mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    await api.get({ endpoint: '/data', responseType: 'auto' });
    // Default classifier retries 503 → 2 calls total
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('setBackoffStrategy: custom strategy is invoked with attempt context', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 1 });
    const seen: number[] = [];
    api.setBackoffStrategy({
      computeDelay: ({ attempt }) => {
        seen.push(attempt);
        return 0;
      },
    });

    fetchMock
      .mockResponseOnce('', { status: 503 })
      .mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    await api.get({ endpoint: '/data', responseType: 'auto' });
    expect(seen).toEqual([1]); // attempt 1 fired the backoff
  });

  test('setBackoffStrategy(null) reverts to built-in exponential backoff', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 1 });
    // Set a strategy that would hang forever
    api.setBackoffStrategy({ computeDelay: () => 999_999 });
    // Then revert
    api.setBackoffStrategy(null);

    fetchMock
      .mockResponseOnce('', { status: 503 })
      .mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    // Default backoff is ≤ 2000 ms — test completes in reasonable time
    await api.get({ endpoint: '/data', responseType: 'auto' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('setRetryConfig merges config, preserving unspecified fields', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 2 });
    // idempotentOnly defaults to true — setting an unrelated key must not clear it
    api.setRetryConfig({ respectRetryAfter: true });

    // POST should still not retry (idempotentOnly still true after merge)
    fetchMock.mockResponseOnce('', { status: 500 });
    await expect(api.post({ endpoint: '/data', body: {} })).rejects.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry for POST
  });

  test('setRetryBehavior(null, null) reverts both classifier and backoff to built-in defaults', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 1 });

    // Install a never-retry classifier so the first request does not retry.
    api.setRetryBehavior(
      { shouldRetry: () => false },
      { computeDelay: () => 0 },
    );
    fetchMock.mockResponseOnce('', { status: 500 });
    await expect(api.get({ endpoint: '/no-retry' })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1); // custom classifier prevented retry

    // Revert both components to built-in defaults via setRetryBehavior(null, null).
    api.setRetryBehavior(null, null);
    fetchMock.resetMocks();
    fetchMock
      .mockResponseOnce('', { status: 500 })
      .mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const result = await api.get({ endpoint: '/retried', responseType: 'auto' });
    expect(result).toEqual({ ok: true });
    // Built-in classifier retried the 500 → 2 total calls.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('interceptor abort via InterceptorAbortError', () => {
  test('request interceptor returning false throws InterceptorAbortError', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    api.addRequestInterceptor({ handler: () => false as any });

    fetchMock.mockResponseOnce('{}', { status: 200 });
    await expect(api.get({ endpoint: '/data' })).rejects.toThrow(InterceptorAbortError);
    await expect(api.get({ endpoint: '/data' })).rejects.toMatchObject({
      name: 'InterceptorAbortError',
    });
  });

  test('response interceptor returning false throws InterceptorAbortError', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    api.addResponseInterceptor({ handler: () => false as any });

    fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await expect(api.get({ endpoint: '/data' })).rejects.toThrow(InterceptorAbortError);
  });

  test('InterceptorAbortError is not retried', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 3 });
    api.addRequestInterceptor({ handler: () => false as any });

    fetchMock.mockResponse('{}', { status: 200 });
    await expect(api.get({ endpoint: '/data' })).rejects.toThrow(InterceptorAbortError);
    // Despite defaultRetries: 3, only 1 call should have been attempted
    // (the interceptor aborts before fetch is reached, so fetchMock call count is 0)
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

describe('auth strategy abort via AuthAbortError', () => {
  test('auth onRequest returning false throws AuthAbortError', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    const haltingStrategy: AuthStrategy = { onRequest: () => false };
    api.useAuthStrategy(haltingStrategy);

    fetchMock.mockResponseOnce('{}', { status: 200 });
    await expect(api.get({ endpoint: '/secure' })).rejects.toThrow(AuthAbortError);
    await expect(api.get({ endpoint: '/secure' })).rejects.toMatchObject({
      name: 'AuthAbortError',
    });
  });

  test('AuthAbortError is not retried', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 3 });
    api.useAuthStrategy({ onRequest: () => false });

    fetchMock.mockResponse('{}', { status: 200 });
    await expect(api.get({ endpoint: '/secure' })).rejects.toThrow(AuthAbortError);
    // Auth aborts before fetch — no fetch calls
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

describe('maxElapsedMs retry-window cap', () => {
  test('throws TimeoutError when maxElapsedMs budget is exceeded before retry delay elapses', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 5 });
    // Tiny budget + non-zero delay so budget check fires immediately
    api.setRetryConfig({ maxElapsedMs: 1 });
    api.setBackoffStrategy({ computeDelay: () => 50 }); // 50 ms > 1 ms → fires

    fetchMock.mockResponse('', { status: 503 });
    await expect(api.get({ endpoint: '/data' })).rejects.toThrow(TimeoutError);
    await expect(api.get({ endpoint: '/data' })).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    });
  });
});

describe('removeResponseInterceptor', () => {
  test('removes a specific response interceptor while leaving others intact', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });

    const addTagInterceptor = {
      handler: async (res: Response) => {
        const data = await res.json();
        return new Response(JSON.stringify({ ...data, tagged: true }), {
          status: res.status,
          headers: { 'content-type': 'application/json' },
        });
      },
    };

    api.addResponseInterceptor(addTagInterceptor as any);

    // First call — interceptor is active
    fetchMock.mockResponseOnce(JSON.stringify({ v: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const before = await api.get<any>({ endpoint: '/data' });
    expect(before.tagged).toBe(true);

    // Remove the interceptor
    api.removeResponseInterceptor(addTagInterceptor as any);

    // Second call — interceptor is gone
    fetchMock.mockResponseOnce(JSON.stringify({ v: 2 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const after = await api.get<any>({ endpoint: '/data' });
    expect(after.tagged).toBeUndefined();
    expect(after.v).toBe(2);
  });
});

describe('binary response types', () => {
  test('responseType: blob returns a Blob instance', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    fetchMock.mockResponseOnce('binary-data', {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
    const result = await api.get({ endpoint: '/file', responseType: 'blob' });
    // Cross-realm instanceof is unreliable in jsdom — use toString instead
    expect(Object.prototype.toString.call(result)).toBe('[object Blob]');
  });

  test('responseType: arrayBuffer returns an ArrayBuffer instance', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    fetchMock.mockResponseOnce('binary-data', {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
    const result = await api.get({ endpoint: '/file', responseType: 'arrayBuffer' });
    // Cross-realm instanceof is unreliable in jsdom — use toString instead
    expect(Object.prototype.toString.call(result)).toBe('[object ArrayBuffer]');
  });

  test('responseType: response returns the raw Response object', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    fetchMock.mockResponseOnce(JSON.stringify({ id: 7 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const result = await api.get({ endpoint: '/data', responseType: 'response' });
    expect(result).toBeInstanceOf(Response);
  });
});

describe('Retry-After date-string backoff path', () => {
  test('returns a positive delay for a future Retry-After date string', () => {
    const futureDate = new Date(Date.now() + 30_000).toUTCString(); // 30 s ahead
    const mockResponse = new Response('', {
      status: 429,
      headers: { 'retry-after': futureDate },
    });
    const delay = defaultBackoffDelay(
      1,
      { idempotentOnly: true, respectRetryAfter: true },
      mockResponse,
    );
    // ~30 000 ms — definitely > 0 and within the 60 000 ms cap
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(60_000);
  });

  test('falls back to exponential backoff for a past Retry-After date string', () => {
    const pastDate = new Date(Date.now() - 10_000).toUTCString(); // 10 s ago
    const mockResponse = new Response('', {
      status: 429,
      headers: { 'retry-after': pastDate },
    });
    const delay = defaultBackoffDelay(
      1,
      { idempotentOnly: true, respectRetryAfter: true },
      mockResponse,
    );
    // Exponential: base 200 ms, jitter 0.7–1.3 → 140–260 ms
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(2_000);
  });

  test('caps Retry-After date-string delay at MAX_RETRY_AFTER_MS (60 000 ms)', () => {
    const farFutureDate = new Date(Date.now() + 600_000).toUTCString(); // 10 min ahead
    const mockResponse = new Response('', {
      status: 429,
      headers: { 'retry-after': farFutureDate },
    });
    const delay = defaultBackoffDelay(
      1,
      { idempotentOnly: true, respectRetryAfter: true },
      mockResponse,
    );
    expect(delay).toBe(60_000);
  });
});

describe('concurrent auth-refresh deduplication', () => {
  test('BearerTokenAuth: concurrent onAuthError calls invoke refresh only once', async () => {
    let resolveRefresh!: (token: string | null) => void;
    const refresh = jest.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    const store = new MemoryTokenStore('expired');
    const auth = new BearerTokenAuth(store, refresh);

    const dummyReq = new Request('https://api.test/data');
    const dummyRes = new Response('Unauthorized', { status: 401 });

    const retryFn = jest.fn(async (_req: Request) =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    // Fire two concurrent onAuthError calls before refresh resolves
    const p1 = auth.onAuthError(dummyReq, dummyRes, retryFn);
    const p2 = auth.onAuthError(dummyReq, dummyRes, retryFn);

    // Now resolve the single in-flight refresh
    resolveRefresh('fresh-token');

    await Promise.all([p1, p2]);

    // refresh should only have been invoked once despite two concurrent calls
    expect(refresh).toHaveBeenCalledTimes(1);
    // Both callers should have received a valid retry response
    expect(retryFn).toHaveBeenCalledTimes(2);
  });
});
