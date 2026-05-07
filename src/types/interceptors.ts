export interface RequestInterceptor {
  readonly handler: (
    request: Request,
    /**
     * @deprecated `next` is a no-op kept for API compatibility — calling it
     * returns `undefined`, so any Request mutations made before the call will
     * be silently discarded. Return the mutated Request directly instead.
     *
     * @example
     * // ✗ Anti-pattern: mutations built before next() are dropped
     * handler: async (req, next) => {
     *   const h = new Headers(req.headers);
     *   h.set('Authorization', 'Bearer ' + token);
     *   const newReq = new Request(req, { headers: h });
     *   return await next(); // returns undefined → newReq is discarded
     * }
     *
     * // ✓ Correct pattern: return the mutated Request directly
     * handler: (req) => {
     *   const h = new Headers(req.headers);
     *   h.set('Authorization', 'Bearer ' + token);
     *   return new Request(req, { headers: h });
     * }
     */
    next?: () => Promise<void>,
  ) => Request | boolean | void | Promise<Request | boolean | void>;
  readonly priority?: number;
}

export interface ResponseInterceptor {
  readonly handler: (
    response: Response,
    /**
     * @deprecated `next` is a no-op kept for API compatibility — calling it
     * returns `undefined`, so any Response mutations made before the call will
     * be silently discarded. Return the mutated Response directly instead.
     *
     * @example
     * // ✗ Anti-pattern: mutations built before next() are dropped
     * handler: async (res, next) => {
     *   const data = await res.json();
     *   const enhanced = new Response(JSON.stringify({ ...data, ts: Date.now() }), { status: res.status });
     *   return await next(); // returns undefined → enhanced is discarded
     * }
     *
     * // ✓ Correct pattern: return the mutated Response directly
     * handler: async (res) => {
     *   const data = await res.json();
     *   return new Response(JSON.stringify({ ...data, ts: Date.now() }), { status: res.status });
     * }
     */
    next?: () => Promise<void>,
  ) => Response | boolean | void | Promise<Response | boolean | void>;
  readonly priority?: number;
}
