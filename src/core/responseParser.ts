import { UnsupportedResponseTypeError } from '../errors/fetchErrors';

/**
 * Parses a successful Response body according to the requested responseType.
 *
 * Status codes 204 (No Content) and 205 (Reset Content) carry no body;
 * attempting to call `.json()` or `.text()` on them throws a `SyntaxError`.
 * For any `responseType` other than `'response'`, this function returns `null`
 * immediately when either of those status codes is encountered.
 */
export async function parseBody(
  response: Response,
  responseType: string
): Promise<JSON | string | Blob | ArrayBuffer | FormData | Response | null> {
  // Empty-body status codes — skip parsing and return null
  if (responseType !== 'response' && (response.status === 204 || response.status === 205)) {
    return null;
  }
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
