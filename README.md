# FetchEnh

An enhanced fetch utility for TypeScript and JavaScript with built-in retries, authentication strategies, interceptors, pagination, and structured errors.

## Features

- Automatic retries with backoff and jitter
- Authentication strategies (Bearer, API Key, Basic, CSRF)
- Request/response interceptors with priority ordering
- Timeouts and AbortController support
- Response parsing (auto or explicit types)
- Pagination (page/pageSize and cursor/Link-header)
- TypeScript-first API, works in browsers and Node.js

## Installation

```bash
git clone https://github.com/erelsop/FetchEnh.git
cd FetchEnh
npm install
npm run build
```

## Quick Start

```typescript
import FetchEnh from 'fetch-enh';

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

```ts
new FetchEnh({
  baseURL?: string,
  defaultHeaders?: Record<string,string>,
  defaultTimeout?: number,
  defaultRetries?: number,
  queryStyle?: { array?: 'brackets'|'repeat'|'comma'; object?: 'brackets'|'dot' },
  dedupe?: boolean,
  dedupeKey?: (p:{method:string;url:string;body?:any}) => string,
  onRetry?: (info:{attempt:number;delay:number;reason:'status'|'network';method:string;url:string;status?:number})=>void,
  onComplete?: (info:{method:string;url:string;status?:number;ok:boolean;attempts:number;elapsedMs:number})=>void,
});
```

## Methods (summary)

- get/post/put/patch/delete({ endpoint, headers?, query?, body?, responseType?, options? })
- head({ endpoint, headers?, query? }) → Promise<Response>
- raw({ endpoint, method?, headers?, body?, query? }) → Promise<Response>

Response types: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData' | 'response' | 'auto' (default)

## Retries

Default: retries on 5xx, 429, and network errors (safe methods only).

Customize:
```ts
api.setRetryBehavior(
  { shouldRetry: ({ response, error }) => !!error || (!!response && (response.status >= 500 || response.status === 429)) },
  { computeDelay: ({ attempt }) => Math.min(1000 * 2**(attempt-1), 10000) },
  { idempotentOnly: true, respectRetryAfter: true, maxElapsedMs: 30000, allowUnsafeRetries: false, idempotencyKeyFactory: () => crypto.randomUUID() }
);
```

## Authentication

- BearerTokenAuth (with refresh), ApiKeyAuth (header/query), BasicAuth, CsrfTokenAuth, OAuth2

```ts
import { BearerTokenAuth, MemoryTokenStore } from 'fetch-enh';
const api = new FetchEnh({ baseURL: '...' });
api.useAuthStrategy(new BearerTokenAuth(new MemoryTokenStore('token'), async () => 'refreshed-token'));
```

## Interceptors

```ts
api.addRequestInterceptor({ priority: 10, handler: async (req, next) => {
  const h = new Headers(req.headers); h.set('X-Request-Time', Date.now().toString());
  await next();
  return new Request(req, { headers: h });
}});

api.addResponseInterceptor({ handler: async (res, next) => { await next(); return res; }});
```

## Response types

```ts
await api.get({ endpoint: '/data', responseType: 'auto' });
await api.get({ endpoint: '/users', responseType: 'json' });
await api.get({ endpoint: '/image.png', responseType: 'blob' });
await api.get({ endpoint: '/status', responseType: 'response' });
```

## Pagination

Page-based:
```ts
await api.get({ endpoint: '/users', page: 1, pageSize: 100, limit: 500, responseType: 'json' });
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
});
// Or useLinkHeader: true to parse Link headers (server should expose ?cursor=...)
```

## Query parameters

```ts
// Defaults: arrays=brackets, objects=brackets
await api.get({ endpoint: '/search', query: { tags: ['js','ts'], filter: { status: 'active' } } });

// Configure styles globally
const api2 = new FetchEnh({ baseURL: '...', queryStyle: { array: 'repeat', object: 'dot' } });
```

## Errors

Throws FetchError (HTTP), TimeoutError, RetryError. All have toJSON():
```ts
try { await api.get({ endpoint: '/data' }); }
catch (e) {
  if ('toJSON' in e) console.log((e as any).toJSON());
}
```

## Timeouts and Abort

Per-request and global timeouts; also pass your own AbortSignal.
```ts
const c = new AbortController();
await api.get({ endpoint: '/slow', options: { timeout: 5000, signal: c.signal } });
```

## Hooks and deduping

- onRetry(info): called before retry (status/network)
- onComplete(info): called after completion (success or error)
- dedupe: coalesce concurrent identical requests (configurable key)

## Environment

- Browser: use native fetch; some headers (e.g., User-Agent) are restricted by the platform.
- Node.js: works with global fetch (Node 18+); inject fetch if needed on older versions.

## Contributing

PRs welcome.

## License

MIT

## Links

- Repository: https://github.com/erelsop/FetchEnh
- Issues: https://github.com/erelsop/FetchEnh/issues
- Examples: ./examples
