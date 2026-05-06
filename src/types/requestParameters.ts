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

export type BodyType = FormData | Blob | ArrayBuffer | URLSearchParams | string | object;

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
