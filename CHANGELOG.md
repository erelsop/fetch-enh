# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No changes yet._

## [1.2.0] — 2026-07-22

Adds an optional client-side request governor for staying within an upstream
API's rate and concurrency limits during large or bursty workloads (e.g.
long paginated pulls). Purely additive — no behavioural change when the new
options are omitted.

### Added

- **`FetchEnhConfig.concurrency`** — caps the number of logical requests in
  flight at once with a fair FIFO semaphore. Applied **once per logical
  request**, not per retry attempt, so a request does not hold a slot while it
  sleeps between retries.
- **`FetchEnhConfig.maxRps`** — caps requests started per second, enforced as a
  minimum spacing (`1000 / maxRps` ms) between request starts.
- **`FetchEnhConfig.minIntervalMs`** — explicit minimum spacing (ms) between
  request starts; takes precedence over `maxRps`.
- All three are also accepted by **`setConfig(...)`**, which rebuilds the
  governor with the merged values.
- Both gates honour a request's `AbortSignal`: a cancelled request waiting in
  the concurrency queue rejects promptly with an `AbortError` and never runs.
- When none of the three options is set, the governor is a zero-overhead
  pass-through.

## [1.1.0] — 2026-07-22

Data-integrity and resilience release. One behavioural change to pagination
(previously silent truncation now throws) plus two additive configuration
options. No public type or method was removed or renamed.

### Changed — Pagination no longer silently truncates ⚠️

- Page-based and cursor-based pagination previously stopped at the built-in
  `maxPages` safety cap (default **100**) and returned a **truncated** result
  set with no signal. At common page sizes this silently dropped data — e.g.
  paging 100 000 records at 1 000/page hits exactly 100 pages and returned only
  the first 100 000... but any dataset larger than `pageSize × 100` came back
  short with no error.
- Now: reaching the **default** cap while the server still reports more data
  throws the new **`PaginationLimitError`** instead of returning a partial
  array. This converts silent data loss into a loud, actionable failure.
- **Opt-in escape hatch:** passing an **explicit** `maxPages` (any number, or
  `maxPages: Infinity` for unbounded) is treated as a deliberate limit and
  stops silently at that page count **without** throwing — unchanged from 1.0.0
  for callers who already set `maxPages`.
- **Migration:** callers who never set `maxPages` and relied on the implicit
  100-page stop should either pass an explicit `maxPages` to restore the old
  silent behaviour, or (recommended) raise/remove the cap with
  `maxPages: Infinity` and page the full set. Callers already passing
  `maxPages` are unaffected.

### Added

- **`PaginationLimitError`** — thrown when the default pagination safety cap is
  reached with more data available (see above). Exported from the package root;
  carries `code: 'EPAGINATION_LIMIT'` and `maxPages`. Like `InterceptorAbortError`
  it is intentionally **not** retried by the retry loop.
- **`RetryConfig.maxBackoffMs`** — configurable upper bound (ms) for the
  built-in exponential backoff (default **2000**, unchanged). Raise it to ride
  out sustained `429` bursts on long paginated pulls. Does not affect a
  `Retry-After` header value (capped separately at 60 s) or a custom
  `BackoffStrategy`.

### Fixed

- **Errors thrown by a response interceptor are no longer misclassified as
  transient network failures.** Previously, if a `ResponseInterceptor` handler
  threw, the retry loop caught it, retried the request, and ultimately wrapped
  it in a `RetryError` — obscuring the original error and issuing pointless
  retries. Such a throw is now recognised as a deliberate signal and propagates
  untouched (no retry, no `RetryError` wrapping), consistent with how
  `InterceptorAbortError` is already handled.

## [1.0.0] — 2026-05-08

First public release of FetchEnh. The public surface documented below is
stable; future `1.x` minor releases will be backwards compatible per SemVer,
and breaking changes will be deferred to a `2.0`.

### Highlights

FetchEnh is a zero-runtime-dependency `fetch` wrapper for TypeScript and
JavaScript. It composes the platform's native `fetch`, `AbortController`,
`Request`, `Response`, `Headers`, `FormData`, `Blob`, and `URL` into a single
ergonomic client with first-class support for retries, authentication,
interceptors, pagination, request deduplication, structured errors, and
cross-origin redirect safety.

- Drop-in for any Node ≥ 20 or modern browser project.
- Dual CJS + ESM build with declaration files, source maps, and
  `sideEffects: false` for tree-shaking.
- TypeScript-first: bounded `QueryValue` typing, `readonly` types, and a
  consolidated barrel surface so SDK authors can import every public type
  directly from `'fetch-enh'`.

