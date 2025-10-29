# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [1.0.0-rc.1] - 2025-10-28

### Added
- OAuth2 authentication strategies:
  - OAuth2ClientCredentialsAuth for Node (client credentials grant)
  - OAuth2PKCEAuth for browser (authorization code + PKCE via user-provided functions)
- Hooks: onRetry and onComplete metrics
- Request deduping option
- Cursor pagination via Link headers
- Query serialization styles (arrays: brackets/repeat/comma; objects: brackets/dot)
- Expanded error model (code, status, method, url, attempts, elapsedMs, requestId; toJSON)

### Changed
- Interceptor composition (onion model) and clarified behavior
- Retry + body replayability with bodyFactory and idempotency key support

### Removed
- CI references; upload progress is explicitly deferred

---

[1.0.0-rc.1]: https://github.com/erelsop/FetchEnh/releases/tag/v1.0.0-rc.1
