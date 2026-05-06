/**
 * Behavioural tests for: async pagination generators, 204/205 no-body handling,
 * setConfig header merging, auth-strategy removal, OAuth2 token validation,
 * per-request retry overrides, and Retry-After value clamping.
 */
import FetchEnh from '../src';
import { OAuth2ClientCredentialsAuth } from '../src/auth/strategies';
import { MemoryTokenStore } from '../src/auth/tokenStores';
import { defaultBackoffDelay } from '../src/core/retryEngine';
import type { RetryConfig } from '../src/types/retry';
import fetchMock from 'jest-fetch-mock';

beforeEach(() => {
  fetchMock.resetMocks();
});

describe('parseBody handles empty-body status codes', () => {
  test('returns null for 204 No Content with responseType json', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    fetchMock.mockResponseOnce('', { status: 204 });
    const result = await api.get({ endpoint: '/resource', responseType: 'json' });
    expect(result).toBeNull();
  });

  test('returns null for 204 No Content with responseType text', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    fetchMock.mockResponseOnce('', { status: 204 });
    const result = await api.get({ endpoint: '/resource', responseType: 'text' });
    expect(result).toBeNull();
  });

  test('returns null for 205 Reset Content', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    fetchMock.mockResponseOnce('', { status: 205 });
    const result = await api.delete({ endpoint: '/resource', responseType: 'json' });
    expect(result).toBeNull();
  });

  test('still returns Response object when responseType is response and status is 204', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    fetchMock.mockResponseOnce('', { status: 204 });
    const result = await api.get({ endpoint: '/resource', responseType: 'response' });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(204);
  });
});

describe('setConfig merges defaultHeaders', () => {
  test('preserves existing headers when adding new ones', () => {
    const api = new FetchEnh({
      baseURL: 'https://api.test',
      defaultHeaders: { 'X-A': 'a', 'X-B': 'b' },
    });
    api.setConfig({ defaultHeaders: { 'X-B': 'new-b', 'X-C': 'c' } });
    expect(api.defaultHeaders).toEqual({ 'X-A': 'a', 'X-B': 'new-b', 'X-C': 'c' });
  });

  test('starts from empty and adds headers', () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    api.setConfig({ defaultHeaders: { 'X-Custom': 'value' } });
    expect(api.defaultHeaders['X-Custom']).toBe('value');
  });

  test('merged headers are sent in requests', async () => {
    const api = new FetchEnh({
      baseURL: 'https://api.test',
      defaultHeaders: { 'X-Existing': 'exists' },
    });
    api.setConfig({ defaultHeaders: { 'X-Added': 'added' } });
    fetchMock.mockResponseOnce(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await api.get({ endpoint: '/test' });
    const sentHeaders = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(sentHeaders.get('X-Existing')).toBe('exists');
    expect(sentHeaders.get('X-Added')).toBe('added');
  });
});

describe('auth strategy removal', () => {
  test('clearAuthStrategies() prevents strategies from running', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    const onRequest = jest.fn().mockImplementation((req: Request) => req);
    api.useAuthStrategy({ onRequest });
    api.clearAuthStrategies();

    fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await api.get({ endpoint: '/test' });
    expect(onRequest).not.toHaveBeenCalled();
  });

  test('removeAuthStrategy() removes only the specified strategy', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    const stratA = { onRequest: jest.fn().mockImplementation((r: Request) => r) };
    const stratB = { onRequest: jest.fn().mockImplementation((r: Request) => r) };
    api.useAuthStrategy(stratA);
    api.useAuthStrategy(stratB);
    api.removeAuthStrategy(stratA);

    fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await api.get({ endpoint: '/test' });
    expect(stratA.onRequest).not.toHaveBeenCalled();
    expect(stratB.onRequest).toHaveBeenCalled();
  });

  test('removeAuthStrategy() is a no-op for unregistered strategies', () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    expect(() => {
      api.removeAuthStrategy({ onRequest: () => {} });
    }).not.toThrow();
  });
});

describe('fetchToken throws on non-OK token endpoint response', () => {
  test('throws when token endpoint returns 401', async () => {
    const tokenStore = new MemoryTokenStore(null);
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    api.useAuthStrategy(new OAuth2ClientCredentialsAuth({
      tokenURL: 'https://auth.test/token',
      clientId: 'id',
      clientSecret: 'secret',
      tokenStore,
    }));

    fetchMock.mockResponseOnce('{"error":"invalid_client"}', {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });

    await expect(api.get({ endpoint: '/protected' })).rejects.toThrow(
      /OAuth2ClientCredentialsAuth.*401/
    );
  });

  test('throws when token endpoint returns 500', async () => {
    const tokenStore = new MemoryTokenStore(null);
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    api.useAuthStrategy(new OAuth2ClientCredentialsAuth({
      tokenURL: 'https://auth.test/token',
      clientId: 'id',
      clientSecret: 'secret',
      tokenStore,
    }));

    fetchMock.mockResponseOnce('Internal Server Error', { status: 500 });

    await expect(api.get({ endpoint: '/protected' })).rejects.toThrow(
      /OAuth2ClientCredentialsAuth.*500/
    );
  });
});

