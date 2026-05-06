import type { RequestOptions } from './requestOptions';

/** Primitive types accepted as individual query parameter values. */
export type QueryPrimitive = string | number | boolean | Date;

/**
 * A query parameter value accepted by the serializer.
 * Supports primitives, arrays of primitives, one level of nested objects
 * (for bracket/dot notation), and null/undefined (which are omitted).
 */
export type QueryValue =
  | QueryPrimitive
  | QueryPrimitive[]
  | Record<string, QueryPrimitive | QueryPrimitive[]>
  | null
  | undefined;

export type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData' | 'response' | 'auto';

/** JSON-serialisable primitive values. */
export type JsonPrimitive = string | number | boolean | null;

/**
 * A JSON-serialisable value: primitives, arrays of values, or plain objects
 * whose values are themselves JSON values.
 *
 * Using `JsonValue` in {@link BodyType} prevents exotic types (`Date`, `Map`,
 * `Set`, class instances, etc.) from being silently `JSON.stringify`-ed into
 * unexpected output (e.g. `new Map()` → `{}`; `new Date()` → a string).
 * Consumers that need to send such values must serialise them manually and
 * pass a `string` body instead.
 */
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Union of all body types accepted by the HTTP methods.
 *
 * - `FormData` / `Blob` / `ArrayBuffer` / `URLSearchParams` — passed through as-is.
 * - `ReadableStream` — passed through as-is; **non-replayable** (retries are
 *   skipped; supply `bodyFactory` to enable retries with streaming bodies).
 * - `JsonValue` — plain objects, arrays, and JSON primitives are
 *   `JSON.stringify`-ed before the request is issued.
 */
export type BodyType =
  | FormData
  | Blob
  | ArrayBuffer
  | URLSearchParams
  | ReadableStream
  | JsonValue;

export interface RequestParameters {
  readonly endpoint: string;
  readonly method?: string;
  readonly body?: BodyType;
  readonly headers?: Record<string, string>;
  readonly query?: Record<string, QueryValue>;
  readonly responseType?: ResponseType;
  readonly options?: RequestOptions;
  readonly bodyFactory?: () => BodyType; // for retries with non-replayable bodies
}
