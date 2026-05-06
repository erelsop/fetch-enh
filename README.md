# FetchEnh

An enhanced fetch utility for TypeScript and JavaScript with built-in retries, authentication strategies, interceptors, pagination, and structured errors.

## Features

- Automatic retries with backoff and jitter (with `Retry-After` support and a per-call retry override)
- Authentication strategies: Bearer (with refresh), API Key (header or query), Basic (UTF‑8 safe), CSRF, OAuth2 client-credentials (Node) and OAuth2 + PKCE (browser)
- Cross-origin credential stripping on redirect (`Authorization`, `Cookie`, `Cookie2`, `Proxy-Authorization`)
- Request/response interceptors with priority ordering and onion-model composition
- Timeouts and `AbortController` support, both global and per-request
- Response parsing (`auto` content-type sniffing or explicit types) with 204/205 handled as `null`
- Pagination — page/`pageSize` and cursor / `Link` header — exposed as both buffered (`get()`) and streaming (`getIter()`) variants
- Structured errors with `toJSON()` (`FetchError`, `RetryError`, `TimeoutError`, `UnsupportedResponseTypeError`, `InterceptorAbortError`, `AuthAbortError`)
- TypeScript-first API with `readonly` types and bounded `QueryValue` typing; works in browsers and Node.js (≥ 18)
- Zero runtime dependencies
- Dual CJS/ESM build with source maps, declaration maps, and `sideEffects: false` — tree-shakeable by modern bundlers (Vite, esbuild, Rollup, webpack 5+)

## Installation

```bash
git clone https://github.com/erelsop/FetchEnh.git
cd FetchEnh
npm install
npm run build        # emits both CJS (dist/) and ESM (dist/esm/)
```

The package ships a dual build:

| Condition | Output |
|-----------|--------|
| `require()` / CJS bundlers | `dist/index.js` |
| `import` / ESM bundlers | `dist/esm/index.js` |
| TypeScript types | `dist/index.d.ts` (also emitted into `dist/esm/`) |

Bundlers that respect the `exports` map in `package.json` (Vite, esbuild, Rollup, webpack 5+) will automatically select the correct entry point. Source maps and declaration maps ship in both builds for debuggable production stack traces, and `"sideEffects": false` lets bundlers tree-shake unused exports.

**Runtime requirement:** Node.js ≥ 18 (enforced via `engines`). The library uses global `fetch`, `AbortController`, `FormData`, `Blob`, `Headers`, and `URL`.

## Quick Start

```typescript
import FetchEnh from 'fetch-enh';

// All config fields are optional; new FetchEnh() with no args is valid.
const api = new FetchEnh({
  baseURL: 'https://api.example.com',
  defaultHeaders: { 'X-API-Version': '1.0' },
  defaultTimeout: 5000,
  defaultRetries: 3,
});

const users = await api.get({ endpoint: '/users' });
const created = await api.post({ endpoint: '/users', body: { name: 'Jane' } });
```

## Configuration (constructor)

All fields are optional — `new FetchEnh()` (no arguments) is valid and uses sensible defaults.

```ts
new FetchEnh({
  baseURL?: string,
  defaultHeaders?: Record<string,string>,
  defaultTimeout?: number,          // ms; 0 = no timeout (default)
  defaultRetries?: number,          // default 3
  queryStyle?: { array?: 'brackets'|'repeat'|'comma'; object?: 'brackets'|'dot' },
  dedupe?: boolean,                 // default false; coalesces concurrent identical safe requests
  dedupeKey?: (p:{method:string;url:string;body?:unknown}) => string,
  onRetry?: (info:{attempt:number;delay:number;reason:'status'|'network';method:string;url:string;status?:number})=>void,
  onComplete?: (info:{method:string;url:string;status?:number;ok:boolean;attempts:number;elapsedMs:number})=>void,
});
```

`setConfig(config: FetchEnhConfig)` accepts the same options as the constructor and can be called at any time to update live settings. `defaultHeaders` is **merged** (not replaced) so partial updates don't clobber existing headers. Unrecognised keys produce a `console.warn`.

## Methods (summary)

