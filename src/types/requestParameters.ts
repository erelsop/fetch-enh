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
  endpoint: string;
  method?: string;
  body?: BodyType;
  headers?: Record<string, string>;
  query?: Record<string, QueryValue>;
  responseType?: ResponseType;
  options?: RequestOptions;
  bodyFactory?: () => BodyType; // for retries with non-replayable bodies
}
