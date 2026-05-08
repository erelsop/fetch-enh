import type { BodyType } from '../types/requestParameters';

export interface RetryContext {
  method: string;
  bodyFactory?: () => BodyType;
  bodyReplayable?: boolean;
  rawBody?: BodyInit | null;
}

/**
 * Returns the value of `name` from `headers` using a case-insensitive lookup.
 * The Fetch spec normalises header names to lowercase; this helper lets us
 * inspect the in-memory `Record<string, string>` consistently regardless of
 * the casing the user passed in.
 */
function getHeaderCaseInsensitive(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return undefined;
}

/**
 * Deletes every key in `headers` whose lowercase form matches `name`.
 */
function deleteHeaderCaseInsensitive(
  headers: Record<string, string>,
  name: string,
): void {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) delete headers[k];
  }
}

/**
 * Sets `name` on `headers` if no equivalent (case-insensitive) key already
 * exists. When a matching key is present, its value is preserved verbatim so
 * the caller's casing wins.
 */
function setHeaderIfAbsentCaseInsensitive(
  headers: Record<string, string>,
  name: string,
  value: string,
): void {
  if (getHeaderCaseInsensitive(headers, name) === undefined) {
    headers[name] = value;
  }
}

/**
 * Mutates the provided `headers` object to set an appropriate `Content-Type`
 * based on the runtime type of `body`.
 *
 * - FormData                → deletes the header (the runtime sets the
 *                             multipart boundary).
 * - Blob with type          → uses the blob's MIME type.
 * - string                  → defaults to `text/plain;charset=UTF-8` when no
 *                             header is already present.
 * - boolean / number        → defaults to `application/json` (the type
 *                             contract `BodyType ⊃ JsonValue ⊃ JsonPrimitive`
 *                             promises JSON encoding).
 * - plain object            → defaults to `application/json` when no header
 *                             is already present.
 *
 * All Content-Type lookups are case-insensitive so a user-supplied
 * `'content-type'` (lowercase) is honoured the same as `'Content-Type'`.
 */
export function setContentTypeHeader(
  body: BodyType,
  headers: Record<string, string>,
): void {
  if (body instanceof FormData) {
    deleteHeaderCaseInsensitive(headers, 'Content-Type');
  } else if (body instanceof Blob && body.type) {
    // Preserve the original "Blob.type wins" semantics: the runtime needs to
    // know the blob's MIME type to frame the request correctly. Use a
    // case-insensitive delete first so we don't accidentally leave both
    // `'content-type'` (user) and `'Content-Type'` (us) in the in-memory
    // record — the Request constructor would then collapse them into the
    // same lowercase slot with implementation-defined precedence.
    deleteHeaderCaseInsensitive(headers, 'Content-Type');
    headers['Content-Type'] = body.type;
  } else if (typeof body === 'string') {
    setHeaderIfAbsentCaseInsensitive(headers, 'Content-Type', 'text/plain;charset=UTF-8');
  } else if (typeof body === 'boolean' || typeof body === 'number') {
    setHeaderIfAbsentCaseInsensitive(headers, 'Content-Type', 'application/json');
  } else if (
    typeof body === 'object' &&
    body !== null &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof Blob) &&
    !(body instanceof URLSearchParams) &&
    !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  ) {
    setHeaderIfAbsentCaseInsensitive(headers, 'Content-Type', 'application/json');
  }
}

/**
 * Serialises a body value for transmission.
 *
 * - Plain objects and arrays are JSON-stringified.
 * - JSON primitives (`boolean` / `number`) are JSON-stringified so the
 *   runtime sees `'true'` / `'42'` rather than the string-coerced form a
 *   raw `Request` constructor would produce.
 * - Every other supported type (FormData, Blob, ArrayBuffer, URLSearchParams,
 *   string, ReadableStream) is returned unchanged.
 */
export function serializeBody(body: BodyType): BodyType | string {
  if (typeof body === 'boolean' || typeof body === 'number') {
    return JSON.stringify(body);
  }
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
  // boolean / number / object — all replayable.
  return true;
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
    if (typeof f === 'boolean' || typeof f === 'number') {
      return JSON.stringify(f);
    }
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
 * - Plain objects are JSON-stringified.
 * - JSON primitives (`boolean` / `number`) are JSON-stringified.
 * - `undefined` / `null` map to `undefined` (no body).
 * - All other types pass through unchanged.
 */
export function preSerializeBody(
  body: BodyType | undefined,
): BodyInit | null | undefined {
  if (body == null) return undefined;
  if (typeof body === 'boolean' || typeof body === 'number') {
    return JSON.stringify(body);
  }
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
