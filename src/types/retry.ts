export interface RetryClassifier {
  shouldRetry(params: {
    error?: unknown;
    response?: Response;
    method: string;
    attempt: number; // 1-based
  }): boolean;
}

export interface BackoffStrategy {
  computeDelay(params: {
    attempt: number; // 1-based
    response?: Response;
    error?: unknown;
  }): number; // milliseconds
}

export interface RetryConfig {
  readonly idempotentOnly?: boolean; // default true
  readonly maxElapsedMs?: number; // total retry window cap
  readonly respectRetryAfter?: boolean; // consider Retry-After header (429/503)
  readonly allowUnsafeRetries?: boolean; // allow retries for POST/DELETE when true or when idempotencyKeyFactory present
  readonly idempotencyKeyFactory?: () => string; // generate Idempotency-Key header on retry
}



