import type { RequestOptions } from './requestOptions';
import type { QueryValue, ResponseType } from './requestParameters';

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

export interface PostOptions {
  endpoint: string;
  body: object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  headers?: Record<string, string>;
  responseType?: ResponseType;
  options?: RequestOptions;
  bodyFactory?: () => object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  /** Optional query parameters appended to the URL alongside the request body. */
  query?: Record<string, QueryValue>;
}

export interface PutOptions {
  endpoint: string;
  body: object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  headers?: Record<string, string>;
  responseType?: ResponseType;
  options?: RequestOptions;
  bodyFactory?: () => object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  /** Optional query parameters appended to the URL alongside the request body. */
  query?: Record<string, QueryValue>;
}

export interface PatchOptions {
  endpoint: string;
  body: object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  headers?: Record<string, string>;
  responseType?: ResponseType;
  options?: RequestOptions;
  bodyFactory?: () => object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  /** Optional query parameters appended to the URL alongside the request body. */
  query?: Record<string, QueryValue>;
}

export interface DeleteOptions {
  endpoint: string;
  headers?: Record<string, string>;
  responseType?: ResponseType;
  options?: RequestOptions;
  /** Optional request body (e.g. for batch-delete APIs that accept a body). */
  body?: object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  /** Optional query parameters appended to the URL. */
  query?: Record<string, QueryValue>;
}

export interface RawOptions {
  endpoint: string;
  method?: string;
  body?: object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  headers?: Record<string, string>;
  query?: Record<string, QueryValue>;
  bodyFactory?: () => object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  /** When `true`, request interceptors, auth strategies, and response interceptors are applied before/after the fetch. Defaults to `false`. */
  applyMiddleware?: boolean;
}
