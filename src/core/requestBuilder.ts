import type { BodyType } from '../types/requestParameters';
import { setContentTypeHeader, serializeBody } from './bodyUtils';

export interface QueryStyle {
  array: 'brackets' | 'repeat' | 'comma';
  object: 'brackets' | 'dot';
}

export interface BuildRequestParams {
  baseURL: string;
  endpoint: string;
  method: string;
  body?: BodyType;
  headers?: Record<string, string>;
  query?: Record<string, any>;
  queryStyle: QueryStyle;
  defaultHeaders: Record<string, string>;
}

/**
 * Joins a base URL with an endpoint path, inserting a `/` separator when the
 * endpoint does not already start with one.
 */
export function formatEndpoint(baseURL: string, endpoint: string): string {
  return `${baseURL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

/**
 * Serializes a record of query parameters into a URL-encoded query string.
 *
 * Handles arrays (brackets / repeat / comma styles), nested objects
 * (brackets / dot styles), Dates (ISO 8601), and primitive values.
 */
export function serializeQuery(
  params: Record<string, any>,
  queryStyle: QueryStyle,
): string {
  const parts: string[] = [];

  const append = (key: string, value: any) => {
    if (value === undefined || value === null) return;
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  };

  const joinComma = (key: string, arr: any[]) =>
    append(key, arr.map(String).join(','));

  const keyJoin = (parent: string, child: string) =>
    queryStyle.object === 'dot'
      ? `${parent}.${child}`
      : `${parent}[${child}]`;

  const build = (keyPrefix: string, value: any) => {
    if (Array.isArray(value)) {
      if (queryStyle.array === 'comma') {
        joinComma(keyPrefix, value);
      } else if (queryStyle.array === 'repeat') {
        value.forEach((v: any) => append(keyPrefix, v));
      } else {
        value.forEach((v: any) => append(`${keyPrefix}[]`, v));
      }
    } else if (value instanceof Date) {
      append(keyPrefix, value.toISOString());
    } else if (
      typeof value === 'object' &&
      value !== null &&
      !(value instanceof Blob)
    ) {
      Object.entries(value).forEach(([k, v]) =>
        build(keyJoin(keyPrefix, k), v),
      );
    } else {
      append(keyPrefix, value);
    }
  };

  Object.entries(params).forEach(([k, v]) => build(k, v));
  return parts.join('&');
}

/**
 * Constructs a fully-formed `Request` object from the given parameters.
 *
 * Responsibilities:
 * - Resolves the final URL via `formatEndpoint` + `serializeQuery`.
 * - Merges default headers with per-request headers.
 * - Delegates body serialization to `bodyUtils` (`setContentTypeHeader` /
 *   `serializeBody`).
 */
export function buildRequest(params: BuildRequestParams): Request {
  const {
    baseURL,
    endpoint,
    method,
    body,
    headers = {},
    query = {},
    queryStyle,
    defaultHeaders,
  } = params;

  let urlString: string;

  if (baseURL) {
    const url = new URL(formatEndpoint(baseURL, endpoint));
    const q = serializeQuery(query, queryStyle);
    if (q) {
      const separator = url.search ? '&' : '?';
      urlString = `${url.toString()}${separator}${q}`;
    } else {
      urlString = url.toString();
    }
  } else {
    const queryString = serializeQuery(query, queryStyle);
    if (queryString) {
      urlString = `${endpoint}${endpoint.includes('?') ? '&' : '?'}${queryString}`;
    } else {
      urlString = endpoint;
    }
  }

  const combinedHeaders: Record<string, string> = {
    ...defaultHeaders,
    ...headers,
  };

  let adjustedBody: BodyType | undefined = body;
  if (body) {
    setContentTypeHeader(body, combinedHeaders);
    adjustedBody = serializeBody(body);
  }

  return new Request(urlString, {
    method,
    headers: combinedHeaders,
    body: adjustedBody as any,
  });
}
