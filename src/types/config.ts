export interface FetchEnhConfig {
  readonly baseURL?: string;
  readonly defaultHeaders?: Record<string, string>;
  readonly defaultTimeout?: number;
  readonly defaultRetries?: number;
  readonly queryStyle?: {
    readonly array?: 'brackets' | 'repeat' | 'comma';
    readonly object?: 'brackets' | 'dot';
  };
  readonly dedupe?: boolean;
  readonly dedupeKey?: (params: { method: string; url: string; body?: unknown }) => string;
  /**
   * Maximum number of logical requests allowed in flight at once. Applied once
   * per logical request (not per retry attempt), so a request waiting out a
   * retry backoff does not occupy a slot. Omit for unlimited concurrency.
   */
  readonly concurrency?: number;
  /**
   * Maximum requests started per second, enforced as a minimum spacing between
   * request starts (`1000 / maxRps` ms). Useful for staying under an API's rate
   * limit on long paginated pulls. Ignored if `minIntervalMs` is also set.
   */
  readonly maxRps?: number;
  /**
   * Minimum spacing (ms) between successive request starts. Takes precedence
   * over `maxRps`. Omit for no spacing.
   */
  readonly minIntervalMs?: number;
  readonly onRetry?: (info: { attempt: number; delay: number; method: string; url: string; reason: 'status' | 'network'; status?: number }) => void;
  readonly onComplete?: (info: { method: string; url: string; status?: number; ok: boolean; attempts: number; elapsedMs: number }) => void;
}