- `get/post/put/patch/delete({ endpoint, headers?, query?, body?, responseType?, options?, bodyFactory? })`
- `head({ endpoint, headers?, query? })` → `Promise<Response>` (always returns the raw `Response`; HEAD has no body)
- `getIter({ ... })` → `AsyncGenerator<T[]>` — streaming variant of `get()` that yields one page at a time (see [Pagination](#pagination))
- `raw({ endpoint, method?, headers?, body?, query?, applyMiddleware? })` → `Promise<Response>`
  - By default, `raw()` calls `fetch()` directly — no interceptors, no auth, no timeout, no retries.
  - Pass `applyMiddleware: true` to apply request interceptors, auth strategies, and response interceptors while still skipping timeout and retry scaffolding.
- `addRequestInterceptor` / `removeRequestInterceptor` / `clearRequestInterceptors`
- `addResponseInterceptor` / `removeResponseInterceptor` / `clearResponseInterceptors`
- `useAuthStrategy` / `removeAuthStrategy` / `clearAuthStrategies`
- `setConfig`, `setRetryBehavior`, `setRetryClassifier`, `setBackoffStrategy`, `setRetryConfig`

Response types: `'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData' | 'response' | 'auto'` (default `'json'`; `'auto'` sniffs `Content-Type`). Responses with status `204 No Content` or `205 Reset Content` resolve to `null` for any `responseType` other than `'response'`.

## Retries

Default: retries on 5xx, 429, and network errors (safe methods only — `GET`, `HEAD`, `OPTIONS`). `Retry-After` headers (delta-seconds and HTTP dates) are honoured by default and clamped to non-negative.

Customize globally:
```ts
api.setRetryBehavior(
  { shouldRetry: ({ response, error }) => !!error || (!!response && (response.status >= 500 || response.status === 429)) },
  { computeDelay: ({ attempt }) => Math.min(1000 * 2**(attempt-1), 10000) },
  { idempotentOnly: true, respectRetryAfter: true, maxElapsedMs: 30000, allowUnsafeRetries: false, idempotencyKeyFactory: () => crypto.randomUUID() }
);

// Or update piecewise:
api.setRetryClassifier(null);          // revert to built-in (5xx + 429)
api.setBackoffStrategy(null);          // revert to built-in exponential + jitter
api.setRetryConfig({ maxElapsedMs: 60_000 }); // merge into existing config
```

Customize per request:
```ts
await api.post({
  endpoint: '/jobs',
  body: payload,
  options: {
    retries: 3,
    retry: { idempotentOnly: false, allowUnsafeRetries: true, idempotencyKeyFactory: () => crypto.randomUUID() },
  },
});
```

### Replayable bodies

Plain objects, strings, `URLSearchParams`, `Blob`, `ArrayBuffer`, and `FormData` are replayable across retries. `ReadableStream` bodies are **not** — if `retries > 0` and a non-replayable body is detected, FetchEnh logs a warning and skips retries. To make stream-style bodies retryable, pass `bodyFactory` so each attempt gets a fresh body:

```ts
await api.post({
  endpoint: '/upload',
  body: makeStream(),                // initial body
  bodyFactory: () => makeStream(),   // fresh body for every retry
  options: { retries: 3 },
});
```

## Authentication

```ts
import {
  BearerTokenAuth,
  ApiKeyAuth,
  BasicAuth,
  CsrfTokenAuth,
  OAuth2ClientCredentialsAuth,
  OAuth2PKCEAuth,
  MemoryTokenStore,
} from 'fetch-enh';
```

- `BearerTokenAuth(store, refresh)` — sends `Authorization: Bearer <token>`; on 401 invokes `refresh()` (deduplicated across concurrent requests) and retries once.
- `ApiKeyAuth({ headerName? | queryName?, getApiKey })` — at least one of `headerName`/`queryName` is required; constructor throws otherwise.
- `BasicAuth(username, password)` — UTF‑8 safe (uses `Buffer` in Node, `TextEncoder` + `btoa` in browsers).
- `CsrfTokenAuth(headerName, getToken)` — pulls a CSRF token from any source you provide.
- `OAuth2ClientCredentialsAuth({ tokenURL, clientId, clientSecret, scope?, tokenStore })` — **Node-only.** The constructor throws in browser contexts to prevent client-secret exposure. Surfaces token-endpoint errors with HTTP status and validates that the response contains a string `access_token`.
- `OAuth2PKCEAuth({ tokenStore, refreshTokenStore?, getAccessToken, refreshWithRefreshToken? })` — browser-friendly OAuth 2.0 with PKCE; you supply the user-interactive functions, the strategy handles token storage, expiry tracking, and refresh.

```ts
const api = new FetchEnh({ baseURL: '...' });
api.useAuthStrategy(new BearerTokenAuth(new MemoryTokenStore('token'), async () => 'refreshed-token'));
```

### MemoryTokenStore TTL

`MemoryTokenStore` supports optional time-to-live so you don't need to track expiry yourself:

```ts
const store = new MemoryTokenStore();
// token auto-expires after expires_in seconds
store.setTokenWithExpiry(json.access_token, json.expires_in * 1000);

// Plain setToken() clears any pending TTL:
store.setToken('new-token');          // no expiry

// Snapshot for debugging:
const { token, expiresAtMs } = store.getAll();
```

### Cross-origin credential stripping

All outbound `fetch()` calls go through a `safeFetch()` helper that performs manual redirect handling. On a cross-origin hop, sensitive request headers (`Authorization`, `Cookie`, `Cookie2`, `Proxy-Authorization`) are stripped before the next request is issued. Up to 20 hops are followed before a `Too many redirects` error is thrown. RFC 7231 method-switching rules are applied (303 → GET; 301/302 → GET for non-safe methods; 307/308 preserve method and body).

## Interceptors

Interceptors compose onion-style around the underlying request. `priority` controls ordering (lower numbers run first on the way in). Returning `false` halts the chain with a typed `InterceptorAbortError` (which is **not** retried).

```ts
api.addRequestInterceptor({ priority: 10, handler: async (req, next) => {
  const h = new Headers(req.headers); h.set('X-Request-Time', Date.now().toString());
  await next();
  return new Request(req, { headers: h });
}});

api.addResponseInterceptor({ handler: async (res, next) => { await next(); return res; }});

// Removal is by reference; clearing wipes everything:
api.removeRequestInterceptor(myInterceptor);
api.clearResponseInterceptors();
```

> **Timeout note:** the timeout budget begins at the start of `_fetchAndParse`, **before** request interceptors and auth strategies execute. Slow interceptors consume timeout before the actual network call; keep them fast or increase `timeout` accordingly.

## Response types

```ts
await api.get({ endpoint: '/data', responseType: 'auto' });
await api.get({ endpoint: '/users', responseType: 'json' });
await api.get({ endpoint: '/image.png', responseType: 'blob' });
await api.get({ endpoint: '/status', responseType: 'response' });
```

The TypeScript overloads ensure that `responseType: 'response'` resolves to `Promise<Response>` while every other case resolves to `Promise<T>`.

## Pagination

Page-based:
```ts
await api.get({ endpoint: '/users', page: 1, pageSize: 100, limit: 500, responseType: 'json' });
// maxPages caps the number of page-fetches (default: 100 for both strategies)
await api.get({ endpoint: '/users', page: 1, pageSize: 20, maxPages: 10, responseType: 'json' });
```

Cursor-based:
```ts
await api.get({
  endpoint: '/users',
  responseType: 'json',
  cursor: null,
  cursorParamName: 'cursor',
  getNextCursor: (resp) => resp.nextCursor,
  extractor: (resp) => resp.items,
  maxPages: 50,   // optional; defaults to 100
});
// Or useLinkHeader: true to parse Link headers — both relative and absolute URLs are handled:
// e.g. Link: </items?cursor=tok>; rel="next"  OR  Link: <https://api.example.com/items?cursor=tok>; rel="next"
```

Cursor pagination JSON parse failures **propagate as errors** rather than being silently swallowed.

### Streaming pagination — `getIter()`

`getIter()` is the async-generator variant of `get()`. It yields one page at a time so you can process huge result sets without buffering everything into memory:

```ts
for await (const page of api.getIter<User>({ endpoint: '/users', page: 1, pageSize: 50 })) {
  await saveToDatabase(page);  // only one page is held in memory at a time
}

// Cursor-based:
for await (const page of api.getIter<Item>({
  endpoint: '/items',
  cursor: null,
  useLinkHeader: true,
})) {
  process(page);
}
```

`getIter()` accepts the same options as `get()`. For a non-paginated GET it yields a single one-element array containing the result.

## Query parameters

```ts
// Defaults: arrays=brackets, objects=brackets
await api.get({ endpoint: '/search', query: { tags: ['js','ts'], filter: { status: 'active' } } });

// Configure styles globally
const api2 = new FetchEnh({ baseURL: '...', queryStyle: { array: 'repeat', object: 'dot' } });
```

Accepted query value types are bounded by `QueryValue`: primitives (`string | number | boolean | Date`), arrays of primitives, one level of object nesting, or `null`/`undefined` (which are omitted).

## Errors

FetchEnh throws typed errors. All of them set `name`, expose a `code`, and provide `toJSON()`:

| Class | `code` | Thrown when |
|-------|--------|-------------|
| `FetchError` | `EHTTP` | A non-retried HTTP error response is received (or retries are exhausted with a final non-OK response). |
| `RetryError` | `ERETRY` | All network/error retries are exhausted; ES2022 `cause` carries the underlying error. |
| `TimeoutError` | `ETIMEDOUT` | Per-request timeout fires, or `maxElapsedMs` retry budget is exceeded. |
| `UnsupportedResponseTypeError` | `EUNSUPPORTED_RESPONSE` | An unknown `responseType` string is supplied. |
| `InterceptorAbortError` | `EINTERCEPTOR_ABORT` | A request or response interceptor returned `false`. Not retried. |
| `AuthAbortError` | `EAUTH_ABORT` | An auth strategy's `onRequest` returned `false`. Not retried. |

```ts
import { FetchError, TimeoutError, RetryError } from 'fetch-enh';

try {
  await api.get({ endpoint: '/data' });
} catch (e) {
  if (e instanceof FetchError) {
    console.log(e.toJSON());            // { name, code, status, method, url, attempts, elapsedMs, requestId, data }
  } else if (e instanceof TimeoutError) {
    console.log(e.code, e.elapsedMs);
  } else if (e instanceof RetryError) {
    console.log(e.attempts, e.cause);
  }
}
```

## Timeouts and Abort

Per-request and global timeouts; you can also pass your own `AbortSignal`. The auth-retry path gets a **fresh** `AbortController` and timeout budget, so token-refresh round-trips can't immediately abort the retry.

```ts
const c = new AbortController();
await api.get({ endpoint: '/slow', options: { timeout: 5000, signal: c.signal } });
```

## Hooks and deduping

- `onRetry(info)`: called before each retry (`reason: 'status' | 'network'`).
- `onComplete(info)`: called after every completion (success or error) with `attempts` and `elapsedMs`.
- `dedupe`: coalesce concurrent identical **GET / HEAD / OPTIONS** requests into a single in-flight promise. Mutation methods (POST, DELETE, PATCH, PUT) are **not** deduplicated by default — each call produces its own side-effect. To opt mutation methods into deduplication, supply an explicit `dedupeKey` factory at construction time.

> **Note:** the dedup key is computed from the pre-interceptor `Request`. Interceptors that add unique headers or rewrite the URL are not reflected in the key, so semantically distinct requests may be coalesced. Disable dedup or supply a custom `dedupeKey` if your interceptors make requests unique.

## Environment

- **Browser:** uses native `fetch`. Some headers (e.g. `User-Agent`) are restricted by the platform. Use `OAuth2PKCEAuth` — never `OAuth2ClientCredentialsAuth`, which throws in browsers to avoid leaking the client secret.
- **Node.js:** works with global `fetch` (Node ≥ 18). Inject `fetch` via `OAuth2ClientCredentialsAuth`'s `fetchFn` parameter if you need a custom transport.

## Contributing

PRs welcome.

## License

MIT

## Links

- Repository: https://github.com/erelsop/FetchEnh
- Issues: https://github.com/erelsop/FetchEnh/issues
- Examples: ./examples
