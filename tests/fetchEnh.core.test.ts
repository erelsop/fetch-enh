import FetchEnh, { PaginationLimitError } from '../src';
import fetchMock from 'jest-fetch-mock';
import { computeDelay } from '../src/core/retryEngine';
import { isReplayableBody } from '../src/core/bodyUtils';

beforeEach(() => {
  fetchMock.resetMocks();
});

test('FetchEnh() can be constructed with no arguments', () => {
  expect(() => new FetchEnh()).not.toThrow();
  const api = new FetchEnh();
  expect(api.baseURL).toBe('');
  expect(api.defaultTimeout).toBe(0);
  expect(api.defaultRetries).toBe(3);
});

test('setConfig normalizes trailing slash in baseURL', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  api.setConfig({ baseURL: 'https://api.test/' });
  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  await api.get({ endpoint: '/v1' });
  const url = fetchMock.mock.calls[0][0] as string;
  expect(url).toBe('https://api.test/v1');
});

test('retries on 5xx with backoff and eventually succeeds', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 2 });
  fetchMock
    .mockResponseOnce('', { status: 500 })
    .mockResponseOnce('', { status: 502 })
    .mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });

  const result = await api.get({ endpoint: '/ok', responseType: 'auto' });
  expect(result).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('request interceptor can mutate request headers', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  api.addRequestInterceptor({
    handler: (req) => {
      const newHeaders = new Headers(req.headers);
      newHeaders.set('X-Token', 'abc');
      return new Request(req, { headers: newHeaders });
    },
  });
  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  await api.get({ endpoint: '/h', responseType: 'auto' });
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  const headers = init.headers as any;
  if (headers && typeof headers.get === 'function') {
    expect(headers.get('X-Token')).toBe('abc');
  } else {
    expect(headers['X-Token'] || headers['x-token']).toBe('abc');
  }
});

test('multiple request interceptors compose mutations', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  api.addRequestInterceptor({
    priority: 1,
    handler: (req) => {
      const h = new Headers(req.headers);
      h.set('X-A', 'a');
      return new Request(req, { headers: h });
    },
  });
  api.addRequestInterceptor({
    priority: 2,
    handler: (req) => {
      const h = new Headers(req.headers);
      h.set('X-B', 'b');
      return new Request(req, { headers: h });
    },
  });
  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  await api.get({ endpoint: '/compose', responseType: 'auto' });
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  const headers = init.headers as any;
  expect(headers.get('X-A')).toBe('a');
  expect(headers.get('X-B')).toBe('b');
});

test('multiple response interceptors compose transformations', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  // priority 1 runs first (adds a:true); priority 2 runs second (adds b:true).
  api.addResponseInterceptor({
    priority: 2,
    handler: async (res) => {
      const data = await res.json();
      return new Response(JSON.stringify({ ...data, b: true }), { headers: res.headers, status: res.status });
    },
  });
  api.addResponseInterceptor({
    priority: 1,
    handler: async (res) => {
      const data = await res.json();
      return new Response(JSON.stringify({ ...data, a: true }), { headers: res.headers, status: res.status });
    },
  });

  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await api.get<any>({ endpoint: '/r', responseType: 'json' });
  expect(result).toEqual({ ok: true, a: true, b: true });
});

// Regression pin for F2: an error thrown by a response interceptor is a
// deliberate signal, not a transient network failure. It must propagate
// untouched — not be retried, and not be re-wrapped in a RetryError.
test('error thrown by a response interceptor propagates untouched (no retry, no RetryError)', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  class CustomSignal extends Error {}
  api.addResponseInterceptor({
    handler: () => { throw new CustomSignal('rejected by interceptor'); },
  });
  fetchMock.mockResponse(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });

  await expect(api.get({ endpoint: '/r', responseType: 'json' })).rejects.toThrow(CustomSignal);
  // Exactly one network call — the throw must not have triggered retries.
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

