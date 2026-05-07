/**
 * Manages in-flight request deduplication.
 * Only safe (read-only) HTTP methods are deduplicated by default.
 * Users can opt in to mutation-deduplication by providing a custom dedupeKey factory.
 */
export class DeduplicationCache {
  private _inflight: Map<string, Promise<unknown>> = new Map();

  /** The set of HTTP methods considered safe for automatic deduplication. */
  private static readonly SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  /**
   * Computes a deduplication key for the given request parameters.
   */
  computeKey(
    method: string,
    url: string,
    body: string | undefined,
    customKeyFn?: (params: { method: string; url: string; body?: unknown }) => string
  ): string {
    if (customKeyFn) {
      return customKeyFn({ method, url, body });
    }
    return `${method} ${url} ${body ?? ''}`;
  }

  /**
   * Determines whether a request should be deduplicated.
   * Only safe methods are deduplicated unless a custom dedupeKey factory is provided.
   */
  shouldDedupe(
    dedupeEnabled: boolean,
    method: string,
    hasCustomKeyFn: boolean
  ): boolean {
    return dedupeEnabled && (DeduplicationCache.SAFE_METHODS.has(method) || hasCustomKeyFn);
  }

  /**
   * Returns the existing in-flight promise for the given key, or undefined.
   */
  getExisting<T>(key: string): Promise<T> | undefined {
    return this._inflight.get(key) as Promise<T> | undefined;
  }

  /**
   * Registers a promise for the given dedup key and auto-removes it on completion.
   *
   * Uses `.then(cleanup, cleanup)` instead of `.finally(cleanup)` to avoid
   * creating a discarded chained promise that inherits the rejection without a
   * handler. Under Node ≥15 `--unhandled-rejections=throw` semantics, a
   * `.finally()` chain on a rejected promise fires `unhandledRejection` and
   * terminates the process even when the caller's copy of the promise is
   * properly awaited and caught.
   */
  track<T>(key: string, promise: Promise<T>): void {
    this._inflight.set(key, promise);
    promise.then(
      () => { this._inflight.delete(key); },
      () => { this._inflight.delete(key); },
    );
  }

  /**
   * Serializes a body value for use in dedup key computation.
   */
  static serializeBodyForKey(body: unknown): string | undefined {
    if (body !== null && body !== undefined && typeof body === 'object' &&
      !(body instanceof FormData) && !(body instanceof Blob) &&
      !(body instanceof ArrayBuffer) && !(body instanceof URLSearchParams)) {
      return JSON.stringify(body);
    }
    if (typeof body === 'string') return body;
    return undefined;
  }
}
