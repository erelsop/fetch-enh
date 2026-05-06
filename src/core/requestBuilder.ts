import type { BodyType, QueryValue } from '../types/requestParameters';
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
  query?: Record<string, QueryValue>;
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
  params: Record<string, QueryValue>,
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

/** Headers that must not be forwarded to a different origin on redirect. */
const SENSITIVE_REQUEST_HEADERS = [
  'authorization',
  'cookie',
  'cookie2',
  'proxy-authorization',
];

const MAX_REDIRECTS = 20;

/**
 * Drop-in replacement for `fetch` that performs manual redirect handling so
 * that sensitive request headers (`Authorization`, `Cookie`, etc.) are
 * **stripped** when a redirect leads to a different origin.
 *
 * - Uses `redirect: 'manual'` on every hop.
 * - On a 3xx response, reads the `Location` header (works in Node.js 18+;
 *   returns the raw opaque response in browser environments where Location is
 *   inaccessible, leaving the caller to handle it).
 * - Follows up to {@link MAX_REDIRECTS} hops before throwing.
 * - 303 See Other always switches to GET; 307/308 keep the original method
 *   and body; 301/302 switch to GET (per-spec / browser convention).
 */
export async function safeFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let currentUrl = url;
  let currentMethod = init.method ?? 'GET';
  let currentHeaders = new Headers(init.headers);
  let currentBody: BodyInit | null | undefined = init.body as BodyInit | null | undefined;
  const signal = init.signal;

  for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
    const response = await fetch(currentUrl, {
      method: currentMethod,
      headers: currentHeaders,
      body: currentBody,
      signal,
      redirect: 'manual',
    });

    // Not a redirect — return as-is
    if (response.status < 300 || response.status >= 400) return response;

    // Try to read Location (accessible in Node.js; null for browser opaque-redirects)
    const location = response.headers.get('location');
    if (!location) return response; // can't follow; return opaque response

    let targetURL: URL;
    try {
      targetURL = new URL(location, currentUrl);
    } catch {
      return response; // malformed Location
    }

    const currentOrigin = new URL(currentUrl).origin;
    const isSameOrigin = targetURL.origin === currentOrigin;

    // Strip credentials on cross-origin hops
    const nextHeaders = new Headers(currentHeaders);
    if (!isSameOrigin) {
      for (const h of SENSITIVE_REQUEST_HEADERS) {
        nextHeaders.delete(h);
      }
    }

    // Method switching per RFC 7231 / browser convention:
    //   303 → always GET
    //   301 / 302 → switch to GET (browser convention for non-safe methods)
    //   307 / 308 → keep original method and body
    const switchToGet =
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        currentMethod !== 'GET' &&
        currentMethod !== 'HEAD');

    if (switchToGet) {
      currentMethod = 'GET';
      currentBody = undefined;
    }

    currentUrl = targetURL.toString();
    currentHeaders = nextHeaders;
  }

  throw new Error(`Too many redirects following ${url}`);
}
