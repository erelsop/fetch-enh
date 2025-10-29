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
