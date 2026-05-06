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
  let results: unknown[] = [];
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
      const pageItems: unknown[] = Array.isArray(response)
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

  return (limit ? results.slice(0, limit) : results) as T[];
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
  let results: unknown[] = [];
  let iterations = 0;

  while (true) {
    const q = { ...query } as any;
    if (cursor) q[cursorParamName] = cursor;

    let pageItems: unknown[] = [];
    let nextCursor: string | null = null;

    if (useLinkHeader) {
      const perCallOpts = {
        timeout: perCallOptions?.timeout ?? defaults.defaultTimeout,
        retries: perCallOptions?.retries ?? defaults.defaultRetries,
        signal: perCallOptions?.signal,
      };
      const res = await requestFn({
        endpoint,
        method: 'GET',
        headers,
        query: q,
        responseType: 'response',
        options: perCallOpts,
      } as any);
      const data = await res.clone().json().catch(() => []);
      pageItems = Array.isArray(data) ? data : (extractor ? extractor(data) : []);
      nextCursor = getNextCursor ? getNextCursor(data, res.headers) : parseLinkHeaderForNextCursor(res.headers, cursorParamName);
    } else if (getNextCursor) {
      const perCallOpts = {
        timeout: perCallOptions?.timeout ?? defaults.defaultTimeout,
        retries: perCallOptions?.retries ?? defaults.defaultRetries,
        signal: perCallOptions?.signal,
      };
      const res = await requestFn({
        endpoint,
        method: 'GET',
        headers,
        query: q,
        responseType: 'response',
        options: perCallOpts,
      } as any);
      const data = await res.clone().json().catch(() => []);
      pageItems = Array.isArray(data) ? data : (extractor ? extractor(data) : []);
      nextCursor = getNextCursor(data, res.headers);
    } else {
      const perCallOpts = {
        timeout: perCallOptions?.timeout ?? defaults.defaultTimeout,
        retries: perCallOptions?.retries ?? defaults.defaultRetries,
        signal: perCallOptions?.signal,
      };
      const resp: unknown = await requestFn({
        endpoint,
        method: 'GET',
        headers,
        query: q,
        responseType,
        options: perCallOpts,
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

  return (limit ? results.slice(0, limit) : results) as T[];
}
