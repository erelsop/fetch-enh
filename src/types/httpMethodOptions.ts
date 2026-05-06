import type { RequestOptions } from './requestOptions';
import type { QueryValue, ResponseType, BodyType } from './requestParameters';

export interface HeadOptions {
  readonly endpoint: string;
  readonly headers?: Record<string, string>;
  readonly query?: Record<string, QueryValue>;
}

export interface PaginateOptions {
  readonly endpoint: string;
  readonly headers: Record<string, string>;
  readonly query: Record<string, QueryValue>;
  readonly responseType: ResponseType;
  readonly page: number;
  readonly pageSize: number;
  readonly limit?: number;
  readonly maxPages?: number;
  readonly method?: string;
  readonly options?: RequestOptions;
  readonly extractor?: (pageData: unknown) => unknown[];
}

export interface GetOptions {
  readonly endpoint: string;
  readonly query?: Record<string, QueryValue>;
  readonly headers?: Record<string, string>;
  readonly responseType?: ResponseType;
  // Page-based pagination
  readonly page?: number;
  readonly pageSize?: number;
  readonly limit?: number;
  readonly extractor?: (pageData: unknown) => unknown[];
  readonly maxPages?: number;
  // Cursor-based pagination
  readonly cursor?: string | null;
  readonly cursorParamName?: string; // default 'cursor'
  readonly getNextCursor?: (response: unknown, headers: Headers) => string | null;
  readonly useLinkHeader?: boolean; // parse Link: rel="next"; extract next cursor param
  readonly options?: RequestOptions;
}

/**
 * Shared base for mutating HTTP methods (POST, PUT, PATCH).
 * Consolidates the common fields so divergence between the three interfaces
 * cannot occur silently.
 */
export interface MutationOptions {
  readonly endpoint: string;
  readonly body: BodyType;
  readonly headers?: Record<string, string>;
  readonly responseType?: ResponseType;
  readonly options?: RequestOptions;
  readonly bodyFactory?: () => BodyType;
  /** Optional query parameters appended to the URL alongside the request body. */
  readonly query?: Record<string, QueryValue>;
}

export interface PostOptions extends MutationOptions {}
export interface PutOptions extends MutationOptions {}
export interface PatchOptions extends MutationOptions {}

export interface DeleteOptions {
  readonly endpoint: string;
  readonly headers?: Record<string, string>;
  readonly responseType?: ResponseType;
  readonly options?: RequestOptions;
  /** Optional request body (e.g. for batch-delete APIs that accept a body). */
  readonly body?: BodyType;
  /** Optional query parameters appended to the URL. */
  readonly query?: Record<string, QueryValue>;
}

export interface RawOptions {
  readonly endpoint: string;
  readonly method?: string;
  readonly body?: BodyType;
  readonly headers?: Record<string, string>;
  readonly query?: Record<string, QueryValue>;
  readonly bodyFactory?: () => BodyType;
  /** When `true`, request interceptors, auth strategies, and response interceptors are applied before/after the fetch. Defaults to `false`. */
  readonly applyMiddleware?: boolean;
  /** Optional AbortSignal to cancel the raw request. */
  readonly signal?: AbortSignal;
}
