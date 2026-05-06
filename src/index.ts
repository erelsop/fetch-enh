import {
  FetchError,
  UnsupportedResponseTypeError,
  TimeoutError,
  RetryError,
  InterceptorAbortError,
  AuthAbortError,
} from './errors/fetchErrors';
import type { FetchEnhConfig } from './types/config';
import type { RequestParameters, BodyType } from './types/requestParameters';
import type { RequestOptions } from './types/requestOptions';
import type {
  GetOptions,
  PostOptions,
  PutOptions,
  PatchOptions,
  DeleteOptions,
  RawOptions,
  HeadOptions,
  PaginateOptions,
} from './types/httpMethodOptions';
import type {
  RequestInterceptor,
  ResponseInterceptor,
} from './types/interceptors';
import type { RetryClassifier, BackoffStrategy, RetryConfig } from './types/retry';
import type { AuthStrategy } from './types/auth';
/**
 * FetchEnh is a utility class designed to streamline fetch requests.
 * Provides built-in support for handling common tasks like setting up base URLs,
 * managing default headers, setting request timeouts, retrying failed requests,
 * and handling various response types.
 *
 * With this helper, developers can make more structured and error-resistant
 * API calls with less repetitive code.
 *
 * @param {string} [baseURL=''] - Base URL to prepend to endpoints.
 * @param {Object} [defaultHeaders={}] - Default headers for requests.
 * @param {number} [defaultTimeout=0] - Default timeout for requests in milliseconds.
 * @param {number} [defaultRetries=3] - Default number of retries for failed requests.
 *
 */
class FetchEnh {
  baseURL: string;
  defaultHeaders: Record<string, string>;
  defaultTimeout: number;
  defaultRetries: number;
  _requestInterceptors: RequestInterceptor[] = [];
  _responseInterceptors: ResponseInterceptor[] = [];
  _retryClassifier: RetryClassifier | null = null;
  _backoffStrategy: BackoffStrategy | null = null;
  _retryConfig: RetryConfig = { idempotentOnly: true, respectRetryAfter: true };
  _authStrategies: AuthStrategy[] = [];
  _queryStyle: { array: 'brackets' | 'repeat' | 'comma'; object: 'brackets' | 'dot' } = { array: 'brackets', object: 'brackets' };
  _dedupe: boolean = false;
  _dedupeKey?: (params: { method: string; url: string; body?: any }) => string;
  _inflight: Map<string, Promise<any>> = new Map();
  _onRetry?: (info: { attempt: number; delay: number; method: string; url: string; reason: 'status' | 'network'; status?: number }) => void;
  _onComplete?: (info: { method: string; url: string; status?: number; ok: boolean; attempts: number; elapsedMs: number }) => void;

  constructor({
    baseURL = '',
    defaultHeaders = {},
    defaultTimeout = 0,
    defaultRetries = 3,
    queryStyle,
    dedupe,
    dedupeKey,
    onRetry,
    onComplete,
  }: FetchEnhConfig) {
    this.baseURL = baseURL.endsWith('/')
      ? baseURL.slice(0, -1)
      : baseURL;
    this.defaultHeaders = {
      ...defaultHeaders,
    };
    this.defaultTimeout = defaultTimeout;
    this.defaultRetries = defaultRetries;
    this._requestInterceptors = [];
    this._responseInterceptors = [];
    if (queryStyle) {
      this._queryStyle = {
        array: queryStyle.array ?? this._queryStyle.array,
        object: queryStyle.object ?? this._queryStyle.object,
      } as any;
    }
    if (typeof dedupe === 'boolean') this._dedupe = dedupe;
    if (dedupeKey) this._dedupeKey = dedupeKey;
    if (onRetry) this._onRetry = onRetry;
    if (onComplete) this._onComplete = onComplete;
  }

  /**
   * Combines the baseURL and endpoint, ensuring a correct URL format.
   */
  private _formatEndpoint(endpoint: string): string {
    return `${this.baseURL}${endpoint.startsWith('/') ? '' : '/'
      }${endpoint}`;
  }

  /**
   * Adjusts the 'Content-Type' header based on the type of the provided body.
   */
  private _setContentTypeHeader(
    body: BodyType,
    headers: Record<string, string>
  ): void {
    if (body instanceof FormData) {
      delete headers['Content-Type'];
    } else if (body instanceof Blob && body.type) {
      headers['Content-Type'] = body.type;
    } else if (
      typeof body === 'string' &&
      !headers['Content-Type']
    ) {
      headers['Content-Type'] = 'text/plain;charset=UTF-8';
    } else if (
      typeof body === 'object' &&
      !(body instanceof ArrayBuffer) &&
      !(body instanceof Blob)
    ) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
  }