### Added — Core fetch wrapper

- **`FetchEnh` class** — composable client constructed with `new FetchEnh(config?)`.
  All config fields are optional; `new FetchEnh()` is valid and uses sensible
  defaults.
- **HTTP methods**:
  - `get<T>({ endpoint, headers?, query?, responseType?, options?, … })`
  - `post<T>({ endpoint, body?, headers?, query?, responseType?, options?, bodyFactory? })`
  - `put<T>(…)`, `patch<T>(…)`, `delete<T>(…)` — same shape as `post`
  - `head({ endpoint, headers?, query? })` → `Promise<Response>` (HEAD has no body)
  - `raw({ endpoint, method?, body?, headers?, query?, applyMiddleware?, signal? })`
    → `Promise<Response>` — escape hatch that bypasses interceptors / auth /
    timeouts / retries by default. Pass `applyMiddleware: true` to opt back
    into the **full** `AuthStrategy` contract (`onRequest` *and* `onAuthError`
    so token-refresh strategies fire on 401/403) plus request and response
    interceptors.
- **`getIter<T>(…)` async generator** — streaming variant of `get()` that
  yields one page at a time. Honours both page-based (`page` + `pageSize`) and
  cursor-based (`cursor` + `cursorParamName` + `getNextCursor` / `useLinkHeader`)
  pagination contracts. Supports mid-iteration cancellation via
  `options.signal`.
- **Configuration**:
  - `setConfig(config)` — merges into the live instance; `defaultHeaders` is
    merged (not replaced) so partial updates don't clobber existing headers.
    Unknown keys produce a `console.warn` rather than silent acceptance.
  - `setRetryClassifier(classifier | null)` / `setBackoffStrategy(strategy | null)` —
    each pass `null` to revert to the built-in default in one call.
  - `setRetryConfig(partialConfig)` — partial merge into existing config.
  - `setRetryBehavior(classifier?, strategy?, partialConfig?)` — composite
    setter; pass `null` for any of the three positional arguments to revert
    to the built-in default for that slot.

### Added — Authentication strategies

- **`AuthStrategy`** interface — composable two-half contract: `onRequest`
  (decorate outgoing request) and `onAuthError` (handle 401/403 response with
  a `retry(newRequest)` callback). Strategies have an optional `priority`
  field (lower numbers run first).
- **`useAuthStrategy(strategy)`** / **`removeAuthStrategy(strategy)`** /
  **`clearAuthStrategies()`** — full lifecycle management on the instance.
- Built-in strategies:
  - **`BearerTokenAuth(store, refresh, priority?)`** — attaches
    `Authorization: Bearer <token>` from the store; on 401/403 invokes the
    user-supplied `refresh()` callback exactly once (concurrent calls share a
    single in-flight refresh promise) and replays the request with the new
    token.
  - **`ApiKeyAuth({ headerName? | queryName?, getApiKey, priority? })`** — sends
    the key as either a request header or a URL query parameter (must specify
    exactly one). The constructor validates that arrangement and throws on
    misconfiguration so silent failures cannot occur.
  - **`BasicAuth(username, password, priority?)`** — UTF-8 safe Base64
    encoding (uses `Buffer` in Node, `TextEncoder` + `btoa` in browsers) so
    credentials with non-Latin-1 characters (e.g. `café:p@ss`) work without
    throwing.
  - **`CsrfTokenAuth(headerName, getToken, priority?)`** — attaches a
    user-managed CSRF token to a configurable header on every request.
  - **`OAuth2ClientCredentialsAuth({ tokenURL, clientId, clientSecret, scope?, tokenStore, fetchFn?, priority? })`** —
    Node-only (throws when instantiated in a browser context to prevent
    `client_secret` exposure). Acquires + caches access tokens, refreshes on
    401, dedupes concurrent refresh calls, and computes a TTL-aware buffer
    (`min(60s, ttl/2)`) to avoid premature re-fetch on short-lived tokens.
    Token-endpoint POSTs are routed through `safeFetch` so cross-origin
    redirects from the IdP receive the same credential-stripping protection
    as every other outbound call.
  - **`OAuth2PKCEAuth({ tokenStore, refreshTokenStore?, getAccessToken, refreshWithRefreshToken?, priority? })`** —
    browser-friendly PKCE / authorisation-code grant. Wraps user-supplied
    `getAccessToken` and `refreshWithRefreshToken` callbacks; on a refresh-
    token failure (e.g. `invalid_grant`) the dead refresh token is cleared
    from the store and `acquire()` is invoked as a fallback so consumers
    self-recover instead of deadlocking.

