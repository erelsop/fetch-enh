/** @jest-environment node */
import http from 'http';
import type { AddressInfo } from 'net';
import { fetch as nativeFetch } from 'undici';
import FetchEnh from '../src';
import { FetchError, TimeoutError } from '../src/errors/fetchErrors';

let server: http.Server;
let baseURL: string;

beforeAll(async () => {
  // Override the jest-fetch-mock installed by jest.setup.ts so that FetchEnh's
  // internal safeFetch() resolves the bare `fetch` global to the real undici
  // implementation and makes actual network calls to our local server.
  (global as any).fetch = nativeFetch;

  server = http.createServer((req, res) => {
    const { method, url } = req;

    // GET /hello → 200 JSON { message: 'hello' }
    if (method === 'GET' && url === '/hello') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'hello' }));
      return;
    }

    // POST /echo → reads body, echoes { method, contentType, body }
    if (method === 'POST' && url === '/echo') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            method: req.method,
            contentType: req.headers['content-type'] ?? '',
            body: parsed,
          }),
        );
      });
      return;
    }

    // GET /not-found → 404 JSON { error: 'not found' }
    if (method === 'GET' && url === '/not-found') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    // GET /slow → waits 400 ms then 200 JSON { done: true }
    if (method === 'GET' && url === '/slow') {
      const timer = setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ done: true }));
        }
      }, 400);
      // Don't leak the timer if the client disconnects early
      res.on('close', () => clearTimeout(timer));
      return;
    }

    // GET /headers → 200 JSON with the incoming request headers (string values only)
    if (method === 'GET' && url === '/headers') {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') {
          headers[key] = value;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(headers));
      return;
    }

    // DELETE /resource → 204 No Content
    if (method === 'DELETE' && url === '/resource') {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /paginated?page=N&pageSize=M → page-based pagination fixture
    // Page 1 responds immediately with [1, 2, 3].
    // Page 2+ hangs for 10 s so an AbortSignal can cancel the in-flight request
    // before the response arrives — used to exercise composeSignals / AbortSignal.any.
    if (method === 'GET' && url?.startsWith('/paginated')) {
      const parsedUrl = new URL(url, 'http://localhost');
      const page = parseInt(parsedUrl.searchParams.get('page') ?? '1', 10);
      if (page === 1) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([1, 2, 3]));
      } else {
        // Hang so the abort signal has time to fire before we respond.
        const timer = setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([4, 5, 6]));
          }
        }, 10_000);
        res.on('close', () => clearTimeout(timer));
      }
      return;
    }

    // Fallback 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;
  baseURL = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

// ── Tests ────────────────────────────────────────────────────────────────────

test('GET /hello returns { message: "hello" }', async () => {
  const api = new FetchEnh({ baseURL, defaultRetries: 0 });
  const result = await api.get<{ message: string }>({ endpoint: '/hello' });
  expect(result).toEqual({ message: 'hello' });
});

test('POST /echo with JSON body echoes body and content-type correctly', async () => {
  const api = new FetchEnh({ baseURL, defaultRetries: 0 });
  const result = await api.post<{ method: string; contentType: string; body: unknown }>({
    endpoint: '/echo',
    body: { name: 'world' },
  });
  expect(result.method).toBe('POST');
  expect(result.contentType).toContain('application/json');
  expect(result.body).toEqual({ name: 'world' });
});

test('GET /not-found rejects with FetchError', async () => {
  const api = new FetchEnh({ baseURL, defaultRetries: 0 });
  await expect(api.get({ endpoint: '/not-found' })).rejects.toThrow(FetchError);
});

test('GET /slow with options: { timeout: 100 } rejects with TimeoutError', async () => {
  const api = new FetchEnh({ baseURL, defaultRetries: 0, defaultTimeout: 0 });
  await expect(
    api.get({ endpoint: '/slow', options: { timeout: 100 } }),
  ).rejects.toThrow(TimeoutError);
});

test('GET /headers with defaultHeaders sends x-api-key and server receives it', async () => {
  const api = new FetchEnh({
    baseURL,
    defaultRetries: 0,
    defaultHeaders: { 'x-api-key': 'test-key' },
  });
  const result = await api.get<Record<string, string>>({ endpoint: '/headers' });
  expect(result['x-api-key']).toBe('test-key');
});

test('DELETE /resource with responseType: "response" returns status 204', async () => {
  const api = new FetchEnh({ baseURL, defaultRetries: 0 });
  const response = await api.delete({ endpoint: '/resource', responseType: 'response' });
  expect((response as Response).status).toBe(204);
});