describe('fetchToken validates access_token field', () => {
  test('throws when token response is missing access_token', async () => {
    const tokenStore = new MemoryTokenStore(null);
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    api.useAuthStrategy(new OAuth2ClientCredentialsAuth({
      tokenURL: 'https://auth.test/token',
      clientId: 'id',
      clientSecret: 'secret',
      tokenStore,
    }));

    fetchMock.mockResponseOnce(JSON.stringify({ token_type: 'Bearer' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(api.get({ endpoint: '/protected' })).rejects.toThrow(
      /access_token/
    );
  });

  test('throws when access_token is not a string', async () => {
    const tokenStore = new MemoryTokenStore(null);
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    api.useAuthStrategy(new OAuth2ClientCredentialsAuth({
      tokenURL: 'https://auth.test/token',
      clientId: 'id',
      clientSecret: 'secret',
      tokenStore,
    }));

    fetchMock.mockResponseOnce(JSON.stringify({ access_token: 12345 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(api.get({ endpoint: '/protected' })).rejects.toThrow(
      /access_token/
    );
  });
});

describe('per-request retry config via options.retry', () => {
  test('allows unsafe POST retry when per-call config enables it', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    // Instance config: idempotentOnly=true (POST won't retry by default)
    // Per-call config overrides to allow unsafe retries
    api.setRetryConfig({ idempotentOnly: true });
    api.setBackoffStrategy({ computeDelay: () => 0 });

    fetchMock
      .mockResponseOnce('', { status: 500 })
      .mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const result = await api.post({
      endpoint: '/jobs',
      body: { x: 1 },
      options: {
        retries: 1,
        retry: { idempotentOnly: false, allowUnsafeRetries: true },
      },
    });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('per-call maxElapsedMs is respected', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 3 });
    // delay = 5000ms, maxElapsedMs = 100ms  → TimeoutError thrown before sleep
    api.setBackoffStrategy({ computeDelay: () => 5000 });

    fetchMock.mockResponse('', { status: 500 });

    await expect(
      api.get({
        endpoint: '/slow',
        options: { retries: 3, retry: { maxElapsedMs: 100 } },
      })
    ).rejects.toThrow();

    // Should only have been called once (no retry since delay > maxElapsedMs)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('instance config is unchanged after per-call retry', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    api.setBackoffStrategy({ computeDelay: () => 0 });
    api.setRetryConfig({ idempotentOnly: true });

    fetchMock
      .mockResponseOnce('', { status: 500 })
      .mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
      .mockResponseOnce('', { status: 500 });

    // First call uses per-call config that allows POST retry
    await api.post({
      endpoint: '/jobs',
      body: {},
      options: {
        retries: 1,
        retry: { idempotentOnly: false, allowUnsafeRetries: true },
      },
    });

    // Second POST call should NOT retry because instance config is still idempotentOnly
    await expect(
      api.post({ endpoint: '/jobs', body: {}, options: { retries: 1 } })
    ).rejects.toThrow();
    // Only 3 total calls (2 for first POST + 1 for second)
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('negative Retry-After values are clamped to 0', () => {
  test('defaultBackoffDelay clamps negative Retry-After to 0', () => {
    const config: RetryConfig = { respectRetryAfter: true };
    const mockResponse = new Response('', {
      status: 429,
      headers: { 'retry-after': '-5' },
    });
    const delay = defaultBackoffDelay(1, config, mockResponse);
    expect(delay).toBe(0);
  });

  test('positive Retry-After is honoured', () => {
    const config: RetryConfig = { respectRetryAfter: true };
    const mockResponse = new Response('', {
      status: 429,
      headers: { 'retry-after': '2' },
    });
    const delay = defaultBackoffDelay(1, config, mockResponse);
    expect(delay).toBe(2000);
  });
});

describe('getIter yields pages without full buffering', () => {
  test('page-based: yields each page separately', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    api.setBackoffStrategy({ computeDelay: () => 0 });

    fetchMock
      .mockResponseOnce(JSON.stringify([{ id: 1 }, { id: 2 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
      .mockResponseOnce(JSON.stringify([{ id: 3 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const pages: any[][] = [];
    for await (const page of api.getIter({ endpoint: '/items', page: 1, pageSize: 2 })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual([{ id: 1 }, { id: 2 }]);
    expect(pages[1]).toEqual([{ id: 3 }]);
  });

  test('simple GET: yields single-item array', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    fetchMock.mockResponseOnce(JSON.stringify({ name: 'Alice' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const pages: any[][] = [];
    for await (const page of api.getIter({ endpoint: '/user' })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual([{ name: 'Alice' }]);
  });

  test('array result: yields array as single page', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    fetchMock.mockResponseOnce(JSON.stringify([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const pages: any[][] = [];
    for await (const page of api.getIter({ endpoint: '/numbers' })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual([1, 2, 3]);
  });

  test('limit is respected across pages', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    api.setBackoffStrategy({ computeDelay: () => 0 });

    fetchMock
      .mockResponseOnce(JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
      .mockResponseOnce(JSON.stringify([{ id: 4 }, { id: 5 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const all: any[] = [];
    for await (const page of api.getIter({ endpoint: '/items', page: 1, pageSize: 3, limit: 4 })) {
      all.push(...page);
    }

    expect(all).toHaveLength(4);
    expect(all[3]).toEqual({ id: 4 });
  });
});
