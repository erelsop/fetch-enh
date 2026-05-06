import type { RequestParameters, QueryValue, ResponseType } from '../types/requestParameters';
import type { PaginateOptions } from '../types/httpMethodOptions';
import type { RequestOptions } from '../types/requestOptions';

export function parseLinkHeaderForNextCursor(headers: Headers, cursorParamName: string): string | null {
  const link = headers.get('link') || headers.get('Link');
  if (!link) return null;
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
  let totalYielded = 0;
  let iterations = 0;

  while (true) {
    const currentQuery = {
      ...query,
      page: currentPage.toString(),
      pageSize: pageSize.toString(),
    };

    const response = await requestFn({
      ...options,
      query: currentQuery,
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

      if (pageItems.length < pageSize || ++iterations >= maxPages) break;
      currentPage++;
    } else {
      break;
    }
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
    maxPages = 100,
    cursor: initialCursor = null,
    cursorParamName = 'cursor',
    getNextCursor,
    useLinkHeader,
    extractor,
    options: perCallOptions,
  } = params;

  let cursor = initialCursor;
  let totalYielded = 0;
  let iterations = 0;

  while (true) {
    const q = { ...query } as any;
    if (cursor) q[cursorParamName] = cursor;

    let pageItems: T[] = [];
    let nextCursor: string | null = null;

    const perCallOpts = {
      timeout: perCallOptions?.timeout ?? defaults.defaultTimeout,
      retries: perCallOptions?.retries ?? defaults.defaultRetries,
      signal: perCallOptions?.signal,
      retry: perCallOptions?.retry,
    };

    if (useLinkHeader || getNextCursor) {
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
      if (responseType === 'json') {
        pageItems = (Array.isArray(resp) ? resp : (extractor ? extractor(resp) : [])) as T[];
      }
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

    if (!nextCursor || ++iterations >= maxPages) break;
    cursor = nextCursor;
  }
}