test('FetchError.status is 404 for GET /not-found', async () => {
  const api = new FetchEnh({ baseURL, defaultRetries: 0 });
  let caughtError: FetchError | undefined;
  try {
    await api.get({ endpoint: '/not-found' });
  } catch (e) {
    if (e instanceof FetchError) {
      caughtError = e;
    }
  }
  expect(caughtError).toBeInstanceOf(FetchError);
  expect(caughtError!.status).toBe(404);
});

// getIter should cancel the in-flight page-2 request when the caller's
// AbortSignal fires. This exercises the composeSignals() helper that
// delegates to AbortSignal.any().
test('getIter with user signal: aborting mid-iteration cancels the in-flight request', async () => {
  const api = new FetchEnh({ baseURL, defaultRetries: 0 });
  const controller = new AbortController();

  const received: number[][] = [];
  let caughtError: Error | null = null;

  try {
    for await (const page of api.getIter<number>({
      endpoint: '/paginated',
      page: 1,
      pageSize: 3,
      options: { signal: controller.signal },
    })) {
      received.push(page as number[]);
      // Abort after page 1 so the in-flight request for page 2 is cancelled.
      controller.abort();
    }
  } catch (e: unknown) {
    caughtError = e as Error;
  }

  // Page 1 must have been received before the abort.
  expect(received).toHaveLength(1);
  expect(received[0]).toEqual([1, 2, 3]);

  // The pending page-2 request must have been terminated via composeSignals.
  expect(caughtError).toBeTruthy();
  expect(caughtError!.name).toBe('AbortError');
}, 15_000);

// raw() with a body must work on real (undici) fetch. Earlier versions threw
// "RequestInit: duplex option is required when sending a body" on Node ≥ 18
// because request.body (a ReadableStream) was being extracted into the
// safeFetch init object — the pre-serialisation path now sidesteps that.
test('raw() with body POSTs correctly against real fetch', async () => {
  const api = new FetchEnh({ baseURL, defaultRetries: 0 });
  const res = await api.raw({
    endpoint: '/echo',
    method: 'POST',
    body: { hello: 'world' },
  });
  expect(res.status).toBe(200);
  const data = await res.json() as { method: string; contentType: string; body: unknown };
  expect(data.method).toBe('POST');
  expect(data.contentType).toContain('application/json');
  expect(data.body).toEqual({ hello: 'world' });
});

// ReadableStream bodies must work with `api.post/put/patch/delete()` on Node
// ≥ 18 / undici-backed fetch. Earlier builds threw "RequestInit: duplex
// option is required when sending a body" because `buildRequest` and
// `safeFetch` both passed a stream body to the underlying fetch without
// `duplex: 'half'`. The two helpers now detect stream bodies and attach the
// flag automatically.
test('post() with ReadableStream body succeeds against real fetch (duplex fix)', async () => {
  const api = new FetchEnh({ baseURL, defaultRetries: 0 });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('streamy-payload'));
      controller.close();
    },
  });
  const res = await api.post<{ method: string; body: unknown }>({
    endpoint: '/echo',
    body: stream,
  });
  expect(res.method).toBe('POST');
  // The server JSON.parse-fails on the raw bytes 'streamy-payload', so the
  // server falls back to returning the raw string for `body`.
  expect(res.body).toBe('streamy-payload');
});

test('raw() with ReadableStream body succeeds against real fetch (duplex fix)', async () => {
  const api = new FetchEnh({ baseURL, defaultRetries: 0 });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('raw-streamy'));
      controller.close();
    },
  });
  const res = await api.raw({
    endpoint: '/echo',
    method: 'POST',
    body: stream,
  });
  expect(res.status).toBe(200);
  const data = await res.json() as { method: string; body: unknown };
  expect(data.method).toBe('POST');
  expect(data.body).toBe('raw-streamy');
});

test('raw({ applyMiddleware: true }) with body POSTs correctly through interceptors', async () => {
  const api = new FetchEnh({ baseURL, defaultRetries: 0 });
  api.addRequestInterceptor({
    handler: (req) => {
      const h = new Headers(req.headers);
      h.set('x-via-interceptor', 'yes');
      return new Request(req, { headers: h });
    },
  });
  const res = await api.raw({
    endpoint: '/echo',
    method: 'POST',
    body: { a: 1 },
    applyMiddleware: true,
  });
  expect(res.status).toBe(200);
  const data = await res.json() as { method: string; contentType: string; body: unknown };
  expect(data.method).toBe('POST');
  expect(data.body).toEqual({ a: 1 });
});
