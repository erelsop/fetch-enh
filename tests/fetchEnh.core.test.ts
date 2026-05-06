import FetchEnh from '../src';
import fetchMock from 'jest-fetch-mock';

beforeEach(() => {
  fetchMock.resetMocks();
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
    handler: async (req, next) => {
      await next();
      const h = new Headers(req.headers);
      h.set('X-A', 'a');
      return new Request(req, { headers: h });
    },
  });
  api.addRequestInterceptor({
    priority: 2,
    handler: async (req, next) => {
      await next();
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
  api.addResponseInterceptor({
    priority: 2,
    handler: async (res, next) => {
      await next();
      const data = await res.json();
      return new Response(JSON.stringify({ ...data, b: true }), { headers: res.headers, status: res.status });
    },
  });
  api.addResponseInterceptor({
    priority: 1,
    handler: async (res, next) => {
      await next();
      const data = await res.json();
      return new Response(JSON.stringify({ ...data, a: true }), { headers: res.headers, status: res.status });
    },
  });

  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await api.get<any>({ endpoint: '/r', responseType: 'json' });
  expect(result).toEqual({ ok: true, a: true, b: true });
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

  api.addResponseInterceptor({ handler: async (res: Response, next: Function) => { await next(); const d = await res.json(); return new Response(JSON.stringify({ ...d, t: 1 }), { headers: res.headers, status: res.status }); } });
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

test('default page-based pagination cap is 100', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  fetchMock.mockResponse(JSON.stringify([1]), { status: 200, headers: { 'content-type': 'application/json' } });
  await api.get({ endpoint: '/paged-default', page: 1, pageSize: 1, responseType: 'json' });
  // Each page has exactly 1 item = pageSize, so natural termination never fires.
  // The maxPages default of 100 should terminate it after 100 fetches.
  expect(fetchMock).toHaveBeenCalledTimes(100);
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

test('default cursor-based pagination cap is 100 (not 200)', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  fetchMock.mockResponse(
    JSON.stringify({ items: [1], next: 'always-next' }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
  await api.get({
    endpoint: '/cursor-default',
    responseType: 'json',
    cursor: null,
    getNextCursor: (resp: any) => resp.next,
    extractor: (resp: any) => resp.items,
  } as any);
  // Previously capped at 201; new default is 100.
  expect(fetchMock).toHaveBeenCalledTimes(100);
});
