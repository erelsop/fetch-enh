# FetchEnh Examples

This directory contains practical examples demonstrating various features and use cases of FetchEnh.

## Examples Overview

### 01-basic-usage.ts
Basic HTTP operations and core functionality:
- GET, POST, PUT, PATCH, DELETE requests
- Query parameters
- Custom headers
- Different response types
- Request configuration

### 02-authentication.ts
Authentication strategies and token management:
- Bearer Token Authentication with auto-refresh
- API Key Authentication (header and query param)
- Basic Authentication
- CSRF Token Authentication
- Multiple authentication strategies
- Persistent token storage (LocalStorage)
- Custom token stores

### 03-retry-configuration.ts
Advanced retry logic and backoff strategies:
- Default retry behavior
- Custom retry classifiers
- Exponential backoff with jitter
- Retry-After header support
- Non-idempotent method retries
- Per-request retry overrides
- Circuit breaker pattern

### 04-interceptors-and-errors.ts
Request/Response interceptors and error handling:
- Logging interceptors
- Adding timestamps
- Analytics and monitoring
- Response transformation
- Error handling patterns
- Global error handlers
- Retry with custom messages
- Request/Response caching

## Running the Examples

### Prerequisites

Ensure you have built the project:

```bash
cd /path/to/FetchEnh
npm install
npm run build
```

### TypeScript

To run the TypeScript examples directly:

```bash
# Install ts-node if not already installed
npm install -g ts-node

# Run an example
ts-node examples/01-basic-usage.ts
```

### JavaScript

Compile to JavaScript first:

```bash
tsc examples/*.ts --outDir examples/compiled
node examples/compiled/01-basic-usage.js
```

## Common Patterns

### Creating an API Client

```typescript
import FetchEnh from 'fetch-enh';

const api = new FetchEnh({
  baseURL: 'https://api.example.com',
  defaultHeaders: {
    'Content-Type': 'application/json',
    'X-Client-Version': '1.0.0'
  },
  defaultTimeout: 10000,
  defaultRetries: 3
});
```

### Making Requests

```typescript
// GET
const users = await api.get({ endpoint: '/users' });

// POST
const newUser = await api.post({
  endpoint: '/users',
  body: { name: 'John', email: 'john@example.com' }
});

// PUT
const updated = await api.put({
  endpoint: '/users/1',
  body: { name: 'Jane' }
});

// DELETE
await api.delete({ endpoint: '/users/1' });
```

### Adding Authentication

```typescript
import { BearerTokenAuth, MemoryTokenStore } from 'fetch-enh';

const tokenStore = new MemoryTokenStore('your-token');
api.useAuthStrategy(new BearerTokenAuth(
  tokenStore,
  async () => {
    // Token refresh logic
    const newToken = await refreshToken();
    return newToken;
  }
));
```

### Error Handling

```typescript
import { FetchError, TimeoutError } from 'fetch-enh';

try {
  const data = await api.get({ endpoint: '/data' });
} catch (error) {
  if (error instanceof FetchError) {
    console.error('HTTP Error:', error.response.status, error.data);
  } else if (error instanceof TimeoutError) {
    console.error('Request timed out');
  }
}
```

## Tips

1. **Use interceptors for cross-cutting concerns** like logging, analytics, and authentication
2. **Configure retry logic** based on your API's behavior and requirements
3. **Handle errors appropriately** using the typed error classes
4. **Leverage TypeScript** for better type safety and autocomplete
5. **Test your integration** with the comprehensive test utilities

## More Information

- [Main README](../README.md)
- [API Documentation](../README.md#-api-documentation)
- [GitHub Repository](https://github.com/erelsop/FetchEnh)
