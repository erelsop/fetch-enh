import type { BodyType } from '../types/requestParameters';

export interface RetryContext {
  method: string;
  bodyFactory?: () => BodyType;
  bodyReplayable?: boolean;
  rawBody?: BodyInit | null;
}

/**
 * Mutates the provided `headers` object to set an appropriate `Content-Type`
 * based on the runtime type of `body`.
 *
 * - FormData        → deletes the header (the browser sets the multipart boundary)
 * - Blob with type  → uses the blob's MIME type
 * - string          → defaults to `text/plain;charset=UTF-8` when no header is present
 * - plain object    → defaults to `application/json` when no header is present
 */
export function setContentTypeHeader(
  body: BodyType,
  headers: Record<string, string>,
): void {
  if (body instanceof FormData) {
    delete headers['Content-Type'];
  } else if (body instanceof Blob && body.type) {
    headers['Content-Type'] = body.type;
  } else if (typeof body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'text/plain;charset=UTF-8';
  } else if (
    typeof body === 'object' &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof Blob) &&
    !(body instanceof URLSearchParams) &&
    !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  ) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
}

/**
 * Serialises a body value for transmission.
 * Plain objects are JSON-stringified; every other supported type is returned
 * as-is (FormData, Blob, ArrayBuffer, URLSearchParams, string).
 */
export function serializeBody(body: BodyType): BodyType | string {
  if (
    typeof body === 'object' &&
    body !== null &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof URLSearchParams) &&
    !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  ) {
    return JSON.stringify(body);
  }
  return body;
}

/**
 * Returns `true` when the body can be safely replayed across retries without
 * consuming it.  Streaming bodies (`ReadableStream`) are the only
 * non-replayable type.
 */
export function isReplayableBody(body: BodyType | undefined): boolean {
  if (body == null) return true;
  if (typeof body === 'string') return true;
  if (body instanceof URLSearchParams) return true;
  if (body instanceof ArrayBuffer) return true;
  if (body instanceof Blob) return true;
  if (body instanceof FormData) return true;
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return false;
  if (typeof body === 'object') return true;
  return false;
}

/**
 * Resolves the body to use for a (possibly retried) request.
 *
 * Resolution order:
 * 1. If `retryCtx.bodyFactory` exists, invoke it and serialise the result.
 * 2. If `retryCtx.rawBody` is set, use it directly.
 * 3. Fall back to the body already attached to the `Request` object.
 */
export function resolveBody(
  retryCtx: RetryContext | undefined,
  request: Request,
): BodyInit | null | undefined {
  if (retryCtx?.bodyFactory) {
    const f = retryCtx.bodyFactory();
    return (
      typeof f === 'object' &&
      f !== null &&
      !(f instanceof FormData) &&
      !(f instanceof Blob) &&
      !(f instanceof ArrayBuffer) &&
      !(f instanceof URLSearchParams) &&
      !(typeof ReadableStream !== 'undefined' && f instanceof ReadableStream)
    )
      ? JSON.stringify(f)
      : (f as BodyInit);
  }
  if (retryCtx?.rawBody !== undefined) {
    return retryCtx.rawBody;
  }
  // rawBody is undefined only when no body was provided
  return null;
}

/**
 * Pre-serialises a body value so that a replayable copy can be stored before
 * the original `Request` is created.
 *
 * Plain objects are JSON-stringified; `undefined`/`null` maps to `undefined`;
 * all other types pass through unchanged.
 */
export function preSerializeBody(
  body: BodyType | undefined,
): BodyInit | null | undefined {
  if (body == null) return undefined;
  if (
    typeof body === 'object' &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof URLSearchParams) &&
    !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  ) {
    return JSON.stringify(body);
  }
  return body as BodyInit;
}