  /**
   * Constructs and returns a fetch Request object with the specified parameters.
   */
  private _buildRequest(
    endpoint: string,
    method: string,
    body?: BodyType,
    headers: Record<string, string> = {},
    query: Record<string, string> = {}
  ): Request {
    const serializeQuery = (params: Record<string, any>): string => {
      const parts: string[] = [];
      const append = (key: string, value: any) => {
        if (value === undefined || value === null) return;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      };
      const joinComma = (key: string, arr: any[]) => append(key, arr.map(String).join(','));
      const keyJoin = (parent: string, child: string) => this._queryStyle.object === 'dot' ? `${parent}.${child}` : `${parent}[${child}]`;
      const build = (keyPrefix: string, value: any) => {
        if (Array.isArray(value)) {
          if (this._queryStyle.array === 'comma') {
            joinComma(keyPrefix, value);
          } else if (this._queryStyle.array === 'repeat') {
            value.forEach((v) => append(keyPrefix, v));
          } else {
            value.forEach((v) => append(`${keyPrefix}[]`, v));
          }
        } else if (value instanceof Date) {
          append(keyPrefix, value.toISOString());
        } else if (typeof value === 'object' && value !== null && !(value instanceof Blob)) {
          Object.entries(value).forEach(([k, v]) => build(keyJoin(keyPrefix, k), v));
        } else {
          append(keyPrefix, value);
        }
      };
      Object.entries(params).forEach(([k, v]) => build(k, v));
      return parts.join('&');
    };

    let urlString: string;
    if (this.baseURL) {
      const url = new URL(this._formatEndpoint(endpoint));
      const q = serializeQuery(query);
      if (q) {
        const separator = url.search ? '&' : '?';
        urlString = `${url.toString()}${separator}${q}`;
      } else {
        urlString = url.toString();
      }
    } else {
      const queryString = serializeQuery(query);
      if (queryString) {
        urlString = `${endpoint}${endpoint.includes('?') ? '&' : '?'}${queryString}`;
      } else {
        urlString = endpoint;
      }
    }

    const combinedHeaders = {
      ...this.defaultHeaders,
      ...headers,
    };

    let adjustedBody: BodyType | undefined = body;
    if (body) {
      this._setContentTypeHeader(body, combinedHeaders);
      if (
        typeof body === 'object' &&
        !(
          body instanceof FormData ||
          body instanceof Blob ||
          body instanceof ArrayBuffer ||
          body instanceof URLSearchParams
        )
      ) {
        adjustedBody = JSON.stringify(body);
      }
    }

    return new Request(urlString, {
      method,
      headers: combinedHeaders,
      body: adjustedBody as any,
    });
  }

  /**
   * Adds a request interceptor to the FetchEnh instance.
   */
  addRequestInterceptor(
    interceptor: RequestInterceptor
  ): void {
    this._requestInterceptors.push(interceptor);
    this._requestInterceptors.sort(
      (a: RequestInterceptor, b: RequestInterceptor) => {
        const priorityA =
          a.priority ?? Number.MAX_SAFE_INTEGER;
        const priorityB =
          b.priority ?? Number.MAX_SAFE_INTEGER;
        return priorityA - priorityB;
      }
    );
  }

  /**
   * Adds a response interceptor to the FetchEnh instance.
   */
  addResponseInterceptor(
    interceptor: ResponseInterceptor
  ): void {
    this._responseInterceptors.push(interceptor);
    this._responseInterceptors.sort(
      (a: ResponseInterceptor, b: ResponseInterceptor) => {
        const priorityA =
          a.priority ?? Number.MAX_SAFE_INTEGER;
        const priorityB =
          b.priority ?? Number.MAX_SAFE_INTEGER;
        return priorityA - priorityB;
      }
    );
  }

  /**
   * Removes all request interceptors from the FetchEnh instance.
   */
  clearRequestInterceptors(): void {
    this._requestInterceptors = [];
  }

  /**
   * Removes a request interceptor from the FetchEnh instance.
   */
  removeRequestInterceptor(
    interceptor: RequestInterceptor
  ): void {
    const index =
      this._requestInterceptors.indexOf(interceptor);
    if (index > -1) {
      this._requestInterceptors.splice(index, 1);
    }
  }

  /**
   * Removes all response interceptors from the FetchEnh instance.
   */
  clearResponseInterceptors(): void {
    this._responseInterceptors = [];
  }

  /**
   * Removes a response interceptor from the FetchEnh instance.
   */
  removeResponseInterceptor(
    interceptor: ResponseInterceptor
  ): void {
    const index =
      this._responseInterceptors.indexOf(interceptor);
    if (index > -1) {
      this._responseInterceptors.splice(index, 1);
    }
  }

  /**
   * Apply all request interceptors to the provided request.
   */
  private async _applyRequestInterceptors(
    request: Request
  ): Promise<Request> {
    const apply = async (index: number, req: Request): Promise<Request> => {
      if (index >= this._requestInterceptors.length) return req;
      const interceptor = this._requestInterceptors[index];
      // Run downstream first (onion model), then let current potentially modify
      const downstream = await apply(index + 1, req);
      try {
        const result = await interceptor.handler(downstream, async () => { /* no-op for back-compat */ });
        if (result === false) {
          throw new InterceptorAbortError();
        }
        return result instanceof Request ? result : downstream;
      } catch (error) {
        throw error;
      }
    };
    return apply(0, request);
  }

  /**
   * Apply all response interceptors to the provided response.
   */
  private async _applyResponseInterceptors(
    response: Response
  ): Promise<Response> {
    const apply = async (index: number, res: Response): Promise<Response> => {
      if (index >= this._responseInterceptors.length) return res;
      const interceptor = this._responseInterceptors[index];
      // Run downstream first (onion model), then let current potentially modify
      const downstream = await apply(index + 1, res);
      try {
        const result = await interceptor.handler(downstream, async () => { /* no-op for back-compat */ });
        if (result === false) {
          throw new InterceptorAbortError('Response interceptor halted.');
        }
        return result instanceof Response ? result : downstream;
      } catch (error) {
        throw error;
      }
    };
    return apply(0, response);
  }