// Regression pin for the silent-drop footgun: a handler that returns the
// result of next() (a no-op resolving to undefined) silently discards any
// Request mutations it built.  This test documents that behaviour so that any
// future change to the pipeline semantics is immediately visible.
test('handler returning await next() silently drops its Request mutation (anti-pattern pin)', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  api.addRequestInterceptor({
    handler: async (req, next) => {
      const h = new Headers(req.headers);
      h.set('X-Should-Be-Dropped', 'x');
      // Build the mutated request but return next() instead — mutations lost.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _newReq = new Request(req, { headers: h });
      return await next!(); // next() returns undefined → _newReq is discarded
    },
  });
  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  await api.get({ endpoint: '/silent-drop' });
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  const headers = init.headers as any;
  // If this ever flips to toBe('x') the forward-pipeline semantics changed —
  // update the README Interceptors section and this comment accordingly.
  expect(headers.get('X-Should-Be-Dropped')).toBeNull();
});

test('query serializer handles arrays and nested objects', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  await api.get({ endpoint: '/q', responseType: 'auto', query: { a: [1,2], f: { g: 'x' } } });
  const url = fetchMock.mock.calls[0][0] as string;
  expect(url).toMatch(/a%5B%5D=1/);
  expect(url).toMatch(/a%5B%5D=2/);
expect(url).toMatch(/f%5Bg%5D=x/);
});

test('request deduping coalesces truly concurrent GETs', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test', dedupe: true });
  fetchMock.mockImplementationOnce(async () => {
    await new Promise(r => setTimeout(r, 50));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const p1 = api.get({ endpoint: '/dedupe' });
  const p2 = api.get({ endpoint: '/dedupe' });
  const [r1, r2] = await Promise.all([p1, p2]);
  expect(r1).toEqual({ ok: true });
  expect(r2).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('cursor pagination with Link header (useLinkHeader)', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  fetchMock
    .mockResponseOnce(JSON.stringify({ items: [1,2] }), { status: 200, headers: { 'content-type': 'application/json', 'link': '<https://api.test/cursor?cursor=abc>; rel="next"' } })
    .mockResponseOnce(JSON.stringify({ items: [3] }), { status: 200, headers: { 'content-type': 'application/json' } });

  const items = await api.get<number[]>({
    endpoint: '/cursor',
    responseType: 'json',
    useLinkHeader: true,
    cursorParamName: 'cursor',
    extractor: (resp: any) => resp.items,
    limit: 10,
  } as any);

  expect(Array.isArray(items)).toBe(true);
  expect((items as any[]).length).toBeGreaterThanOrEqual(2);
  const secondUrl = fetchMock.mock.calls[1][0] as string;
  expect(secondUrl).toContain('cursor=abc');
});

test('cursor pagination with getNextCursor and extractor', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  fetchMock
    .mockResponseOnce(JSON.stringify({ items: [1,2], next: 'c2' }), { status: 200, headers: { 'content-type': 'application/json' } })
    .mockResponseOnce(JSON.stringify({ items: [3], next: null }), { status: 200, headers: { 'content-type': 'application/json' } });

  const items = await api.get<number[]>({
    endpoint: '/cursor',
    responseType: 'json',
    cursor: null,
    cursorParamName: 'cursor',
    getNextCursor: (resp: any) => resp.next,
    extractor: (resp: any) => resp.items,
    limit: 10,
  } as any);

  expect(items).toEqual([1,2,3]);
  // Second call should have cursor=c2
  const secondUrl = fetchMock.mock.calls[1][0] as string;
  expect(secondUrl).toContain('cursor=c2');
});

test('get with responseType text returns string', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  fetchMock.mockResponseOnce('hello', { status: 200, headers: { 'content-type': 'text/plain' } });
  const text = await api.get<string>({ endpoint: '/txt', responseType: 'text' });
  expect(text).toBe('hello');
});

test('raw returns Response', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  fetchMock.mockResponseOnce('', { status: 204 });
  const res = await api.raw({ endpoint: '/status' });
  expect(res.status).toBe(204);
});

