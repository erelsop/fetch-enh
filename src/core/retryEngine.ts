import type { RetryClassifier, BackoffStrategy, RetryConfig } from '../types/retry';
import type { BodyType } from '../types/requestParameters';
import type { RetryContext } from './bodyUtils';

const MAX_RETRY_AFTER_MS = 60000;

/**
 * Determines whether the given response status is retryable by default.
 * Server errors (5xx) and 429 Too Many Requests are considered retryable.
 */
export function defaultShouldRetryResponse(response: Response): boolean {
  return (response.status >= 500 && response.status < 600) || response.status === 429;
}

/**
 * Computes the delay (in milliseconds) before the next retry attempt.
 *
 * Resolution order:
 * 1. If `respectRetryAfter` is enabled and the response contains a valid
 *    `Retry-After` header, its value is used (capped at {@link MAX_RETRY_AFTER_MS}).
 * 2. Otherwise an exponential back-off with jitter is applied:
 *    base 200 ms, cap 2 000 ms, jitter factor 0.7–1.3.
 */
export function defaultBackoffDelay(
  attempt: number,
  retryConfig: RetryConfig,
  response?: Response
): number {
  if (retryConfig.respectRetryAfter && response) {
    const ra = response.headers.get('retry-after');
    if (ra) {
      const seconds = Number(ra);
      if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
      const dateMs = Date.parse(ra);
      if (!Number.isNaN(dateMs)) {
        const diff = dateMs - Date.now();
        if (diff > 0) return Math.min(diff, MAX_RETRY_AFTER_MS);
      }
    }
  }
  const base = 200;
  const cap = 2000;
  const exp = Math.min(base * Math.pow(2, attempt - 1), cap);
  const jitterFactor = 0.7 + Math.random() * 0.6;
  return Math.floor(exp * jitterFactor);
}

/**
 * Returns a promise that resolves after {@link ms} milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Reconstructs a {@link Request} for a retry attempt.
 *
 * For `POST` and `DELETE` methods, an `Idempotency-Key` header is attached
 * (via the configured factory) when one is not already present.  For all
 * other methods the original request is returned unchanged.
 */
export function buildRetryRequest(
  request: Request,
  method: string,
  retryConfig: RetryConfig,
  _retryCtx?: RetryContext
): Request {
  const needIdem = retryConfig.idempotencyKeyFactory && ['POST', 'DELETE'].includes(method);
  if (!needIdem) return request;
  const headersObj = new Headers(request.headers);
  if (!headersObj.has('Idempotency-Key')) {
    headersObj.set('Idempotency-Key', retryConfig.idempotencyKeyFactory!());
  }
  return new Request(request.url, { method: request.method, headers: headersObj });
}

/**
 * Determines whether a retry is permitted given the HTTP method, retry
 * configuration, and body replayability.
 *
 * A retry is allowed when **all** of the following hold:
 * - The method is idempotent, **or** `idempotentOnly` is disabled.
 * - The method is safe (not POST/DELETE), **or** unsafe retries are
 *   explicitly allowed, **or** an idempotency-key factory is configured.
 * - The request body is replayable, **or** a `bodyFactory` is available.
 */
export function isRetryAllowed(
  method: string,
  retryConfig: RetryConfig,
  retryCtx?: RetryContext
): boolean {
  const idempotent = ['GET', 'HEAD', 'OPTIONS', 'PUT'].includes(method);
  const allowRetryBase = !retryConfig.idempotentOnly || idempotent;
  const unsafeMethod = ['POST', 'DELETE'].includes(method);
  const canRetryUnsafe = !unsafeMethod || retryConfig.allowUnsafeRetries || !!retryConfig.idempotencyKeyFactory;
  const bodyReplayable = retryCtx?.bodyReplayable !== false || !!retryCtx?.bodyFactory;
  return allowRetryBase && canRetryUnsafe && bodyReplayable;
}

/**
 * Chooses between a custom {@link BackoffStrategy} and the built-in
 * {@link defaultBackoffDelay} to compute the delay before the next retry.
 */
export function computeDelay(
  attempt: number,
  retryConfig: RetryConfig,
  backoffStrategy: BackoffStrategy | null,
  response?: Response,
  error?: unknown
): number {
  if (backoffStrategy) {
    return backoffStrategy.computeDelay({ attempt, response, error });
  }
  return defaultBackoffDelay(attempt, retryConfig, response);
}

/**
 * Determines whether a response should trigger a retry.
 *
 * When a custom {@link RetryClassifier} is provided it is consulted;
 * otherwise {@link defaultShouldRetryResponse} is used.
 */
export function classifyRetry(
  response: Response,
  method: string,
  attempt: number,
  classifier: RetryClassifier | null
): boolean {
  if (classifier) {
    return classifier.shouldRetry({ response, method, attempt });
  }
  return defaultShouldRetryResponse(response);
}
