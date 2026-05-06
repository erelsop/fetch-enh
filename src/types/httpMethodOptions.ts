import type { RequestOptions } from './requestOptions';
import type { QueryValue, ResponseType, BodyType } from './requestParameters';

export interface HeadOptions {
  endpoint: string;
  headers?: Record<string, string>;
  query?: Record<string, QueryValue>;
}

export interface PaginateOptions {
  endpoint: string;
  headers: Record<string, string>;
  query: Record<string, QueryValue>;
  responseType: ResponseType;
  page: number;
  pageSize: number;
  limit?: number;
  maxPages?: number;
  method?: string;
  options?: RequestOptions;
  extractor?: (pageData: unknown) => unknown[];
}

export interface GetOptions {
  endpoint: string;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  responseType?: ResponseType;
  // Page-based pagination
  page?: number;
  pageSize?: number;
  limit?: number;
  extractor?: (pageData: unknown) => unknown[];
  maxPages?: number;
  // Cursor-based pagination
  cursor?: string | null;
  cursorParamName?: string; // default 'cursor'
  getNextCursor?: (response: unknown, headers: Headers) => string | null;
  useLinkHeader?: boolean; // parse Link: rel="next"; extract next cursor param
  options?: RequestOptions;
}

/**
 * Shared base for mutating HTTP methods (POST, PUT, PATCH).
 * Consolidates the common fields so divergence between the three interfaces
 * cannot occur silently.
 */
export interface MutationOptions {
  endpoint: string;
  body: BodyType;
  headers?: Record<string, string>;
  responseType?: ResponseType;
  options?: RequestOptions;
  bodyFactory?: () => BodyType;
  /** Optional query parameters appended to the URL alongside the request body. */
  query?: Record<string, QueryValue>;
}

export interface PostOptions extends MutationOptions {}
export interface PutOptions extends MutationOptions {}
export interface PatchOptions extends MutationOptions {}

export interface DeleteOptions {
  endpoint: string;
  headers?: Record<string, string>;
  responseType?: ResponseType;
  options?: RequestOptions;
  /** Optional request body (e.g. for batch-delete APIs that accept a body). */
  body?: BodyType;
  /** Optional query parameters appended to the URL. */
  query?: Record<string, QueryValue>;
}

export interface RawOptions {
  endpoint: string;
  method?: string;
  body?: BodyType;
  headers?: Record<string, string>;
  query?: Record<string, QueryValue>;
  bodyFactory?: () => BodyType;
  /** When `true`, request interceptors, auth strategies, and response interceptors are applied before/after the fetch. Defaults to `false`. */
  applyMiddleware?: boolean;
}
