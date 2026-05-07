# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **R-1** — `RequestInterceptor.handler` and `ResponseInterceptor.handler` type signatures: `next` parameter is now optional and marked `@deprecated` with JSDoc examples showing the correct mutate-and-return pattern. Prevents the silent data-loss footgun where a handler returning `await next()` (resolves to `undefined`) silently discards all Request/Response mutations.
- **R-3** — README "Dedup cache bounds" callout no longer references `.finally()` (which was replaced by `.then(cleanup, cleanup)` in the Q-1 fix). Updated to implementation-agnostic wording: "removed as soon as the underlying request settles (success or failure)".
- **R-5b** — `transformInterceptorExample` in `examples/04-interceptors-and-errors.ts` now clones the response `Headers` and deletes `content-length` before constructing the new `Response`, avoiding propagation of a stale `Content-Length` from the original upstream response.
- **R-6** — `examples/02-authentication.ts`, `examples/03-retry-configuration.ts`, and `examples/05-new-features.ts` (the `complexGenericExample` function): replaced all `https://api.example.com` placeholder URLs with `https://jsonplaceholder.typicode.com` and updated endpoints to real jsonplaceholder resources. Examples now run end-to-end without DNS errors.

### Changed

- **R-7** — `MemoryTokenStore.setTokenWithExpiry` JSDoc: removed the misleading claim "centralises expiry tracking so auth strategies do not need to maintain their own `expiresAt` timestamps" (the built-in OAuth2 strategies maintain their own `expiresAt` fields). Replaced with accurate description of the method's actual use-case.
- **R-5** — README Retries section `setRetryBehavior` example block now documents that passing `null` for `classifier` and/or `backoff` reverts those components to built-in defaults (advertising the Q-7 type fix to users who read only the docs).

### Tests

- **R-2** — `tests/fetchEnh.core.test.ts` interceptor composition tests (`multiple request interceptors compose mutations`, `multiple response interceptors compose transformations`, `remove and clear interceptors`): removed deprecated `await next()` patterns; handlers now use the correct mutate-and-return style.
- **R-2** — Added regression pin `handler returning await next() silently drops its Request mutation (anti-pattern pin)` to `fetchEnh.core.test.ts`. Documents the forward-pipeline silent-drop behaviour so any future semantic change is immediately visible.
- **R-4** — Added `setRetryBehavior(null, null) reverts both classifier and backoff to built-in defaults` to `tests/fetchEnh.critical.test.ts`, covering the code path widened by the Q-7 type fix.

---

[Unreleased]: https://github.com/erelsop/FetchEnh/compare/HEAD...HEAD
