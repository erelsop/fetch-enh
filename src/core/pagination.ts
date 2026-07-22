import type { RequestParameters, QueryValue, ResponseType } from '../types/requestParameters';
import type { PaginateOptions } from '../types/httpMethodOptions';
import type { RequestOptions } from '../types/requestOptions';
import { UnsupportedResponseTypeError, PaginationLimitError } from '../errors/fetchErrors';

/**
 * Built-in safety cap applied when the caller does not pass an explicit
 * `maxPages`. Reaching it while more data is still available throws a
 * {@link PaginationLimitError} rather than silently truncating — see that
 * class for the rationale.
 */
export const DEFAULT_MAX_PAGES = 100;

export function parseLinkHeaderForNextCursor(headers: Headers, cursorParamName: string): string | null {
  const link = headers.get('link'); // Headers.get() is case-insensitive per Fetch spec
  if (!link) return null;
  for (const section of link.split(',')) {
    const trimmed = section.trim();
    const urlMatch = trimmed.match(/^<([^>]+)>/);
    if (!urlMatch) continue;
    const params = trimmed.slice(urlMatch[0].length).split(';').slice(1);
    let rels: string[] | null = null;
    for (const p of params) {
      const eq = p.indexOf('=');
      if (eq < 0) continue;
      const name = p.slice(0, eq).trim().toLowerCase();
      let value = p.slice(eq + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (name === 'rel') {
        rels = value.split(/\s+/);
        break;
      }
    }
    if (!rels?.includes('next')) continue;
    try {
      // Use a placeholder base so both absolute and relative Link URLs work.
      const url = new URL(urlMatch[1], 'https://placeholder.invalid');
      return url.searchParams.get(cursorParamName) || url.searchParams.get('page') || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Returns a signal that aborts when any of the provided signals abort.
 *
 * Delegates to the platform-native `AbortSignal.any()` (Node.js ≥20,
 * Chrome 116+, Firefox 124+).
 *
 * @internal
 */
function composeSignals(signals: AbortSignal[]): AbortSignal {
  return AbortSignal.any(signals);
}

export async function paginate<T = any>(
  options: PaginateOptions,
  requestFn: (params: RequestParameters) => Promise<any>
): Promise<T[]> {
  const results: T[] = [];
  for await (const page of paginateIter<T>(options, requestFn)) {
    results.push(...page);
  }
  const { limit } = options;
  return limit ? results.slice(0, limit) : results;
}

/**
 * Async generator variant of {@link paginate}.
 *
 * Yields one page of results at a time so callers can process data
 * incrementally without buffering the entire result set in memory.
 *
 * An internal `AbortController` is wired into every per-page request. When
 * the generator is closed early (via `break`, `return`, or `throw` inside a
 * `for await` loop), the `finally` block fires and aborts the in-flight
 * request so that bandwidth and server-side work are not wasted.
 *
 * @example
 * for await (const page of paginateIter(opts, requestFn)) {
 *   processPage(page);
 * }
 */
export async function* paginateIter<T = any>(
  options: PaginateOptions,
  requestFn: (params: RequestParameters) => Promise<any>
): AsyncGenerator<T[]> {
  const {
    endpoint,
    method,
    headers,
    query,
    responseType,
    page,
    pageSize,
    limit,
    maxPages: explicitMaxPages,
    extractor,
    options: callOptions,
  } = options;

  // Distinguish a caller-supplied cap (opt-in: stop silently at N) from the
  // built-in safety cap (throw on overflow rather than truncate silently).
  const capIsExplicit = explicitMaxPages !== undefined;
  const maxPages = explicitMaxPages ?? DEFAULT_MAX_PAGES;

  // Pagination only works for JSON responses. Fail fast rather than silently
  // yielding zero pages, which would be indistinguishable from an empty result.
  if (responseType !== 'json') {
    throw new UnsupportedResponseTypeError(
      `paginateIter requires responseType: 'json' (received: '${responseType}')`
    );
  }

  // Create an internal AbortController that fires when the generator is closed
  // early (break / return / throw inside a for-await loop). This cancels the
  // in-flight per-page request so bandwidth and server-side work are not wasted.
  const internalController = new AbortController();
  const userSignal = callOptions?.signal;
  const signal: AbortSignal = userSignal
    ? composeSignals([userSignal, internalController.signal])
    : internalController.signal;

  let currentPage = page;
  let totalYielded = 0;
  let iterations = 0;

  try {
    while (true) {
      const currentQuery = {
        ...query,
        page: currentPage.toString(),
        pageSize: pageSize.toString(),
      };

      const response = await requestFn({
        endpoint,
        method,
        headers,
        query: currentQuery,
        responseType,
        options: { ...callOptions, signal },
      });

      if (responseType === 'json') {
        const pageItems: T[] = Array.isArray(response)
          ? response
          : extractor
            ? (extractor(response) as T[])
            : [];
        if (!Array.isArray(pageItems) || pageItems.length === 0) break;

        if (limit) {
          const remaining = limit - totalYielded;
          const toYield = pageItems.slice(0, remaining);
          yield toYield;
          totalYielded += toYield.length;
          if (totalYielded >= limit) break;
        } else {
          yield pageItems;
        }

        // A short page means the server has no more data — natural, silent end.
        if (pageItems.length < pageSize) break;
        // A full page means more data likely remains. If we've hit the cap here,
        // truncating would silently drop records: throw unless the caller opted
        // into an explicit maxPages.
        if (++iterations >= maxPages) {
          if (!capIsExplicit) throw new PaginationLimitError(maxPages);
          break;
        }
        currentPage++;
      } else {
        break;
      }
    }
  } finally {
    // Fires on normal completion AND on early close (break / return / throw).
    // Aborting an already-settled request is a no-op, so this is always safe.
    internalController.abort();
  }
}

export interface CursorPaginateParams {
  endpoint: string;
  headers?: Record<string, string>;
  query?: Record<string, QueryValue>;
  responseType?: ResponseType;
  limit?: number;
  maxPages?: number;
  cursor?: string | null;
  cursorParamName?: string;
  getNextCursor?: (response: unknown, headers: Headers) => string | null;
  useLinkHeader?: boolean;
  extractor?: (response: unknown) => unknown[];
  options?: RequestOptions;
}

export async function paginateCursor<T = any>(
  params: CursorPaginateParams,
  requestFn: (params: RequestParameters) => Promise<any>,
  defaults: { defaultTimeout: number; defaultRetries: number }
): Promise<T[]> {
  const results: T[] = [];
  for await (const page of paginateCursorIter<T>(params, requestFn, defaults)) {
    results.push(...page);
  }
  const { limit } = params;
  return limit ? results.slice(0, limit) : results;
}

/**
 * Async generator variant of {@link paginateCursor}.
 *
 * Yields one page of results at a time.  JSON parse failures are propagated
 * as errors rather than silently swallowed, giving callers an accurate signal
 * that the server returned malformed data.
 *
 * An internal `AbortController` is wired into every per-page request. When
 * the generator is closed early (via `break`, `return`, or `throw` inside a
 * `for await` loop), the `finally` block fires and aborts the in-flight
 * request so that bandwidth and server-side work are not wasted.
 */
export async function* paginateCursorIter<T = any>(
  params: CursorPaginateParams,
  requestFn: (params: RequestParameters) => Promise<any>,
  defaults: { defaultTimeout: number; defaultRetries: number }
): AsyncGenerator<T[]> {
  const {
    endpoint,
    headers = {},
    query = {},
    responseType = 'json',
    limit,
    maxPages: explicitMaxPages,
    cursor: initialCursor = null,
    cursorParamName = 'cursor',
    getNextCursor,
    useLinkHeader,
    extractor,
    options: perCallOptions,
  } = params;

  // Distinguish a caller-supplied cap (opt-in: stop silently at N) from the
  // built-in safety cap (throw on overflow rather than truncate silently).
  const capIsExplicit = explicitMaxPages !== undefined;
  const maxPages = explicitMaxPages ?? DEFAULT_MAX_PAGES;

  // Pagination only works for JSON responses regardless of which cursor
  // strategy (`useLinkHeader`, `getNextCursor`, or plain) is in use. Fail
  // fast at function entry rather than letting the `useLinkHeader ||
  // getNextCursor` branch surface a confusing `SyntaxError` from
  // `res.clone().json()` further down the loop.
  if (responseType !== 'json') {
    throw new UnsupportedResponseTypeError(
      `paginateCursorIter requires responseType: 'json' (received: '${responseType}')`
    );
  }

  // Create an internal AbortController that fires when the generator is closed
  // early (break / return / throw inside a for-await loop).
  const internalController = new AbortController();
  const userSignal = perCallOptions?.signal;
  const signal: AbortSignal = userSignal
    ? composeSignals([userSignal, internalController.signal])
    : internalController.signal;

  let cursor = initialCursor;
  let totalYielded = 0;
  let iterations = 0;

  try {
    while (true) {
      const q = { ...query } as any;
      if (cursor) q[cursorParamName] = cursor;

      let pageItems: T[] = [];
      let nextCursor: string | null = null;

      const perCallOpts = {
        timeout: perCallOptions?.timeout ?? defaults.defaultTimeout,
        retries: perCallOptions?.retries ?? defaults.defaultRetries,
        signal,
        retry: perCallOptions?.retry,
      };

      if (useLinkHeader || getNextCursor) {
        // The Headers-aware branches must request the raw `Response` so we
        // can read the `Link` header (or hand it to `getNextCursor`). The
        // upfront `responseType !== 'json'` guard above already ensures the
        // user opted into JSON parsing; passing `responseType: 'response'`
        // here is purely an internal implementation detail.
        const res = await requestFn({
          endpoint,
          method: 'GET',
          headers,
          query: q,
          responseType: 'response',
          options: perCallOpts,
        } as any);
        const data = await res.clone().json();
        pageItems = (Array.isArray(data) ? data : (extractor ? extractor(data) : [])) as T[];
        nextCursor = getNextCursor
          ? getNextCursor(data, res.headers)
          : parseLinkHeaderForNextCursor(res.headers, cursorParamName);
      } else {
        const resp: unknown = await requestFn({
          endpoint,
          method: 'GET',
          headers,
          query: q,
          responseType,
          options: perCallOpts,
        });
        pageItems = (Array.isArray(resp) ? resp : (extractor ? extractor(resp) : [])) as T[];
      }

      if (!Array.isArray(pageItems) || pageItems.length === 0) break;

      if (limit) {
        const remaining = limit - totalYielded;
        const toYield = pageItems.slice(0, remaining);
        yield toYield;
        totalYielded += toYield.length;
        if (totalYielded >= limit) break;
      } else {
        yield pageItems;
      }

      // No next cursor means the server has no more data — natural, silent end.
      if (!nextCursor) break;
      // A next cursor means more data remains. If we've hit the cap here,
      // truncating would silently drop records: throw unless the caller opted
      // into an explicit maxPages.
      if (++iterations >= maxPages) {
        if (!capIsExplicit) throw new PaginationLimitError(maxPages);
        break;
      }
      cursor = nextCursor;
    }
  } finally {
    // Fires on normal completion AND on early close (break / return / throw).
    internalController.abort();
  }
}
