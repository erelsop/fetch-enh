import type { RequestOptions } from './requestOptions';

export interface HeadOptions {
  endpoint: string;
  headers?: Record<string, string>;
  query?: Record<string, any>;
}

export interface PaginateOptions {
  endpoint: string;
  headers: Record<string, string>;
  query: Record<string, any>;
  responseType: string;
  page: number;
  pageSize: number;
  limit?: number;
  method?: string;
  options?: RequestOptions;
  extractor?: (pageData: any) => any[];
}

export interface GetOptions {
  endpoint: string;
  query?: Record<string, any>;
  headers?: Record<string, string>;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData' | 'response' | 'auto' | string;
  // Page-based pagination
  page?: number;
  pageSize?: number;
  limit?: number;
  extractor?: (pageData: any) => any[];
  // Cursor-based pagination
  cursor?: string | null;
  cursorParamName?: string; // default 'cursor'
  getNextCursor?: (response: any, headers: Headers) => string | null;
  useLinkHeader?: boolean; // parse Link: rel="next"; extract next cursor param
  options?: RequestOptions;
}

export interface PostOptions {
  endpoint: string;
  body: object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  headers?: Record<string, string>;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData' | 'response' | 'auto' | string;
  options?: RequestOptions;
  bodyFactory?: () => object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
}

export interface PutOptions {
  endpoint: string;
  body: object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  headers?: Record<string, string>;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData' | 'response' | 'auto' | string;
  options?: RequestOptions;
  bodyFactory?: () => object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
}

export interface PatchOptions {
  endpoint: string;
  body: object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  headers?: Record<string, string>;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData' | 'response' | 'auto' | string;
  options?: RequestOptions;
  bodyFactory?: () => object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
}

export interface DeleteOptions {
  endpoint: string;
  headers?: Record<string, string>;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData' | 'response' | 'auto' | string;
  options?: RequestOptions;
}

export interface RawOptions {
  endpoint: string;
  method?: string;
  body?: object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  headers?: Record<string, string>;
  query?: Record<string, any>;
  bodyFactory?: () => object | string | FormData | Blob | ArrayBuffer | URLSearchParams;
  /** When `true`, request interceptors, auth strategies, and response interceptors are applied before/after the fetch. Defaults to `false`. */
  applyMiddleware?: boolean;
}
