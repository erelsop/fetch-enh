import { UnsupportedResponseTypeError } from '../errors/fetchErrors';

/**
 * Parses a successful Response body according to the requested responseType.
 */
export async function parseBody(
  response: Response,
  responseType: string
): Promise<JSON | string | Blob | ArrayBuffer | FormData | Response> {
  switch (responseType) {
    case 'json': return response.json();
    case 'text': return response.text();
    case 'blob': return response.blob();
    case 'arrayBuffer': return response.arrayBuffer();
    case 'formData': return response.formData();
    case 'response': return response;
    case 'auto': {
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('application/json')) return response.json();
      if (ct.startsWith('text/')) return response.text();
      if (ct.includes('application/octet-stream')) return response.arrayBuffer();
      return response; // fallback: caller handles opaque response
    }
    default:
      throw new UnsupportedResponseTypeError(responseType);
  }
}
