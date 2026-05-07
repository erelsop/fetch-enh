/**
 * Retry Configuration Examples
 * 
 * Demonstrates advanced retry logic and backoff strategies.
 */

import FetchEnh from 'fetch-enh';
import type { RetryClassifier, BackoffStrategy } from 'fetch-enh';

// Example 1: Default Retry Behavior
async function defaultRetryExample() {
  console.log('=== Default Retry Behavior ===\n');
  
  const api = new FetchEnh({
    baseURL: 'https://jsonplaceholder.typicode.com',
    defaultRetries: 3
  });

  try {
    // Automatically retries on:
    // - 5xx errors (500-599)
    // - 429 (Too Many Requests)
    // - Network errors
    // - Only for idempotent methods (GET, HEAD, OPTIONS, PUT)
    const data = await api.get({ endpoint: '/posts/1' });
    console.log('Data:', data);
  } catch (error) {
    console.error('Failed after retries:', error);
  }
}

// Example 2: Custom Retry Classifier
async function customRetryClassifierExample() {
  console.log('\n=== Custom Retry Classifier ===\n');
  
  const api = new FetchEnh({
    baseURL: 'https://jsonplaceholder.typicode.com',
    defaultRetries: 5
  });

  // Custom retry logic
  const customClassifier: RetryClassifier = {
    shouldRetry: ({ response, error, method, attempt }) => {
      console.log(`Retry attempt ${attempt} for ${method}`);
      
      // Retry on specific status codes
      if (response) {
        if (response.status === 429) return true;  // Rate limited
        if (response.status === 503) return true;  // Service unavailable
        if (response.status >= 500) return true;    // Server errors
      }
      
      // Retry on network errors
      if (error) {
        console.log('Network error, retrying...');
        return true;
      }
      
      return false;
    }
  };

  const customBackoff: BackoffStrategy = {
    computeDelay: ({ attempt, response }) => {
      // Linear backoff: 1s, 2s, 3s, 4s, 5s
      return attempt * 1000;
    }
  };

  api.setRetryBehavior(customClassifier, customBackoff);

  try {
    const data = await api.get({ endpoint: '/posts/1' });
    console.log('Data:', data);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Example 3: Exponential Backoff with Jitter
async function exponentialBackoffExample() {
  console.log('\n=== Exponential Backoff with Jitter ===\n');
  
  const api = new FetchEnh({
    baseURL: 'https://jsonplaceholder.typicode.com',
    defaultRetries: 5
  });

  const classifier: RetryClassifier = {
    shouldRetry: ({ response }) => {
      return response ? response.status >= 500 || response.status === 429 : false;
    }
  };

  const backoff: BackoffStrategy = {
    computeDelay: ({ attempt }) => {
      // Exponential backoff: 2^attempt * 100ms with jitter
      const exponentialDelay = Math.pow(2, attempt) * 100;
      const maxDelay = 10000; // Cap at 10 seconds
      const baseDelay = Math.min(exponentialDelay, maxDelay);
      
      // Add jitter (±30%)
      const jitter = baseDelay * 0.3 * (Math.random() * 2 - 1);
      const finalDelay = Math.max(0, baseDelay + jitter);
      
      console.log(`Attempt ${attempt}: waiting ${finalDelay.toFixed(0)}ms`);
      return finalDelay;
    }
  };

  api.setRetryBehavior(classifier, backoff);

  try {
    const data = await api.get({ endpoint: '/posts/1' });
    console.log('Data:', data);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Example 4: Respecting Retry-After Header
async function retryAfterExample() {
  console.log('\n=== Retry-After Header Support ===\n');
  
  const api = new FetchEnh({
    baseURL: 'https://jsonplaceholder.typicode.com',
    defaultRetries: 3
  });

  const classifier: RetryClassifier = {
    shouldRetry: ({ response }) => {
      return response ? response.status === 429 || response.status === 503 : false;
    }
  };

  const backoff: BackoffStrategy = {
    computeDelay: ({ attempt, response }) => {
      // Check for Retry-After header
      if (response) {
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!isNaN(seconds)) {
            console.log(`Server says retry after ${seconds} seconds`);
            return seconds * 1000;
          }
        }
      }
      
      // Default exponential backoff
      return Math.min(1000 * Math.pow(2, attempt - 1), 10000);
    }
  };

  api.setRetryBehavior(
    classifier,
    backoff,
    {
      respectRetryAfter: true,  // Enable Retry-After header support
      idempotentOnly: true,
      maxElapsedMs: 60000  // Stop after 60 seconds total
    }
  );

  try {
    const data = await api.get({ endpoint: '/posts/1' });
    console.log('Data:', data);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Example 5: Allow Retries for Non-Idempotent Methods
async function nonIdempotentRetryExample() {
  console.log('\n=== Retries for POST Requests ===\n');
  
  const api = new FetchEnh({
    baseURL: 'https://jsonplaceholder.typicode.com',
    defaultRetries: 3
  });

  api.setRetryBehavior(
    {
      shouldRetry: ({ response, error }) => {
        // Retry on network errors or 5xx
        if (error) return true;
        return response ? response.status >= 500 : false;
      }
    },
    {
      computeDelay: ({ attempt }) => attempt * 500
    },
    {
      idempotentOnly: false,  // Allow retries for POST, etc.
      maxElapsedMs: 30000
    }
  );

  try {
    // POST will now retry on failures
    const result = await api.post({
      endpoint: '/posts',
      body: { title: 'Important', body: 'content', userId: 1 }
    });
    console.log('Result:', result);
  } catch (error) {
    console.error('Request failed after retries:', error);
  }
}

// Example 6: Per-Request Retry Override
async function perRequestRetryExample() {
  console.log('\n=== Per-Request Retry Override ===\n');
  
  const api = new FetchEnh({
    baseURL: 'https://jsonplaceholder.typicode.com',
    defaultRetries: 3
  });

  try {
    // Override retries for this specific request
    const criticalData = await api.get({
      endpoint: '/posts/1',
      options: {
        retries: 10,  // Try 10 times instead of default 3
        timeout: 5000
      }
    });
    console.log('Critical data:', criticalData);

    // No retries for this request
    const cachedData = await api.get({
      endpoint: '/posts/2',
      options: {
        retries: 0  // Don't retry this one
      }
    });
    console.log('Cached data:', cachedData);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Example 7: Circuit Breaker Pattern
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private readonly threshold = 5;
  private readonly resetTime = 60000; // 1 minute

  shouldAttempt(): boolean {
    if (this.failures >= this.threshold) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed < this.resetTime) {
        console.log('Circuit breaker open, rejecting request');
        return false;
      }
      // Reset after timeout
      this.failures = 0;
    }
    return true;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    console.log(`Circuit breaker failure count: ${this.failures}`);
  }

  recordSuccess(): void {
    this.failures = 0;
    console.log('Circuit breaker reset');
  }
}

async function circuitBreakerExample() {
  console.log('\n=== Circuit Breaker Pattern ===\n');
  
  const api = new FetchEnh({
    baseURL: 'https://jsonplaceholder.typicode.com',
    defaultRetries: 2
  });

  const breaker = new CircuitBreaker();

  const classifier: RetryClassifier = {
    shouldRetry: ({ response, error }) => {
      if (!breaker.shouldAttempt()) {
        return false;  // Circuit is open
      }
      
      if (error || (response && response.status >= 500)) {
        breaker.recordFailure();
        return true;
      }
      
      return false;
    }
  };

  api.setRetryBehavior(
    classifier,
    { computeDelay: ({ attempt }) => attempt * 1000 }
  );

  // Add response interceptor to record successes
  api.addResponseInterceptor({
    handler: async (response) => {
      if (response.ok) {
        breaker.recordSuccess();
      }
      return response;
    }
  });

  try {
    const data = await api.get({ endpoint: '/posts/1' });
    console.log('Data:', data);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Run examples
(async () => {
  await defaultRetryExample();
  await customRetryClassifierExample();
  await exponentialBackoffExample();
  await retryAfterExample();
  await nonIdempotentRetryExample();
  await perRequestRetryExample();
  await circuitBreakerExample();
})();
