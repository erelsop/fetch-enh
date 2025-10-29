import type { RequestOptions } from './requestOptions';

export type BodyType = FormData | Blob | ArrayBuffer | URLSearchParams | string | object;

export interface RequestParameters {
  endpoint: string;
  method?: string;
  body?: BodyType;
  headers?: Record<string, string>;
  query?: Record<string, any>;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData' | 'response' | 'auto' | string;
  options?: RequestOptions;
  bodyFactory?: () => BodyType; // for retries with non-replayable bodies
}
