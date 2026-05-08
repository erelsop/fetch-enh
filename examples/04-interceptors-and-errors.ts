/**
 * Interceptors and Error Handling Examples
 * 
 * Demonstrates request/response interceptors and error handling patterns.
 */

import FetchEnh from '@erelsop/fetch-enh';
import { FetchError, TimeoutError } from '@erelsop/fetch-enh';

// Example 1: Logging Interceptor
async function loggingInterceptorExample() {
  console.log('=== Logging Interceptor ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });

  // Request logging
  api.addRequestInterceptor({
    priority: 1,
    handler: async (request) => {
      console.log(`→ ${request.method} ${request.url}`);
      console.log('  Headers:', Object.fromEntries(request.headers.entries()));
      return request;
    }
  });

  // Response logging
  api.addResponseInterceptor({
    priority: 1,
    handler: async (response) => {
      console.log(`← ${response.status} ${response.statusText}`);
      return response;
    }
  });

  try {
    await api.get({ endpoint: '/users/1' });
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 2: Adding Timestamps
async function timestampInterceptorExample() {
  console.log('\n=== Timestamp Interceptor ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });

  let requestStart: number;

  api.addRequestInterceptor({
    handler: async (request) => {
      requestStart = Date.now();
      const headers = new Headers(request.headers);
      headers.set('X-Request-Time', requestStart.toString());
      return new Request(request, { headers });
    }
  });

  api.addResponseInterceptor({
    handler: async (response) => {
      const duration = Date.now() - requestStart;
      console.log(`Request completed in ${duration}ms`);
      return response;
    }
  });

  try {
    await api.get({ endpoint: '/users' });
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 3: Analytics and Monitoring
class AnalyticsTracker {
  trackRequest(method: string, url: string): void {
    console.log(`[Analytics] Request: ${method} ${url}`);
  }

  trackResponse(status: number, duration: number): void {
    console.log(`[Analytics] Response: ${status} (${duration}ms)`);
  }

  trackError(error: any): void {
    console.log(`[Analytics] Error: ${error.message}`);
  }
}

async function analyticsInterceptorExample() {
  console.log('\n=== Analytics Interceptor ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });
  const analytics = new AnalyticsTracker();
  let startTime: number;

  api.addRequestInterceptor({
    handler: async (request) => {
      startTime = Date.now();
      analytics.trackRequest(request.method, request.url);
      return request;
    }
  });

  api.addResponseInterceptor({
    handler: async (response) => {
      const duration = Date.now() - startTime;
      analytics.trackResponse(response.status, duration);
      return response;
    }
  });

  try {
    await api.get({ endpoint: '/users/1' });
    await api.post({ endpoint: '/posts', body: { title: 'Test' } });
  } catch (error) {
    analytics.trackError(error);
  }
}

// Example 4: Response Transformation
async function transformInterceptorExample() {
  console.log('\n=== Response Transformation ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });

  api.addResponseInterceptor({
    handler: async (response) => {
      // Add metadata to all responses
      if (response.ok) {
        const data = await response.json();
        const enhanced = {
          ...data,
          _metadata: {
            timestamp: new Date().toISOString(),
            cached: false,
            version: '1.0'
          }
        };
        
        // Clone headers and drop Content-Length — the new body is a different
        // size, so propagating the original header would be stale.
        const responseHeaders = new Headers(response.headers);
        responseHeaders.delete('content-length');
        return new Response(JSON.stringify(enhanced), {
          status: response.status,
          headers: responseHeaders,
        });
      }
      
      return response;
    }
  });

  try {
    const user = await api.get({ endpoint: '/users/1' });
    console.log('Enhanced response:', user);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 5: Error Handling
async function errorHandlingExample() {
  console.log('\n=== Error Handling ===\n');
  
  const api = new FetchEnh({ 
    baseURL: 'https://jsonplaceholder.typicode.com',
    defaultRetries: 0
  });

  try {
    // 404 error
    await api.get({ endpoint: '/users/9999999' });
  } catch (error) {
    if (error instanceof FetchError) {
      console.log('FetchError caught:');
      console.log('  Status:', error.response.status);
      console.log('  Data:', error.data);
    }
  }

  try {
    // Timeout error
    await api.get({ 
      endpoint: '/users',
      options: { timeout: 1 }  // 1ms timeout
    });
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.log('\nTimeoutError caught');
    }
  }
}

// Example 6: Global Error Handler Interceptor
class ErrorHandler {
  handle(error: any, request: Request): void {
    if (error instanceof FetchError) {
      if (error.response.status === 401) {
        console.log('[ErrorHandler] Unauthorized - redirect to login');
        // window.location.href = '/login';
      } else if (error.response.status === 403) {
        console.log('[ErrorHandler] Forbidden - show permission error');
      } else if (error.response.status >= 500) {
        console.log('[ErrorHandler] Server error - show maintenance page');
      }
    } else if (error instanceof TimeoutError) {
      console.log('[ErrorHandler] Timeout - show retry option');
    } else {
      console.log('[ErrorHandler] Unknown error:', error.message);
    }
  }
}

async function globalErrorHandlerExample() {
  console.log('\n=== Global Error Handler ===\n');
  
  const api = new FetchEnh({ 
    baseURL: 'https://jsonplaceholder.typicode.com',
    defaultRetries: 0
  });
  
  const errorHandler = new ErrorHandler();

  // Wrap requests to catch and handle errors globally
  const makeRequest = async (fn: () => Promise<any>) => {
    try {
      return await fn();
    } catch (error: any) {
      errorHandler.handle(error, error.request || {});
      throw error;  // Re-throw if needed
    }
  };

  await makeRequest(() => api.get({ endpoint: '/users/9999999' }));
}

// Example 7: Retry with Custom Error Messages
async function retryWithMessagesExample() {
  console.log('\n=== Retry with Messages ===\n');
  
  const api = new FetchEnh({ 
    baseURL: 'https://jsonplaceholder.typicode.com',
    defaultRetries: 3
  });

  let retryCount = 0;

  api.addRequestInterceptor({
    handler: async (request) => {
      if (retryCount > 0) {
        console.log(`Retry attempt #${retryCount}`);
      }
      retryCount++;
      return request;
    }
  });

  api.addResponseInterceptor({
    handler: async (response) => {
      if (!response.ok) {
        console.log(`Request failed with status ${response.status}`);
      } else {
        console.log('Request succeeded');
        retryCount = 0;
      }
      return response;
    }
  });

  try {
    await api.get({ endpoint: '/users/1' });
  } catch (error) {
    console.error('All retries failed');
  }
}

// Example 8: Request/Response Caching
class SimpleCache {
  private cache = new Map<string, { data: any; timestamp: number }>();
  private ttl = 60000; // 1 minute

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  set(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

async function cachingInterceptorExample() {
  console.log('\n=== Caching Interceptor ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });
  const cache = new SimpleCache();

  api.addRequestInterceptor({
    handler: async (request) => {
      if (request.method === 'GET') {
        const cached = cache.get(request.url);
        if (cached) {
          console.log('Cache hit:', request.url);
          // Return cached response (would need to create Response object)
        }
      }
      return request;
    }
  });

  api.addResponseInterceptor({
    handler: async (response) => {
      if (response.ok && response.url) {
        const data = await response.clone().json();
        cache.set(response.url, data);
        console.log('Cached response for:', response.url);
      }
      return response;
    }
  });

  try {
    console.log('First request:');
    await api.get({ endpoint: '/users/1' });
    
    console.log('\nSecond request (should use cache):');
    await api.get({ endpoint: '/users/1' });
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run examples
(async () => {
  await loggingInterceptorExample();
  await timestampInterceptorExample();
  await analyticsInterceptorExample();
  await transformInterceptorExample();
  await errorHandlingExample();
  await globalErrorHandlerExample();
  await retryWithMessagesExample();
  await cachingInterceptorExample();
})();