  /**
   * Executes the fetch request and processes the response based on its type.
   * Will retry the request a specified number of times in the event of a failure.
   */
  private async _fetchAndParse(
    request: Request,
    responseType: string,
    retries: number,
    timeout: number,
    externalSignal?: AbortSignal,
    attempt: number = 1,
    startTime: number = Date.now(),
    retryCtx?: { method: string; bodyFactory?: () => BodyType; bodyReplayable?: boolean; rawBody?: BodyInit | null }
  ): Promise<
    JSON | string | Blob | ArrayBuffer | FormData | Response
  > {
    if (externalSignal?.aborted) {
      const abortErr: any = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = timeout > 0 ? setTimeout(
      () => { timedOut = true; controller.abort(); },
      timeout
    ) : null;

    // Listen to external signal if provided
    const abortHandler = () => controller.abort();
    if (externalSignal) {
      externalSignal.addEventListener('abort', abortHandler);
    }

    request = await this._applyRequestInterceptors(request);
    request = await this._applyAuthOnRequest(request);

    // Helpers
    const defaultShouldRetryResponse = (res: Response) =>
      res.status >= 500 && res.status < 600 || res.status === 429;
    const MAX_RETRY_AFTER_MS = 60000; // clamp per-attempt Retry-After to 60s
    const defaultBackoffDelay = (attempt: number, res?: Response) => {
      if (this._retryConfig.respectRetryAfter && res) {
        const ra = res.headers.get('retry-after');
        if (ra) {
          // Integer seconds
          const seconds = Number(ra);
          if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
          // HTTP-date
          const dateMs = Date.parse(ra);
          if (!Number.isNaN(dateMs)) {
            const diff = dateMs - Date.now();
            if (diff > 0) return Math.min(diff, MAX_RETRY_AFTER_MS);
          }
        }
      }
      const base = 200; // ms
      const cap = 2000; // ms
      const exp = Math.min(base * Math.pow(2, attempt - 1), cap);
      const jitterFactor = 0.7 + Math.random() * 0.6;
      return Math.floor(exp * jitterFactor);
    };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    try {
      const method = request.method.toUpperCase();
      const urlForFetch = request.url;
      // Resolve fetch body without touching request.body (a consumed ReadableStream in native fetch).
      // bodyFactory produces a fresh body on every attempt; rawBody is the pre-serialised value
      // stored by _request so it can be safely replayed across retries.
      const fetchBody: BodyInit | null | undefined = retryCtx?.bodyFactory
        ? (() => {
            const f = retryCtx.bodyFactory!();
            return (typeof f === 'object' &&
              !(f instanceof FormData) && !(f instanceof Blob) &&
              !(f instanceof ArrayBuffer) && !(f instanceof URLSearchParams))
              ? JSON.stringify(f) : f as BodyInit;
          })()
        : retryCtx?.rawBody !== undefined
          ? retryCtx.rawBody
          : ((request as any)._bodyInit ?? (request as any).body) as BodyInit | null | undefined;
      const initForFetch: RequestInit = {
        method: request.method,
        headers: request.headers as any,
        body: fetchBody,
        signal: controller.signal,
      };
      const response = await fetch(urlForFetch, initForFetch);

      // Apply response interceptors
      const interceptedResponse =
        await this._applyResponseInterceptors(response);

      if (!interceptedResponse.ok) {
        const idempotent = ['GET', 'HEAD', 'OPTIONS', 'PUT'].includes(method);
        const allowRetryBase = !this._retryConfig.idempotentOnly || idempotent;
        const unsafeMethod = ['POST', 'DELETE'].includes(method);
        const canRetryUnsafe = !unsafeMethod || this._retryConfig.allowUnsafeRetries || !!this._retryConfig.idempotencyKeyFactory;
        const bodyReplayable = retryCtx?.bodyReplayable !== false || !!retryCtx?.bodyFactory;
        const allowRetry = allowRetryBase && canRetryUnsafe && bodyReplayable;
        const classifierResult = this._retryClassifier
          ? this._retryClassifier.shouldRetry({ response: interceptedResponse, method, attempt })
          : defaultShouldRetryResponse(interceptedResponse);
        if (retries > 0 && allowRetry && classifierResult) {
          const delay = this._backoffStrategy
            ? this._backoffStrategy.computeDelay({ attempt, response: interceptedResponse })
            : defaultBackoffDelay(attempt, interceptedResponse);
          if (this._onRetry) {
            this._onRetry({ attempt, delay, method, url: request.url, reason: 'status', status: interceptedResponse.status });
          }
          if (this._retryConfig.maxElapsedMs && Date.now() - startTime + delay > this._retryConfig.maxElapsedMs) {
            throw new TimeoutError({ elapsedMs: Date.now() - startTime, cause: new Error('maxElapsedMs exceeded') });
          }
          await sleep(delay);

          const nextRequest = this._buildRetryRequest(request, method, retryCtx);

          return this._fetchAndParse(
            nextRequest,
            responseType,
            retries - 1,
            timeout,
            externalSignal,
            attempt + 1,
            startTime,
            retryCtx
          );
        }

        let errorData;
        try {
          errorData = await interceptedResponse.json();
        } catch {
          errorData = {
            message: 'Unable to parse error data.',
          };
        }
        // Allow auth strategies to handle 401/403 and retry
        if (interceptedResponse.status === 401 || interceptedResponse.status === 403) {
          for (const strategy of this._authStrategies) {
            if (strategy.onAuthError) {
              const maybeRes = await strategy.onAuthError(request, interceptedResponse, async (newReq: Request) => {
                // Use retryCtx body to avoid ReadableStream reuse after the initial fetch consumed it
                const authBody: BodyInit | null | undefined = retryCtx?.bodyFactory
                  ? (() => {
                      const f = retryCtx.bodyFactory!();
                      return (typeof f === 'object' &&
                        !(f instanceof FormData) && !(f instanceof Blob) &&
                        !(f instanceof ArrayBuffer) && !(f instanceof URLSearchParams))
                        ? JSON.stringify(f) : f as BodyInit;
                    })()
                  : retryCtx?.rawBody !== undefined
                    ? retryCtx.rawBody
                    : ((newReq as any)._bodyInit ?? (newReq as any).body) as BodyInit | null | undefined;
                const newInit: RequestInit = {
                  method: newReq.method,
                  headers: newReq.headers as any,
                  body: authBody,
                  signal: controller.signal,
                };
                return fetch(newReq.url, newInit);
              });
              if (maybeRes instanceof Response) {
                // Apply response interceptors, then fully parse the body through the
                // correct responseType path. Previously this short-circuited to
                // _applyResponseInterceptors and returned a raw Response, silently
                // violating the generic type contract (e.g. get<User>() returning Response).
                const retryIntercepted = await this._applyResponseInterceptors(maybeRes);
                const retryMethod = request.method.toUpperCase();
                if (!retryIntercepted.ok) {
                  let retryErrorData;
                  try { retryErrorData = await retryIntercepted.json(); } catch { retryErrorData = { message: 'Unable to parse error data.' }; }
                  if (this._onComplete) this._onComplete({ method: retryMethod, url: request.url, status: retryIntercepted.status, ok: false, attempts: attempt, elapsedMs: Date.now() - startTime });
                  throw new FetchError(retryIntercepted, retryErrorData, {
                    method: retryMethod, url: request.url, attempts: attempt, elapsedMs: Date.now() - startTime,
                    requestId: retryIntercepted.headers.get('x-request-id') || retryIntercepted.headers.get('x-requestid') || undefined,
                  });
                }
                if (this._onComplete) this._onComplete({ method: retryMethod, url: request.url, status: retryIntercepted.status, ok: true, attempts: attempt, elapsedMs: Date.now() - startTime });
                return this._parseBody(retryIntercepted, responseType);
              }
              if (maybeRes === false) {
                throw new Error('Auth strategy halted after auth error.');
              }
            }
          }
        }
        const status = interceptedResponse.status;
        const isRetryableStatus = status >= 500 || status === 429;
        const fetchErr = new FetchError(
          interceptedResponse,
          errorData,
          {
            method,
            url: request.url,
            attempts: attempt,
            elapsedMs: Date.now() - startTime,
            requestId: interceptedResponse.headers.get('x-request-id') || interceptedResponse.headers.get('x-requestid') || undefined,
          }
        );
        if (isRetryableStatus && (attempt > 1 || (allowRetry && classifierResult && retries === 0))) {
          throw new RetryError(attempt, fetchErr, { method, url: request.url, elapsedMs: Date.now() - startTime });
        }
        if (this._onComplete) {
          this._onComplete({ method, url: request.url, status: interceptedResponse.status, ok: false, attempts: attempt, elapsedMs: Date.now() - startTime });
        }
        throw fetchErr;
      }
      // Parse the successful response body, then fire the completion hook.
      const result = await this._parseBody(interceptedResponse, responseType);
      if (this._onComplete) this._onComplete({ method, url: request.url, status: interceptedResponse.status, ok: true, attempts: attempt, elapsedMs: Date.now() - startTime });
      return result;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        if (timedOut) {
          throw new TimeoutError({ elapsedMs: Date.now() - startTime, cause: error });
        }
        throw error; // user-cancelled
      }

      // If this is a known library error, rethrow as-is (do not treat as network)
      if (error instanceof UnsupportedResponseTypeError || error instanceof FetchError || error instanceof TimeoutError || error instanceof RetryError || error instanceof InterceptorAbortError || error instanceof AuthAbortError) {
        throw error;
      }

      // Network error: retry if possible (respect idempotentOnly, unsafe, replayability)
      const method = request.method.toUpperCase();
      const idempotent = ['GET', 'HEAD', 'OPTIONS', 'PUT'].includes(method);
      const unsafeMethod = ['POST', 'DELETE'].includes(method);
      const canRetryUnsafe = !unsafeMethod || this._retryConfig.allowUnsafeRetries || !!this._retryConfig.idempotencyKeyFactory;
      const bodyReplayable = retryCtx?.bodyReplayable !== false || !!retryCtx?.bodyFactory;
      const allowRetry = (!this._retryConfig.idempotentOnly || idempotent) && canRetryUnsafe && bodyReplayable;
      if (retries > 0 && allowRetry) {
        const delay = this._backoffStrategy
          ? this._backoffStrategy.computeDelay({ attempt, error })
          : defaultBackoffDelay(attempt);
        if (this._onRetry) {
          this._onRetry({ attempt, delay, method, url: request.url, reason: 'network' });
        }
        if (this._retryConfig.maxElapsedMs && Date.now() - startTime + delay > this._retryConfig.maxElapsedMs) {
          throw new TimeoutError({ elapsedMs: Date.now() - startTime, cause: new Error('maxElapsedMs exceeded') });
        }
        await sleep(delay);

        const nextRequest = this._buildRetryRequest(request, method, retryCtx);

        return this._fetchAndParse(
          nextRequest,
          responseType,
          retries - 1,
          timeout,
          externalSignal,
          attempt + 1,
          startTime,
          retryCtx
        );
      }

      if (attempt > 1 || (allowRetry && retries === 0)) {
        if (this._onComplete) this._onComplete({ method, url: request.url, ok: false, attempts: attempt, elapsedMs: Date.now() - startTime });
        throw new RetryError(attempt, error, { method, url: request.url, elapsedMs: Date.now() - startTime });
      }
      if (this._onComplete) this._onComplete({ method, url: request.url, ok: false, attempts: attempt, elapsedMs: Date.now() - startTime });
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', abortHandler);
      }
    }
  }

  private _isReplayableBody(body: BodyType | undefined): boolean {
    if (body == null) return true;
    if (typeof body === 'string') return true;
    if (body instanceof URLSearchParams) return true;
    if (body instanceof ArrayBuffer) return true;
    if (body instanceof Blob) return true;
    if (body instanceof FormData) return true;
    // ReadableStream bodies cannot be replayed once consumed; guard before the
    // generic object check below which would otherwise return true for them.
    if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return false;
    if (typeof body === 'object') return true; // plain JSON object — gets JSON.stringify'd
    return false;
  }

  /**
   * Reconstructs the `Request` for a retry attempt. Adds an `Idempotency-Key` header
   * when an `idempotencyKeyFactory` is configured, and replays the body through
   * `bodyFactory` when provided. Returns the original request unchanged when neither
   * action is needed, keeping the common case allocation-free.
   *
   * Extracted to eliminate the identical retry-rebuild block that previously appeared
   * in both the non-OK response path and the network-error catch path of `_fetchAndParse`.
   */
  private _buildRetryRequest(
    request: Request,
    method: string,
    retryCtx?: { method: string; bodyFactory?: () => BodyType; bodyReplayable?: boolean; rawBody?: BodyInit | null }
  ): Request {
    // Body is now passed directly to fetch() via retryCtx.rawBody / bodyFactory in _fetchAndParse;
    // this method only needs to mutate headers (e.g. add Idempotency-Key).
    const needIdem = this._retryConfig.idempotencyKeyFactory && ['POST', 'DELETE'].includes(method);
    if (!needIdem) return request;
    const headersObj = new Headers(request.headers);
    if (!headersObj.has('Idempotency-Key')) {
      headersObj.set('Idempotency-Key', this._retryConfig.idempotencyKeyFactory!());
    }
    return new Request(request.url, { method: request.method, headers: headersObj });
  }

  /**
   * Parses a successful Response body according to the requested responseType.
   * Extracted to eliminate the duplicated switch that previously appeared in both
   * the happy path and the auth-retry path of _fetchAndParse.
   */
  private async _parseBody(
    response: Response,
    responseType: string
  ): Promise<JSON | string | Blob | ArrayBuffer | FormData | Response> {
    switch (responseType) {
      case 'json': return response.json();
      case 'text': return response.text();
      case 'blob': return response.blob();
      case 'arrayBuffer': return response.arrayBuffer();
      case 'formData': return response.formData();
      case 'response': return response;
      case 'auto': {
        const ct = response.headers.get('content-type') || '';
        if (ct.includes('application/json')) return response.json();
        if (ct.startsWith('text/')) return response.text();
        if (ct.includes('application/octet-stream')) return response.arrayBuffer();
        return response; // fallback: caller handles opaque response
      }
      default:
        throw new UnsupportedResponseTypeError(responseType);
    }
  }

  /**
   * Performs a fetch request with the provided options and returns parsed data.
   */
  async _request<T = any>({
    endpoint,
    method = 'GET',
    body,
    headers = {},
    query = {},
    responseType = 'json',
    options = {},
    bodyFactory,
  }: RequestParameters): Promise<T> {
    const {
      timeout = this.defaultTimeout,
      retries = this.defaultRetries,
      signal,
    } = options;
    const request = this._buildRequest(
      endpoint,
      method,
      body,
      headers,
      query
    );

    // Request deduplication
    const methodUpper = method.toUpperCase();
    const bodyKey = body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof URLSearchParams) ? JSON.stringify(body) : (typeof body === 'string' ? body : undefined);
    const dedupeKey = this._dedupeKey
      ? this._dedupeKey({ method: methodUpper, url: request.url, body: bodyKey })
      : `${methodUpper} ${request.url} ${bodyKey ?? ''}`;
    // Only deduplicate safe (read-only) methods unless the caller has explicitly
    // provided a custom dedupeKey factory. Coalescing concurrent POST / DELETE /
    // PATCH / PUT calls is a subtle mutation bug: two callers expect two side-effects
    // but receive only one. Users who genuinely want mutation-deduplication must opt
    // in by passing dedupeKey at construction time.
    const SAFE_DEDUPE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
    const shouldDedupe = this._dedupe && (SAFE_DEDUPE_METHODS.has(methodUpper) || !!this._dedupeKey);
    if (shouldDedupe) {
      const existing = this._inflight.get(dedupeKey);
      if (existing) return existing as Promise<T>;
    }
    // Auto detect responseType if requested (defer to runtime based on Content-Type)
    const finalResponseType = responseType;
    const bodyReplayable = this._isReplayableBody(body);

    // Pre-serialise the body (mirrors _buildRequest's logic) so it can be replayed on retry
    // without consuming the ReadableStream that native fetch creates internally for Request.body.
    const rawBody: BodyInit | null | undefined = body != null
      ? (typeof body === 'object' &&
          !(body instanceof FormData) && !(body instanceof Blob) &&
          !(body instanceof ArrayBuffer) && !(body instanceof URLSearchParams))
        ? JSON.stringify(body)
        : body as BodyInit
      : undefined;

    const promise = this._fetchAndParse(
      request,
      finalResponseType,
      retries,
      timeout,
      signal,
      1,
      Date.now(),
      {
        method: methodUpper,
        bodyFactory,
        bodyReplayable,
        rawBody,
      }
    ) as Promise<T>;
    if (shouldDedupe) {
      this._inflight.set(dedupeKey, promise as any);
      promise.finally(() => {
        this._inflight.delete(dedupeKey);
      });
    }
    return promise;
  }

  /**
   * Sends a HEAD request to the specified endpoint.
   */
  async head<T = Response>(
    options: HeadOptions
  ): Promise<T> {
    const { endpoint, headers = {}, query = {} } = options;
    return this._request({
      endpoint,
      method: 'HEAD',
      headers,
      query,
      responseType: 'response',
    });
  }

  /**
   * Paginates through a list of results until it reaches the limit or the response returns fewer items than the page size.
   */
  private async _paginate<T = any>(
    options: PaginateOptions
  ): Promise<T[]> {
    const {
      endpoint,
      headers,
      query,
      responseType,
      page,
      pageSize,
      limit,
      maxPages = 100,
      extractor,
    } = options;

    let currentPage = page;
    let results: any[] = [];
    let iterations = 0;

    while (true) {
      const currentQuery = {
        ...query,
        page: currentPage.toString(),
        pageSize: pageSize.toString(),
      };

      const response = await this._request({
        ...options,
        query: currentQuery,
      });

      if (responseType === 'json') {
        const pageItems = Array.isArray(response)
          ? response
          : extractor
            ? extractor(response)
            : [];
        if (!Array.isArray(pageItems)) break;
        results = results.concat(pageItems);

        if (
          (limit && results.length >= limit) ||
          pageItems.length < pageSize ||
          ++iterations >= maxPages
        ) {
          break;
        }

        currentPage++;
      } else {
        break;
      }
    }

    return limit ? results.slice(0, limit) : results;
  }

  private _parseLinkHeaderForNextCursor(headers: Headers, cursorParamName: string): string | null {
    const link = headers.get('link') || headers.get('Link');
    if (!link) return null;
    // Example: <https://api.test/users?cursor=abc>; rel="next", <...>; rel="last"
    const parts = link.split(',');
    for (const p of parts) {
      const section = p.trim();
      const m = section.match(/<([^>]+)>;\s*rel="([^"]+)"/i);
      if (m && m[2] === 'next') {
        try {
          const url = new URL(m[1]);
          const cur = url.searchParams.get(cursorParamName) || url.searchParams.get('page');
          return cur || null;
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  private async _paginateCursor<T = any>(params: {
    endpoint: string;
    headers?: Record<string, string>;
    query?: Record<string, any>;
    responseType?: string;
    limit?: number;
    maxPages?: number;
    cursor?: string | null;
    cursorParamName?: string;
    getNextCursor?: (response: any, headers: Headers) => string | null;
    useLinkHeader?: boolean;
    extractor?: (response: any) => any[];
    /** Per-call timeout / retry / signal overrides passed through from get(). */
    options?: RequestOptions;
  }): Promise<T[]> {
    const {
      endpoint,
      headers = {},
      query = {},
      responseType = 'json',
      limit,
      maxPages = 100,
      cursor: initialCursor = null,
      cursorParamName = 'cursor',
      getNextCursor,
      useLinkHeader,
      extractor,
      options: perCallOptions,
    } = params;

    let cursor = initialCursor;
    let results: any[] = [];
    let iterations = 0;

    while (true) {
      const q = { ...query } as any;
      if (cursor) q[cursorParamName] = cursor;

      let pageItems: any[] = [];
      let nextCursor: string | null = null;

      if (useLinkHeader) {
        // Fetch as Response to access headers and body
        const res = await this._request<Response>({
          endpoint,
          method: 'GET',
          headers,
          query: q,
          responseType: 'response',
          options: perCallOptions ?? { timeout: this.defaultTimeout, retries: this.defaultRetries },
        } as any);
        // Parse body as JSON and extract items
        const data = await res.clone().json().catch(() => []);
        pageItems = Array.isArray(data) ? data : (extractor ? extractor(data) : []);
        nextCursor = getNextCursor ? getNextCursor(data, res.headers) : this._parseLinkHeaderForNextCursor(res.headers, cursorParamName);
      } else if (getNextCursor) {
        // getNextCursor needs access to response headers — fetch as Response
        const res = await this._request<Response>({
          endpoint,
          method: 'GET',
          headers,
          query: q,
          responseType: 'response',
          options: perCallOptions ?? { timeout: this.defaultTimeout, retries: this.defaultRetries },
        } as any);
        const data = await res.clone().json().catch(() => []);
        pageItems = Array.isArray(data) ? data : (extractor ? extractor(data) : []);
        nextCursor = getNextCursor(data, res.headers);
      } else {
        const resp: any = await this._request({
          endpoint,
          method: 'GET',
          headers,
          query: q,
          responseType,
          options: perCallOptions ?? { timeout: this.defaultTimeout, retries: this.defaultRetries },
        });
        if (responseType === 'json') {
          pageItems = Array.isArray(resp) ? resp : (extractor ? extractor(resp) : []);
        }
      }

      if (!Array.isArray(pageItems)) break;
      results = results.concat(pageItems);
      if (limit && results.length >= limit) break;

      if (!nextCursor || pageItems.length === 0 || ++iterations >= maxPages) break;
      cursor = nextCursor;
    }

    return limit ? results.slice(0, limit) : results;
  }

  /**
   * Sends a GET request to the specified endpoint.
   * If both `page` and `pageSize` are provided, the method will automatically paginate
   * until it either reaches the `limit` or the response returns fewer items than `pageSize`.
   */
  // Overloads for responseType typing
  get(options: GetOptions & { responseType: 'response' }): Promise<Response>;
  get<T = any>(options: GetOptions & { responseType?: Exclude<GetOptions['responseType'], 'response'> }): Promise<T>;
  async get<T = any>(
    options: GetOptions
  ): Promise<T> {
    const {
      endpoint,
      query: originalQuery = {},
      headers = {},
      responseType = 'json',
      page,
      pageSize,
      limit,
      maxPages,
      extractor,
      options: perCallOptions,
    } = options;

    const baseRequestOptions = {
      endpoint,
      method: 'GET',
      headers,
      responseType,
      options: perCallOptions ?? {
        timeout: this.defaultTimeout,
        retries: this.defaultRetries,
      },
    };

    if (page && pageSize) {
      return this._paginate<any>({
        ...baseRequestOptions,
        query: originalQuery,
        page,
        pageSize,
        limit,
        maxPages,
        extractor,
        responseType,
      }) as Promise<T>;
    } else if (options.cursor !== undefined || options.getNextCursor || options.useLinkHeader) {
      return this._paginateCursor<any>({
        endpoint,
        headers,
        query: originalQuery,
        responseType,
        limit,
        maxPages,
        cursor: options.cursor ?? null,
        cursorParamName: options.cursorParamName ?? 'cursor',
        getNextCursor: options.getNextCursor,
        useLinkHeader: options.useLinkHeader,
        extractor,
        options: perCallOptions,
      }) as Promise<T>;
    } else {
      return this._request<T>({
        ...baseRequestOptions,
        query: originalQuery,
      });
    }
  }

  /**
   * Sends a POST request to the specified endpoint with the provided data.
   */
  // Overloads for responseType typing
  post(options: PostOptions & { responseType: 'response' }): Promise<Response>;
  post<T = any>(options: PostOptions & { responseType?: Exclude<PostOptions['responseType'], 'response'> }): Promise<T>;
  post<T = any>(
    options: PostOptions
  ): Promise<T> {
    const {
      endpoint,
      body,
      headers = {},
      responseType = 'json',
      options: perCallOptions,
      query = {},
      bodyFactory,
    } = options;

    return this._request({
      endpoint,
      method: 'POST',
      body,
      headers,
      query,
      responseType,
      options: perCallOptions,
      bodyFactory,
    });
  }

  /**
   * Sends a PUT request to the specified endpoint with the provided data.
   */
  // Overloads for responseType typing
  put(options: PutOptions & { responseType: 'response' }): Promise<Response>;
  put<T = any>(options: PutOptions & { responseType?: Exclude<PutOptions['responseType'], 'response'> }): Promise<T>;
  put<T = any>(
    options: PutOptions
  ): Promise<T> {
    const {
      endpoint,
      body,
      headers = {},
      responseType = 'json',
      options: perCallOptions,
      query = {},
      bodyFactory,
    } = options;

    return this._request({
      endpoint,
      method: 'PUT',
      body,
      headers,
      query,
      responseType,
      options: perCallOptions,
      bodyFactory,
    });
  }

  /**
   * Sends a PATCH request to the specified endpoint with the provided data.
   */
  // Overloads for responseType typing
  patch(options: PatchOptions & { responseType: 'response' }): Promise<Response>;
  patch<T = any>(options: PatchOptions & { responseType?: Exclude<PatchOptions['responseType'], 'response'> }): Promise<T>;
  patch<T = any>(
    options: PatchOptions
  ): Promise<T> {
    const {
      endpoint,
      body,
      headers = {},
      responseType = 'json',
      options: perCallOptions,
      query = {},
      bodyFactory,
    } = options;

    return this._request({
      endpoint,
      method: 'PATCH',
      body,
      headers,
      query,
      responseType,
      options: perCallOptions,
      bodyFactory,
    });
  }

  /**
   * Sends a DELETE request to the specified endpoint.
   */
  // Overloads for responseType typing
  delete(options: DeleteOptions & { responseType: 'response' }): Promise<Response>;
  delete<T = any>(options: DeleteOptions & { responseType?: Exclude<DeleteOptions['responseType'], 'response'> }): Promise<T>;
  delete<T = any>(
    options: DeleteOptions
  ): Promise<T> {
    const {
      endpoint,
      headers = {},
      responseType = 'json',
      options: perCallOptions,
      body,
      query = {},
    } = options;

    return this._request({
      endpoint,
      method: 'DELETE',
      body,
      headers,
      query,
      responseType,
      options: perCallOptions,
    });
  }

  /**
   * Performs a raw fetch, bypassing all middleware by default.
   *
   * @remarks
   * **Middleware bypass warning:** By default `raw()` calls the native `fetch()` directly.
   * No request interceptors, response interceptors, auth strategies, timeouts, or retries
   * are applied. Code that relies on `useAuthStrategy()` or `addRequestInterceptor()` will
   * see those additions silently ignored on calls routed through `raw()`.
   *
   * Pass `{ applyMiddleware: true }` to opt back in to request interceptors, auth
   * strategies, and response interceptors — without the full timeout/retry scaffolding
   * of a normal `_request` call. This is useful when you need auth headers applied to a
   * one-shot request but do not want automatic retries.
   *
   * @param options - Raw request options.
   * @returns A native `Response` promise.
   */
  async raw(options: RawOptions): Promise<Response> {
    const {
      endpoint,
      method = 'GET',
      body,
      headers = {},
      query = {},
      applyMiddleware = false,
    } = options;

    let request = this._buildRequest(
      endpoint,
      method,
      body,
      headers,
      query
    );

    if (applyMiddleware) {
      request = await this._applyRequestInterceptors(request);
      request = await this._applyAuthOnRequest(request);
      const response = await fetch(request);
      return this._applyResponseInterceptors(response);
    }

    return fetch(request);
  }

  /**
   * Sets the configuration dynamically for the FetchHelper instance.
   */
  setConfig(config: FetchEnhConfig): void {
    const knownKeys = new Set<string>([
      'baseURL', 'defaultHeaders', 'defaultTimeout', 'defaultRetries',
      'queryStyle', 'dedupe', 'dedupeKey', 'onRetry', 'onComplete',
    ]);
    for (const key of Object.keys(config)) {
      if (!knownKeys.has(key)) {
        console.warn(`[FetchEnh] setConfig: unknown key "${key}" will be ignored.`);
      }
    }
    if ('baseURL' in config && config.baseURL !== undefined) {
      const v = config.baseURL;
      this.baseURL = v.endsWith('/') ? v.slice(0, -1) : v;
    }
    if ('defaultHeaders' in config && config.defaultHeaders !== undefined) {
      this.defaultHeaders = config.defaultHeaders;
    }
    if ('defaultTimeout' in config && config.defaultTimeout !== undefined) {
      this.defaultTimeout = config.defaultTimeout;
    }
    if ('defaultRetries' in config && config.defaultRetries !== undefined) {
      this.defaultRetries = config.defaultRetries;
    }
    if ('queryStyle' in config && config.queryStyle) {
      this._queryStyle = {
        array: config.queryStyle.array ?? this._queryStyle.array,
        object: config.queryStyle.object ?? this._queryStyle.object,
      };
    }
    if ('dedupe' in config && typeof config.dedupe === 'boolean') {
      this._dedupe = config.dedupe;
    }
    if ('dedupeKey' in config) {
      this._dedupeKey = config.dedupeKey;
    }
    if ('onRetry' in config) {
      this._onRetry = config.onRetry;
    }
    if ('onComplete' in config) {
      this._onComplete = config.onComplete;
    }
  }
  setRetryBehavior(
    classifier: RetryClassifier,
    backoff: BackoffStrategy,
    config?: RetryConfig
  ): void {
    this._retryClassifier = classifier;
    this._backoffStrategy = backoff;
    if (config) this._retryConfig = { ...this._retryConfig, ...config };
  }

  /**
   * Replaces only the retry classifier, leaving the backoff strategy and config unchanged.
   * Pass `null` to revert to the built-in default (retry 5xx + 429).
   */
  setRetryClassifier(classifier: RetryClassifier | null): void {
    this._retryClassifier = classifier;
  }

  /**
   * Replaces only the backoff strategy, leaving the classifier and config unchanged.
   * Pass `null` to revert to the built-in exponential-backoff-with-jitter default.
   */
  setBackoffStrategy(backoff: BackoffStrategy | null): void {
    this._backoffStrategy = backoff;
  }

  /**
   * Merges the provided config into the current retry config.
   * Only the supplied keys are overwritten; omitted keys retain their existing values.
   */
  setRetryConfig(config: Partial<RetryConfig>): void {
    this._retryConfig = { ...this._retryConfig, ...config };
  }

  useAuthStrategy(strategy: AuthStrategy): void {
    this._authStrategies.push(strategy);
    this._authStrategies.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  private async _applyAuthOnRequest(request: Request): Promise<Request> {
    for (const strategy of this._authStrategies) {
      if (strategy.onRequest) {
        const result = await strategy.onRequest(request);
        if (result instanceof Request) {
          request = result;
        } else if (result === false) {
          throw new AuthAbortError();
        }
      }
    }
    return request;
  }
}

export default FetchEnh;
export type {
  FetchEnhConfig,
} from './types/config';
export type {
  RequestParameters,
  BodyType,
} from './types/requestParameters';
export type {
  GetOptions,
  PostOptions,
  PutOptions,
  PatchOptions,
  DeleteOptions,
  RawOptions,
  HeadOptions,
  PaginateOptions,
} from './types/httpMethodOptions';
export type { RequestInterceptor, ResponseInterceptor } from './types/interceptors';
export type { AuthStrategy, TokenStore } from './types/auth';
export type { RetryClassifier, BackoffStrategy, RetryConfig } from './types/retry';
export { MemoryTokenStore, LocalStorageTokenStore } from './auth/tokenStores';
export { BearerTokenAuth, ApiKeyAuth, BasicAuth, CsrfTokenAuth, OAuth2ClientCredentialsAuth, OAuth2PKCEAuth } from './auth/strategies';
export { FetchError, TimeoutError, RetryError, UnsupportedResponseTypeError, InterceptorAbortError, AuthAbortError } from './errors/fetchErrors';