### Added — Token stores

- **`TokenStore`** interface — `getToken()` / `setToken(token)`. Both methods
  may return synchronously or as a `Promise`; the library awaits both.
- **`MemoryTokenStore(initial?)`** — in-memory, synchronous; supports
  `setTokenWithExpiry(token, ttlMs)` for centralised TTL tracking and
  `getAll()` for snapshot debugging.
- **`LocalStorageTokenStore(key?)`** — browser-friendly persistent store with
  full API parity with `MemoryTokenStore`. `setTokenWithExpiry(token, ttlMs)`
  writes the absolute expiry to a sidecar `<key>_expires_at` slot; `getToken()`
  surfaces `null` and lazily cleans up both slots once the timestamp has
  passed. Safe under jsdom and graceful in environments where `localStorage`
  is unavailable or quota-throwing.

### Added — Retries

- Default classifier retries on any `5xx`, `429`, or network error, but only
  for safe methods (`GET`, `HEAD`, `OPTIONS`, `PUT`) when `idempotentOnly`
  is true (the default).
- Default backoff is exponential with jitter (base 200 ms, cap 2000 ms,
  jitter factor 0.7–1.3).
- `Retry-After` headers are honoured (numeric delta-seconds and HTTP-date
  forms; negative or unparseable values clamp to a non-negative floor).
- **Per-call override** via `options.retries` and `options.retry: Partial<RetryConfig>`
  so a single call can opt in to (or out of) retry behaviour without
  mutating the instance.
- **`maxElapsedMs`** — total retry-window budget; exceeding it before the
  next attempt yields a `TimeoutError` with `cause: 'maxElapsedMs exceeded'`.
- **`allowUnsafeRetries`** — opts POST/DELETE into the retry classifier
  (must be combined with `idempotentOnly: false` to take effect).
- **`idempotencyKeyFactory`** — when set, an `Idempotency-Key` header is
  auto-injected on retries of POST and DELETE so consumer-side retry
  middleware on the server side can dedupe.
- **`onRetry`** / **`onComplete`** lifecycle callbacks for observability:
  `{ attempt, delay, method, url, reason: 'status' | 'network', status? }`
  and `{ method, url, status?, ok, attempts, elapsedMs }` respectively.
- **`RetryError`** wraps the underlying cause when a retryable status (5xx,
  429) or network error exhausts the retry budget; non-retryable status
  errors surface the underlying `FetchError` directly.

### Added — Interceptors

- **`RequestInterceptor` / `ResponseInterceptor`** — `{ priority?, handler }`
  shape. Lower `priority` numbers run first.
- `addRequestInterceptor` / `removeRequestInterceptor` / `clearRequestInterceptors`
  and the symmetric response trio.
- An interceptor that returns `false` halts the chain and throws
  `InterceptorAbortError`, which is intentionally **not** retried by the
  retry loop. Returning a new `Request` / `Response` substitutes the value
  for downstream stages.
- Request interceptors run **once per logical call** outside the per-attempt
  timeout window. Auth strategies run **once per attempt** so a token
  refresh during a retry takes effect immediately.

### Added — Pagination

- **Page-based**: `get({ endpoint, page, pageSize, limit?, maxPages?, extractor? })`
  buffers all pages and returns a flat array. The streaming counterpart
  `getIter(…)` yields each page as it arrives.
- **Cursor-based**: pass `cursor`, `cursorParamName`, and either
  `getNextCursor: (response, headers) => string | null` or
  `useLinkHeader: true` (RFC 8288 `Link: <…>; rel="next"` parsing). An
  `extractor: (response) => unknown[]` can adapt non-array payload shapes.
- `paginateIter` / `paginateCursorIter` throw
  `UnsupportedResponseTypeError` when invoked with `responseType !== 'json'`
  (across all branches: page-based, plain cursor, `useLinkHeader`, and
  `getNextCursor`).
- Mid-iteration cancellation is fully supported: passing
  `options.signal` to `getIter(…)` aborts the in-flight page request when
  the caller's `AbortSignal` fires.

### Added — Request deduplication

- Optional concurrent-request deduplication via `dedupe: true` (default
  `false`). Identical safe-method requests issued concurrently share one
  network call; each entry is removed as soon as the underlying request
  settles.
- Custom keying via `dedupeKey: ({ method, url, body? }) => string` for
  consumers whose canonical request shape differs from the default
  `method + url + serialized-body` heuristic.
