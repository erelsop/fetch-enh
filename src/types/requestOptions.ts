import type { RetryConfig } from './retry';

export interface RequestOptions {
  timeout?: number;
  retries?: number;
  signal?: AbortSignal;
  /**
   * Per-request retry configuration.  Keys supplied here are merged over the
   * instance-level retry config set via `setRetryConfig()` / `setRetryBehavior()`,
   * so you only need to specify the fields you want to override.
   *
   * @example
   * // Allow this one POST to retry even though the default config is idempotent-only
   * api.post({ endpoint: '/jobs', body: payload, options: { retries: 3, retry: { idempotentOnly: false, allowUnsafeRetries: true } } });
   */
  retry?: Partial<RetryConfig>;
}
