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

// ── Core modules ──────────────────────────────────────────────────────────────
import { buildRequest, type QueryStyle } from './core/requestBuilder';
import {
  isReplayableBody,
  resolveBody,
  preSerializeBody,
  type RetryContext,
} from './core/bodyUtils';
import { parseBody } from './core/responseParser';
import { InterceptorPipeline } from './core/interceptorPipeline';
import { AuthPipeline } from './core/authPipeline';
import {
  sleep,
  buildRetryRequest,
  isRetryAllowed,
  computeDelay,
  classifyRetry,
} from './core/retryEngine';
import { DeduplicationCache } from './core/deduplication';
import { paginate, paginateCursor } from './core/pagination';

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
  // ── Configuration state ───────────────────────────────────────────────────
  baseURL: string;
  defaultHeaders: Record<string, string>;
  defaultTimeout: number;
  defaultRetries: number;
  _queryStyle: QueryStyle = { array: 'brackets', object: 'brackets' };
  _dedupe: boolean = false;
  _dedupeKey?: (params: { method: string; url: string; body?: any }) => string;
  _onRetry?: (info: { attempt: number; delay: number; method: string; url: string; reason: 'status' | 'network'; status?: number }) => void;
  _onComplete?: (info: { method: string; url: string; status?: number; ok: boolean; attempts: number; elapsedMs: number }) => void;

  // ── Retry configuration ──────────────────────────────────────────────────
  _retryClassifier: RetryClassifier | null = null;
  _backoffStrategy: BackoffStrategy | null = null;
  _retryConfig: RetryConfig = { idempotentOnly: true, respectRetryAfter: true };

  // ── Composed modules ─────────────────────────────────────────────────────
  private _interceptors = new InterceptorPipeline();
  private _auth = new AuthPipeline();
  private _dedupeCache = new DeduplicationCache();

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
    this.defaultHeaders = { ...defaultHeaders };
    this.defaultTimeout = defaultTimeout;
    this.defaultRetries = defaultRetries;
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

  // ── Interceptor delegation ────────────────────────────────────────────────

  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this._interceptors.addRequestInterceptor(interceptor);
  }

  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this._interceptors.addResponseInterceptor(interceptor);
  }

  clearRequestInterceptors(): void {
    this._interceptors.clearRequestInterceptors();
  }

  removeRequestInterceptor(interceptor: RequestInterceptor): void {
    this._interceptors.removeRequestInterceptor(interceptor);
  }

  clearResponseInterceptors(): void {
    this._interceptors.clearResponseInterceptors();
  }

  removeResponseInterceptor(interceptor: ResponseInterceptor): void {
    this._interceptors.removeResponseInterceptor(interceptor);
  }

  /** @internal — thin wrappers kept for internal use and test compatibility */
  private async _applyRequestInterceptors(request: Request): Promise<Request> {
    return this._interceptors.applyRequestInterceptors(request);
  }

  private async _applyResponseInterceptors(response: Response): Promise<Response> {
    return this._interceptors.applyResponseInterceptors(response);
  }

  // ── Core fetch + retry orchestration ──────────────────────────────────────

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
    retryCtx?: RetryContext
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

    const abortHandler = () => controller.abort();
    if (externalSignal) {
      externalSignal.addEventListener('abort', abortHandler);
    }

    // Apply middleware pipelines
    request = await this._applyRequestInterceptors(request);
    request = await this._auth.applyAuthOnRequest(request);

    try {
      const method = request.method.toUpperCase();
      const urlForFetch = request.url;

      // Resolve the body for this attempt (handles bodyFactory, rawBody, fallback)
      const fetchBody = resolveBody(retryCtx, request);

      const initForFetch: RequestInit = {
        method: request.method,
        headers: request.headers as any,
        body: fetchBody,
        signal: controller.signal,
      };
      const response = await fetch(urlForFetch, initForFetch);

      // Apply response interceptors
      const interceptedResponse = await this._applyResponseInterceptors(response);

      if (!interceptedResponse.ok) {
        const allowRetry = isRetryAllowed(method, this._retryConfig, retryCtx);
        const classifierResult = classifyRetry(
          interceptedResponse, method, attempt, this._retryClassifier
        );

        // ── Retryable failure ───────────────────────────────────────────
        if (retries > 0 && allowRetry && classifierResult) {
          const delay = computeDelay(
            attempt, this._retryConfig, this._backoffStrategy, interceptedResponse
          );
          if (this._onRetry) {
            this._onRetry({ attempt, delay, method, url: request.url, reason: 'status', status: interceptedResponse.status });
          }
          if (this._retryConfig.maxElapsedMs && Date.now() - startTime + delay > this._retryConfig.maxElapsedMs) {
            throw new TimeoutError({ elapsedMs: Date.now() - startTime, cause: new Error('maxElapsedMs exceeded') });
          }
          await sleep(delay);

          const nextRequest = buildRetryRequest(request, method, this._retryConfig, retryCtx);

          return this._fetchAndParse(
            nextRequest, responseType, retries - 1, timeout,
            externalSignal, attempt + 1, startTime, retryCtx
          );
        }

        // ── Parse error body ────────────────────────────────────────────
        let errorData;
        try {
          errorData = await interceptedResponse.json();
        } catch {
          errorData = { message: 'Unable to parse error data.' };
        }

        // ── Auth error handling (401 / 403) ─────────────────────────────
        if (interceptedResponse.status === 401 || interceptedResponse.status === 403) {
          const authRetryFn = async (newReq: Request): Promise<Response> => {
            const authBody = resolveBody(retryCtx, newReq);
            const newInit: RequestInit = {
              method: newReq.method,
              headers: newReq.headers as any,
              body: authBody,
              signal: controller.signal,
            };
            return fetch(newReq.url, newInit);
          };

          const authResult = await this._auth.handleAuthError(
            request, interceptedResponse, authRetryFn
          );

          if (authResult instanceof Response) {
            const retryIntercepted = await this._applyResponseInterceptors(authResult);
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
            return parseBody(retryIntercepted, responseType);
          }
          if (authResult === false) {
            throw new Error('Auth strategy halted after auth error.');
          }
        }

        // ── Non-retryable error ─────────────────────────────────────────
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

      // ── Successful response ─────────────────────────────────────────────
      const result = await parseBody(interceptedResponse, responseType);
      if (this._onComplete) this._onComplete({ method, url: request.url, status: interceptedResponse.status, ok: true, attempts: attempt, elapsedMs: Date.now() - startTime });
      return result;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        if (timedOut) {
          throw new TimeoutError({ elapsedMs: Date.now() - startTime, cause: error });
        }
        throw error; // user-cancelled
      }

      // Known library errors — rethrow as-is (do not treat as network error)
      if (error instanceof UnsupportedResponseTypeError || error instanceof FetchError || error instanceof TimeoutError || error instanceof RetryError || error instanceof InterceptorAbortError || error instanceof AuthAbortError) {
        throw error;
      }

      // ── Network error — retry if possible ─────────────────────────────
      const method = request.method.toUpperCase();
      const allowRetry = isRetryAllowed(method, this._retryConfig, retryCtx);
      if (retries > 0 && allowRetry) {
        const delay = computeDelay(
          attempt, this._retryConfig, this._backoffStrategy, undefined, error
        );
        if (this._onRetry) {
          this._onRetry({ attempt, delay, method, url: request.url, reason: 'network' });
        }
        if (this._retryConfig.maxElapsedMs && Date.now() - startTime + delay > this._retryConfig.maxElapsedMs) {
          throw new TimeoutError({ elapsedMs: Date.now() - startTime, cause: new Error('maxElapsedMs exceeded') });
        }
        await sleep(delay);

        const nextRequest = buildRetryRequest(request, method, this._retryConfig, retryCtx);

        return this._fetchAndParse(
          nextRequest, responseType, retries - 1, timeout,
          externalSignal, attempt + 1, startTime, retryCtx
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

  // ── Request orchestration ─────────────────────────────────────────────────

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

    const request = buildRequest({
      baseURL: this.baseURL,
      endpoint,
      method,
      body,
      headers,
      query,
      queryStyle: this._queryStyle,
      defaultHeaders: this.defaultHeaders,
    });

    // ── Request deduplication ──────────────────────────────────────────────
    const methodUpper = method.toUpperCase();
    const bodyKey = DeduplicationCache.serializeBodyForKey(body);
    const dedupeKey = this._dedupeCache.computeKey(
      methodUpper, request.url, bodyKey, this._dedupeKey
    );
    const shouldDedupe = this._dedupeCache.shouldDedupe(
      this._dedupe, methodUpper, !!this._dedupeKey
    );
    if (shouldDedupe) {
      const existing = this._dedupeCache.getExisting<T>(dedupeKey);
      if (existing) return existing;
    }

    const bodyReplayable = isReplayableBody(body);
    const rawBody = preSerializeBody(body);

    const promise = this._fetchAndParse(
      request,
      responseType,
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
      this._dedupeCache.track(dedupeKey, promise);
    }
    return promise;
  }

  // ── HTTP method surface ───────────────────────────────────────────────────

  /**
   * Sends a HEAD request to the specified endpoint.
   */
  async head<T = Response>(options: HeadOptions): Promise<T> {
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
   * Sends a GET request to the specified endpoint.
   * If both `page` and `pageSize` are provided, the method will automatically paginate
   * until it either reaches the `limit` or the response returns fewer items than `pageSize`.
   */
  get(options: GetOptions & { responseType: 'response' }): Promise<Response>;
  get<T = any>(options: GetOptions & { responseType?: Exclude<GetOptions['responseType'], 'response'> }): Promise<T>;
  async get<T = any>(options: GetOptions): Promise<T> {
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

    // ── Page-based pagination ────────────────────────────────────────────
    if (page && pageSize) {
      return paginate<any>({
        ...baseRequestOptions,
        query: originalQuery,
        page,
        pageSize,
        limit,
        maxPages,
        extractor,
        responseType,
      }, (params) => this._request(params)) as Promise<T>;
    }

    // ── Cursor-based pagination ──────────────────────────────────────────
    if (options.cursor !== undefined || options.getNextCursor || options.useLinkHeader) {
      return paginateCursor<any>({
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
      }, (params) => this._request(params), {
        defaultTimeout: this.defaultTimeout,
        defaultRetries: this.defaultRetries,
      }) as Promise<T>;
    }

    // ── Simple GET ───────────────────────────────────────────────────────
    return this._request<T>({
      ...baseRequestOptions,
      query: originalQuery,
    });
  }

  /**
   * Sends a POST request to the specified endpoint with the provided data.
   */
  post(options: PostOptions & { responseType: 'response' }): Promise<Response>;
  post<T = any>(options: PostOptions & { responseType?: Exclude<PostOptions['responseType'], 'response'> }): Promise<T>;
  post<T = any>(options: PostOptions): Promise<T> {
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
      endpoint, method: 'POST', body, headers, query,
      responseType, options: perCallOptions, bodyFactory,
    });
  }

  /**
   * Sends a PUT request to the specified endpoint with the provided data.
   */
  put(options: PutOptions & { responseType: 'response' }): Promise<Response>;
  put<T = any>(options: PutOptions & { responseType?: Exclude<PutOptions['responseType'], 'response'> }): Promise<T>;
  put<T = any>(options: PutOptions): Promise<T> {
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
      endpoint, method: 'PUT', body, headers, query,
      responseType, options: perCallOptions, bodyFactory,
    });
  }

  /**
   * Sends a PATCH request to the specified endpoint with the provided data.
   */
  patch(options: PatchOptions & { responseType: 'response' }): Promise<Response>;
  patch<T = any>(options: PatchOptions & { responseType?: Exclude<PatchOptions['responseType'], 'response'> }): Promise<T>;
  patch<T = any>(options: PatchOptions): Promise<T> {
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
      endpoint, method: 'PATCH', body, headers, query,
      responseType, options: perCallOptions, bodyFactory,
    });
  }

  /**
   * Sends a DELETE request to the specified endpoint.
   */
  delete(options: DeleteOptions & { responseType: 'response' }): Promise<Response>;
  delete<T = any>(options: DeleteOptions & { responseType?: Exclude<DeleteOptions['responseType'], 'response'> }): Promise<T>;
  delete<T = any>(options: DeleteOptions): Promise<T> {
    const {
      endpoint,
      headers = {},
      responseType = 'json',
      options: perCallOptions,
      body,
      query = {},
    } = options;
    return this._request({
      endpoint, method: 'DELETE', body, headers, query,
      responseType, options: perCallOptions,
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

    let request = buildRequest({
      baseURL: this.baseURL,
      endpoint,
      method,
      body,
      headers,
      query,
      queryStyle: this._queryStyle,
      defaultHeaders: this.defaultHeaders,
    });

    if (applyMiddleware) {
      request = await this._applyRequestInterceptors(request);
      request = await this._auth.applyAuthOnRequest(request);
      const response = await fetch(request);
      return this._applyResponseInterceptors(response);
    }

    return fetch(request);
  }

  // ── Configuration ─────────────────────────────────────────────────────────

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
    this._auth.useAuthStrategy(strategy);
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