test('remove and clear interceptors', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  const reqInt = { handler: (req: Request) => {
    const h = new Headers(req.headers); h.set('X-Temp', '1'); return new Request(req, { headers: h });
  } };
  api.addRequestInterceptor(reqInt as any);
  api.removeRequestInterceptor(reqInt as any);
  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  await api.get({ endpoint: '/no-mod' });
  const h1 = (fetchMock.mock.calls[0][1]?.headers as any);
  expect(h1.get('X-Temp')).toBeNull();

  api.addResponseInterceptor({ handler: async (res: Response) => { const d = await res.json(); return new Response(JSON.stringify({ ...d, t: 1 }), { headers: res.headers, status: res.status }); } });
  api.clearResponseInterceptors();
  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  const out = await api.get<any>({ endpoint: '/no-transform' });
  expect(out).toEqual({ ok: true });
});

test('query style repeat/comma and dot object notation', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test', queryStyle: { array: 'repeat', object: 'dot' } });
  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  await api.get({ endpoint: '/q2', responseType: 'auto', query: { a: [1,2], filter: { status: 'active' } } });
  const url = fetchMock.mock.calls[0][0] as string;
  // repeat style: a=1&a=2 (urlencoded)
  const hasRepeat = (url.includes('a=1') && url.includes('a=2'));
  expect(hasRepeat).toBe(true);
  // dot style: filter.status=active (urlencoded dot stays dot)
  expect(url).toContain('filter.status=active');

  // comma style
  fetchMock.resetMocks();
  const api2 = new FetchEnh({ baseURL: 'https://api.test', queryStyle: { array: 'comma', object: 'brackets' } });
  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  await api2.get({ endpoint: '/q3', responseType: 'auto', query: { a: [1,2] } });
  const url2 = fetchMock.mock.calls[0][0] as string;
  expect(url2).toMatch(/a=1%2C2|a=1,2/);
});