- POST/DELETE are deliberately excluded from deduplication.

### Added — Error model

All error classes set `this.name` correctly (so APM tools group them
properly) and ship a `toJSON()` for structured logging.

- **`FetchError`** — non-2xx response. Carries `code: 'EHTTP'`, `status`,
  `url`, `headers`, `method`, `attempts`, `elapsedMs`, `requestId` (from
  `X-Request-Id` / `X-RequestId`), and the parsed `data`.
- **`RetryError`** — retries exhausted. Carries `code: 'ERETRY'`,
  `attempts`, `cause` (standard ES2022 `Error.cause`), `method`, `url`,
  `elapsedMs`. `toJSON()` summarises `cause` as `{ name, message }` for
  safe serialisation.
- **`TimeoutError`** — request or retry-window timeout. Carries
  `code: 'ETIMEDOUT'`, `elapsedMs`, optional `cause`. `toJSON()` includes
  the message and elapsed time.
- **`UnsupportedResponseTypeError`** — invalid or unsupported `responseType`.
  Carries `code: 'EUNSUPPORTED_RESPONSE'`, `type`. `toJSON()` includes
  the offending type string.
- **`InterceptorAbortError`** — interceptor returned `false`. Carries
  `code: 'EINTERCEPTOR_ABORT'`. Intentionally separate from generic `Error`
  so the retry loop does not treat it as a transient failure.
- **`AuthAbortError`** — auth strategy returned `false`. Carries
  `code: 'EAUTH_ABORT'`. Same retry-loop semantics as
  `InterceptorAbortError`.

### Added — Cross-origin redirect safety

- All outbound calls go through `safeFetch`, which performs manual redirect
  handling (`redirect: 'manual'`) and **strips** `Authorization`, `Cookie`,
  `Cookie2`, and `Proxy-Authorization` headers on cross-origin hops.
- 303 responses (and 301/302 from non-safe methods) switch to GET and drop
  body-framing headers (`Content-Type`, `Content-Length`,
  `Transfer-Encoding`) before replaying.
- Redirects are bounded at 20 hops to defend against redirect loops.
- The OAuth2 token-endpoint POST in `OAuth2ClientCredentialsAuth` is also
  routed through `safeFetch`.

### Added — Body & response handling

Body types accepted on every mutating method:

- `FormData` — `Content-Type` deferred to the runtime so the multipart
  boundary is set correctly.
- `Blob` — `Content-Type` taken from `blob.type` (case-insensitively, so a
  caller-supplied lowercase `'content-type'` header is preserved).
- `ArrayBuffer` — passed through.
- `URLSearchParams` — emitted as `application/x-www-form-urlencoded`.
- `ReadableStream` — passed through with `duplex: 'half'` automatically
  attached so the request works on Node ≥ 18 / undici-backed `fetch`.
  Streaming bodies are non-replayable; the library logs a warning when
  retries are configured and skips them unless a `bodyFactory` is provided.
- `string` — `text/plain;charset=UTF-8` when no Content-Type is already
  present.
- `JsonValue` (objects, arrays, primitives) — `application/json` with
  `JSON.stringify`-d body. Falsy primitives (`false`, `0`, `''`) are
  encoded correctly (no fall-through to platform `text/plain` coercion).

Response types resolvable via `responseType`:

- `'json'` (default), `'text'`, `'blob'`, `'arrayBuffer'`, `'formData'`,
  `'response'` (raw `Response`), and `'auto'` (sniffs `Content-Type` and
  picks the best candidate).
- `204 No Content`, `205 Reset Content`, and `304 Not Modified` resolve to
  `null` for any `responseType` other than `'response'`.

### Added — Type system

The full public type surface is reachable from the main entry point.
Types live in `src/types/public.ts` and `src/index.ts` re-exports the
barrel directly so the two surfaces cannot drift.

- `FetchEnhConfig`, `RequestOptions`, `RequestParameters`
- `BodyType`, `JsonValue`, `JsonPrimitive`
- `QueryValue`, `QueryPrimitive`, `ResponseType`
- `GetOptions`, `PostOptions`, `PutOptions`, `PatchOptions`, `DeleteOptions`,
  `RawOptions`, `HeadOptions`, `PaginateOptions`, `MutationOptions`
- `RequestInterceptor`, `ResponseInterceptor`
- `AuthStrategy`, `TokenStore`
- `RetryClassifier`, `BackoffStrategy`, `RetryConfig`

`readonly` modifiers are applied across the public type interfaces to
discourage downstream mutation.

### Added — Build & packaging