test('request deduping does NOT coalesce concurrent POSTs by default', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test', dedupe: true });
  fetchMock.mockImplementation(async () => {
    await new Promise(r => setTimeout(r, 30));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const p1 = api.post({ endpoint: '/submit', body: { a: 1 } });
  const p2 = api.post({ endpoint: '/submit', body: { a: 1 } });
  await Promise.all([p1, p2]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fetchMock.resetMocks();
});

test('request deduping DOES coalesce concurrent POSTs when explicit dedupeKey is provided', async () => {
  const api = new FetchEnh({
    baseURL: 'https://api.test',
    dedupe: true,
    dedupeKey: ({ method, url }) => `${method} ${url}`,
  });
  fetchMock.mockImplementationOnce(async () => {
    await new Promise(r => setTimeout(r, 30));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const p1 = api.post({ endpoint: '/submit', body: { a: 1 } });
  const p2 = api.post({ endpoint: '/submit', body: { a: 1 } });
  const [r1, r2] = await Promise.all([p1, p2]);
  expect(r1).toEqual({ ok: true });
  expect(r2).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('raw with applyMiddleware:true invokes request interceptor pipeline', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  const spy = jest.spyOn(api as any, '_applyRequestInterceptors');
  fetchMock.mockResponseOnce('', { status: 200 });
  await api.raw({ endpoint: '/test', applyMiddleware: true });
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});

test('raw without applyMiddleware skips the interceptor pipeline entirely', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  const spy = jest.spyOn(api as any, '_applyRequestInterceptors');
  fetchMock.mockResponseOnce('', { status: 200 });
  await api.raw({ endpoint: '/test' });
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

// ─── setConfig: missing keys now supported ──────────────────────────────────

test('setConfig can update onRetry callback', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 1 });
  const retryInfo: any[] = [];
  api.setConfig({ onRetry: (info) => retryInfo.push(info) });
  fetchMock
    .mockResponseOnce('', { status: 500 })
    .mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  await api.get({ endpoint: '/retry-hook' });
  expect(retryInfo.length).toBe(1);
  expect(retryInfo[0].reason).toBe('status');
});

test('setConfig can update onComplete callback', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  let completedWith: any = null;
  api.setConfig({ onComplete: (info) => { completedWith = info; } });
  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  await api.get({ endpoint: '/complete-hook' });
  expect(completedWith).not.toBeNull();
  expect(completedWith.ok).toBe(true);
  expect(completedWith.method).toBe('GET');
});

test('setConfig can enable dedupe after construction', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' }); // dedupe: false by default
  api.setConfig({ dedupe: true });
  fetchMock.mockImplementationOnce(async () => {
    await new Promise(r => setTimeout(r, 30));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const p1 = api.get({ endpoint: '/dedupe-cfg' });
  const p2 = api.get({ endpoint: '/dedupe-cfg' });
  await Promise.all([p1, p2]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('setConfig can update dedupeKey factory', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test', dedupe: true });
  // Install a custom dedupeKey that treats all POSTs to same endpoint as identical
  api.setConfig({ dedupeKey: ({ method, url }) => `${method}:${url}` });
  fetchMock.mockImplementationOnce(async () => {
    await new Promise(r => setTimeout(r, 30));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const p1 = api.post({ endpoint: '/submit', body: { a: 1 } });
  const p2 = api.post({ endpoint: '/submit', body: { a: 2 } });
  const [r1, r2] = await Promise.all([p1, p2]);
  expect(r1).toEqual({ ok: true });
  expect(r2).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('setConfig can update queryStyle and it takes effect on subsequent requests', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' }); // default: brackets
  api.setConfig({ queryStyle: { array: 'repeat', object: 'dot' } });
  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  await api.get({ endpoint: '/qs', query: { a: [1, 2], filter: { status: 'active' } } });
  const url = fetchMock.mock.calls[0][0] as string;
  expect(url.includes('a=1') && url.includes('a=2')).toBe(true);  // repeat style
  expect(url).toContain('filter.status=active');                   // dot style
});

test('setConfig warns on unknown keys', () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  (api as any).setConfig({ unknownKey: 'oops', anotherBadKey: 42 });
  expect(warnSpy).toHaveBeenCalledTimes(2);
  expect(warnSpy.mock.calls[0][0]).toContain('unknownKey');
  expect(warnSpy.mock.calls[1][0]).toContain('anotherBadKey');
  warnSpy.mockRestore();
});

// ─── Pagination: maxPages option ─────────────────────────────────────────────

test('page-based pagination respects maxPages option', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  // Always return 5 items per page (> 0 so natural termination never fires)
  fetchMock.mockResponse(JSON.stringify([1, 2, 3, 4, 5]), { status: 200, headers: { 'content-type': 'application/json' } });
  const results = await api.get<number[]>({
    endpoint: '/paged',
    page: 1,
    pageSize: 5,
    maxPages: 3,
    responseType: 'json',
  });
  // 3 pages × 5 items = 15 items; fetch should be called exactly 3 times
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect((results as any[]).length).toBe(15);
});

test('cursor-based pagination respects maxPages option', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  // Each page returns items and a next cursor — would loop forever without maxPages
  fetchMock.mockResponse(
    JSON.stringify({ items: [1, 2], next: 'next-cursor' }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
  const results = await api.get<number[]>({
    endpoint: '/cursor-paged',
    responseType: 'json',
    cursor: null,
    getNextCursor: (resp: any) => resp.next,
    extractor: (resp: any) => resp.items,
    maxPages: 4,
  } as any);
  // 4 pages × 2 items = 8 items; fetch called exactly 4 times
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect((results as any[]).length).toBe(8);
});

test('default page-based safety cap throws rather than silently truncating', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  // Each page has exactly 1 item = pageSize, so the server always signals "more
  // data available" and natural termination never fires. Hitting the default
  // safety cap while more data remains must throw, not return a partial result.
  fetchMock.mockResponse(JSON.stringify([1]), { status: 200, headers: { 'content-type': 'application/json' } });
  await expect(
    api.get({ endpoint: '/paged-default', page: 1, pageSize: 1, responseType: 'json' })
  ).rejects.toThrow(PaginationLimitError);
  // It should still have paged all the way to the cap before throwing.
  expect(fetchMock).toHaveBeenCalledTimes(100);
});

test('default page-based cap does NOT throw when data ends exactly at the cap', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  // 99 full pages then a short final page: data genuinely ends within the cap,
  // so this is a natural termination and must not throw.
  let call = 0;
  fetchMock.mockResponse(async () => {
    call++;
    const body = call < 100 ? JSON.stringify([1, 2]) : JSON.stringify([1]);
    return { body, init: { status: 200, headers: { 'content-type': 'application/json' } } } as any;
  });
  const results = await api.get<number[]>({ endpoint: '/paged-ends', page: 1, pageSize: 2, responseType: 'json' });
  expect((results as any[]).length).toBe(99 * 2 + 1);
  expect(fetchMock).toHaveBeenCalledTimes(100);
});

test('explicit maxPages opts in to silent truncation (no throw)', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  fetchMock.mockResponse(JSON.stringify([1]), { status: 200, headers: { 'content-type': 'application/json' } });
  // Caller explicitly capped at 5 pages while more data exists — this is an
  // opt-in limit, so it stops silently at 5 without throwing.
  const results = await api.get<number[]>({
    endpoint: '/paged-explicit', page: 1, pageSize: 1, maxPages: 5, responseType: 'json',
  });
  expect((results as any[]).length).toBe(5);
  expect(fetchMock).toHaveBeenCalledTimes(5);
});

test('default cursor safety cap throws rather than silently truncating', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  // Every page returns a next cursor, so more data is always signalled.
  fetchMock.mockResponse(
    JSON.stringify({ items: [1], next: 'more' }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
  await expect(
    api.get<number[]>({
      endpoint: '/cursor-default',
      responseType: 'json',
      cursor: null,
      getNextCursor: (resp: any) => resp.next,
      extractor: (resp: any) => resp.items,
    } as any)
  ).rejects.toThrow(PaginationLimitError);
});

test('cursor pagination does NOT throw when the final page has no next cursor', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  let call = 0;
  fetchMock.mockResponse(async () => {
    call++;
    // Last page (10th) drops the next cursor: genuine end within the cap.
    const body = call < 10
      ? JSON.stringify({ items: [1], next: 'more' })
      : JSON.stringify({ items: [1] });
    return { body, init: { status: 200, headers: { 'content-type': 'application/json' } } } as any;
  });
  const results = await api.get<number[]>({
    endpoint: '/cursor-ends',
    responseType: 'json',
    cursor: null,
    getNextCursor: (resp: any) => resp.next ?? null,
    extractor: (resp: any) => resp.items,
  } as any);
  expect((results as any[]).length).toBe(10);
  expect(fetchMock).toHaveBeenCalledTimes(10);
});

test('config properties are readable via public getters', () => {
  const api = new FetchEnh({
    baseURL: 'https://api.test',
    defaultHeaders: { 'X-App': 'test' },
    defaultTimeout: 5000,
    defaultRetries: 2,
  });
  expect(api.baseURL).toBe('https://api.test');
  expect(api.defaultHeaders).toEqual({ 'X-App': 'test' });
  expect(api.defaultTimeout).toBe(5000);
  expect(api.defaultRetries).toBe(2);
});

test('config getter reflects setConfig changes', () => {
  const api = new FetchEnh({ baseURL: 'https://api.test', defaultTimeout: 0 });
  api.setConfig({ baseURL: 'https://new.test/', defaultTimeout: 9999, defaultRetries: 5 });
  expect(api.baseURL).toBe('https://new.test');
  expect(api.defaultTimeout).toBe(9999);
  expect(api.defaultRetries).toBe(5);
});

test('writing to getter-backed config property is a type error at compile time', () => {
  // This test simply documents the intent; the TypeScript compiler enforces
  // the read-only constraint.  At runtime the assignment is a no-op in strict
  // mode or silently ignored — we just verify the getter still returns the
  // correct (unchanged) value.
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  try { (api as any).baseURL = 'https://evil.test'; } catch { /* strict-mode throws */ }
  // The setter does not exist, so either nothing changes or an error is thrown.
  // Either way, the actual _baseURL backing field must not be overwritten.
  expect(api.baseURL).toBe('https://api.test');
});

test('default cursor-based safety cap is 100 pages before it throws', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  fetchMock.mockResponse(
    JSON.stringify({ items: [1], next: 'always-next' }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
  // A never-ending cursor stream: hitting the default cap while more data is
  // signalled throws rather than silently truncating, but only after paging
  // all the way to the 100-page cap.
  await expect(
    api.get({
      endpoint: '/cursor-default',
      responseType: 'json',
      cursor: null,
      getNextCursor: (resp: any) => resp.next,
      extractor: (resp: any) => resp.items,
    } as any)
  ).rejects.toThrow(PaginationLimitError);
  expect(fetchMock).toHaveBeenCalledTimes(100);
});

describe('clearRequestInterceptors and clearResponseInterceptors', () => {
  test('clearRequestInterceptors() prevents subsequent request interceptors from firing', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    const handler = jest.fn().mockImplementation((req: Request) => req);
    api.addRequestInterceptor({ handler });

    fetchMock.mockResponseOnce(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await api.get({ endpoint: '/before' });
    expect(handler).toHaveBeenCalledTimes(1);

    api.clearRequestInterceptors();
    fetchMock.mockResponseOnce(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await api.get({ endpoint: '/after' });
    expect(handler).toHaveBeenCalledTimes(1); // still 1 — not called again
  });

  test('clearResponseInterceptors() prevents subsequent response interceptors from firing', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    const handler = jest.fn().mockImplementation((res: Response) => res);
    api.addResponseInterceptor({ handler });

    fetchMock.mockResponseOnce(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await api.get({ endpoint: '/before' });
    expect(handler).toHaveBeenCalledTimes(1);

    api.clearResponseInterceptors();
    fetchMock.mockResponseOnce(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await api.get({ endpoint: '/after' });
    expect(handler).toHaveBeenCalledTimes(1); // still 1 — not called again
  });

  test('clearRequestInterceptors() is a no-op when no interceptors are registered', () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    expect(() => api.clearRequestInterceptors()).not.toThrow();
  });

  test('clearResponseInterceptors() is a no-op when no interceptors are registered', () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    expect(() => api.clearResponseInterceptors()).not.toThrow();
  });
});

// ─── Deduplication: unhandledRejection regression ───────────────────────
//
// DeduplicationCache.track() used to call promise.finally(cleanup), which
// creates a new chained promise that inherits the rejection.  That chained
// promise was discarded (never awaited/caught), so Node emitted
// `unhandledRejection` even though the caller's copy of the promise was fully
// caught.  The fix replaces .finally() with .then(cleanup, cleanup) so no
// rejection leaks onto a dangling promise chain.

test('dedupe: true does not fire unhandledRejection when a deduped request rejects', async () => {
  const unhandledSpy = jest.fn();
  process.on('unhandledRejection', unhandledSpy);

  try {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0, dedupe: true });
    // Simulate a 500 response — with 0 retries this rejects immediately.
    fetchMock.mockResponseOnce('', { status: 500, headers: { 'content-type': 'application/json' } });

    await expect(api.get({ endpoint: '/fail' })).rejects.toBeTruthy();

    // Give the microtask queue (and any chained-promise settlements) time to drain
    // before checking whether unhandledRejection fired.  setImmediate is not
    // available in jsdom so we use setTimeout(0) which still yields a full
    // macrotask turn — long enough for Node to emit the event.
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(unhandledSpy).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', unhandledSpy);
  }
});

// 304 Not Modified should return null instead of throwing.
test('GET returning 304 Not Modified resolves to null instead of throwing', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
  fetchMock.mockResponseOnce('', { status: 304 });
  const result = await api.get({ endpoint: '/cached', headers: { 'If-None-Match': 'W/"abc"' } });
  expect(result).toBeNull();
});

// computeDelay clamping tests for NaN/Infinity/negative/zero from custom strategies.
test('computeDelay clamps NaN from a custom BackoffStrategy to 0', () => {
  const nanStrategy = { computeDelay: () => NaN };
  const result = computeDelay(1, {}, nanStrategy as any);
  expect(result).toBe(0);
});

test('computeDelay clamps Infinity from a custom BackoffStrategy to 0', () => {
  const infStrategy = { computeDelay: () => Infinity };
  const result = computeDelay(1, {}, infStrategy as any);
  expect(result).toBe(0);
});

test('computeDelay clamps negative value from a custom BackoffStrategy to 0', () => {
  const negStrategy = { computeDelay: () => -500 };
  const result = computeDelay(1, {}, negStrategy as any);
  expect(result).toBe(0);
});

test('computeDelay preserves 0 from a custom BackoffStrategy (intentional no-delay retry)', () => {
  const zeroStrategy = { computeDelay: () => 0 };
  const result = computeDelay(1, {}, zeroStrategy as any);
  expect(result).toBe(0);
});

// isReplayableBody tests covering primitive bodies and ReadableStream.
test('isReplayableBody returns true for boolean body', () => {
  expect(isReplayableBody(true as any)).toBe(true);
});

test('isReplayableBody returns true for number body', () => {
  expect(isReplayableBody(42 as any)).toBe(true);
});

test('isReplayableBody returns false only for ReadableStream', () => {
  // jsdom does not expose ReadableStream; install a temporary stand-in so the
  // `body instanceof ReadableStream` guard inside isReplayableBody can fire.
  class MockReadableStream {}
  const orig = (global as any).ReadableStream;
  (global as any).ReadableStream = MockReadableStream;
  try {
    expect(isReplayableBody(new MockReadableStream() as any)).toBe(false);
  } finally {
    (global as any).ReadableStream = orig;
  }
});

// ─── JsonPrimitive bodies are JSON-encoded with application/json ──────────

describe('JsonPrimitive bodies are JSON-encoded with application/json', () => {
  function readContentType(init: RequestInit | undefined): string | null {
    const h = init?.headers as any;
    if (!h) return null;
    if (typeof h.get === 'function') return h.get('content-type');
    // Plain Record<string, string>: search case-insensitively.
    for (const k of Object.keys(h)) {
      if (k.toLowerCase() === 'content-type') return h[k];
    }
    return null;
  }

  test('body: 42 (number) sends application/json with body "42"', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    fetchMock.mockResponseOnce('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await api.post({ endpoint: '/x', body: 42 as any });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(readContentType(init)).toBe('application/json');
    expect(init.body).toBe('42');
  });

  test('body: true (boolean) sends application/json with body "true"', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    fetchMock.mockResponseOnce('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await api.post({ endpoint: '/x', body: true as any });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(readContentType(init)).toBe('application/json');
    expect(init.body).toBe('true');
  });

  test('body: false (falsy boolean) sends application/json with body "false"', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    fetchMock.mockResponseOnce('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await api.post({ endpoint: '/x', body: false as any });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(readContentType(init)).toBe('application/json');
    expect(init.body).toBe('false');
  });

  test('body: 0 (falsy number) sends application/json with body "0"', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    fetchMock.mockResponseOnce('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await api.post({ endpoint: '/x', body: 0 as any });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(readContentType(init)).toBe('application/json');
    expect(init.body).toBe('0');
  });

  test('body: "" (falsy string) still sends text/plain (existing string contract)', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    fetchMock.mockResponseOnce('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await api.post({ endpoint: '/x', body: '' as any });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    // Empty string is still a string — contract is text/plain.
    expect(readContentType(init)).toBe('text/plain;charset=UTF-8');
    expect(init.body).toBe('');
  });
});

// ─── case-insensitive Content-Type lookups in setContentTypeHeader ────────

describe('setContentTypeHeader honours user-supplied lowercase content-type', () => {
  function readContentType(init: RequestInit | undefined): string | null {
    const h = init?.headers as any;
    if (!h) return null;
    if (typeof h.get === 'function') return h.get('content-type');
    for (const k of Object.keys(h)) {
      if (k.toLowerCase() === 'content-type') return h[k];
    }
    return null;
  }

  test('lowercase content-type is preserved for plain object bodies', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    fetchMock.mockResponseOnce('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await api.post({
      endpoint: '/x',
      body: { x: 1 },
      headers: { 'content-type': 'application/xml' },
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(readContentType(init)).toBe('application/xml');
  });

  test('lowercase content-type is preserved for string bodies', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
    fetchMock.mockResponseOnce('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await api.post({
      endpoint: '/x',
      body: 'plain payload',
      headers: { 'content-type': 'application/custom' },
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(readContentType(init)).toBe('application/custom');
  });
});