- Dual CJS + ESM build:
  - `dist/index.js` (CJS) — entry for `require()` and CJS bundlers.
  - `dist/esm/index.js` (ESM) — entry for `import` / native Node ESM.
    Ships with its own `package.json` (`{"type":"module"}`) and
    `.js`-extended import paths courtesy of `scripts/esm-fixup.mjs`.
- `dist/index.d.ts` and `dist/esm/index.d.ts` declaration files for both
  builds.
- Source maps and declaration maps in both builds for debuggable
  production stack traces.
- `package.json` `exports` map orders conditions correctly
  (`types` → `import` → `require` → `default`) so resolvers across the
  TypeScript / Node / bundler ecosystem all pick the right entry point.
- `"sideEffects": false` so bundlers (Vite, esbuild, Rollup, webpack 5+)
  can tree-shake unused exports.
- `engines.node` enforces Node ≥ 20 at install time.
- Zero runtime dependencies. The ~83 kB tarball ships `dist/**`,
  `README.md`, `LICENSE`, `CHANGELOG.md`, and `package.json`.

### Added — Testing & CI

- 245 unit + integration tests across 10 suites; coverage gates at
  93.11% statements / 83.11% branches / 87.20% functions / 95.92% lines
  globally, with per-file floors on `src/index.ts` and
  `src/auth/strategies.ts`.
- CI matrix: Node 20 + 22 on Linux; Node 22 spot-check on Windows and
  macOS. Each job runs `tsc`, `npm test`, `npm run test:coverage`, and
  CJS + ESM artifact behavioural smoke tests against a real
  `http.createServer`.

### Notes for SDK builders

- **Public surface stability.** Every symbol re-exported from `'fetch-enh'`
  is part of the SemVer-stable public API. Internal symbols live in
  `src/core/*.ts` and may move freely between minor versions; do not import
  from `fetch-enh/dist/core/...`.
- **Auth strategies on `raw()`.** `api.raw({ applyMiddleware: true })`
  honours the **full** `AuthStrategy` contract (both halves), so
  token-refresh strategies fire on 401/403 even on the escape-hatch path.
  The default `api.raw(...)` (without `applyMiddleware`) deliberately
  skips all middleware.
- **Retries on POST/DELETE.** `allowUnsafeRetries: true` alone does not
  enable POST/DELETE retries; the default `idempotentOnly: true` acts as a
  global filter. To retry POST/DELETE, set both `idempotentOnly: false`
  and `allowUnsafeRetries: true` (or supply an `idempotencyKeyFactory` and
  set `idempotentOnly: false`).
- **Streaming bodies are non-replayable.** A `ReadableStream` body works
  for one-shot calls, but retries require a `bodyFactory` so the library
  can re-create the stream for each attempt. The library emits a
  `console.warn` when it detects a non-replayable body with `retries > 0`.
- **Timeout scope.** The per-attempt timeout begins at the start of each
  fetch attempt, **before** auth strategies execute. Slow auth strategies
  consume timeout budget; keep them fast or increase `timeout`. Request
  interceptors run **once per logical call** outside the timeout window.
- **Dedup keys are computed pre-interceptor.** If your interceptors add
  unique headers or rewrite the URL, two semantically different requests
  may collapse into one in-flight call. Disable `dedupe` or supply a
  custom `dedupeKey` in that case.

### Runtime requirements

- **Node.js ≥ 20** (`engines.node` enforced).
- **Browsers**: any modern browser with `fetch`, `AbortController`,
  `AbortSignal.any` (Chrome 116+, Firefox 124+, Safari 17.4+),
  `URL`, `Headers`, `FormData`, and `Blob`. Older targets must polyfill
  the missing primitives.

### Acknowledgments

Pre-`1.0.0` development included multiple iterative review and fix waves
covering critical, high, medium, and low-severity issues across the core
fetch loop, auth pipeline, retry engine, pagination, deduplication,
interceptor pipeline, error model, build configuration, and packaging.
The cumulative outcome — including a SOLID-principles refactor that
decomposed an early monolithic module into eight focused modules under
`src/core/`, cross-origin credential stripping on redirects, deadlock-free
PKCE refresh recovery, full type-system rigor across primitive bodies and
JSON encoding, and `duplex: 'half'` propagation for `ReadableStream`
bodies — is captured here as the canonical first set of release notes.

[Unreleased]: https://github.com/erelsop/fetch-enh/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/erelsop/fetch-enh/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/erelsop/fetch-enh/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/erelsop/fetch-enh/releases/tag/v1.0.0
