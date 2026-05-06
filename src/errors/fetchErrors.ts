
/**
 * Represents a fetch-related error containing the response and any error data.
 * @extends Error
 */
export class FetchError extends Error {
  code: string;
  response: Response;
  data: any;
  status: number;
  url: string;
  headers: Headers;
  method?: string;
  attempts?: number;
  elapsedMs?: number;
  requestId?: string;

  constructor(response: Response, data: any, meta?: { method?: string; url?: string; attempts?: number; elapsedMs?: number; requestId?: string }) {
    super(`HTTP error! Status: ${response.status}. Message: ${data?.message || JSON.stringify(data)}`);
    this.code = 'EHTTP';
    this.response = response;
    this.data = data;
    this.status = response.status;
    this.url = meta?.url || response.url;
    this.headers = response.headers;
    this.method = meta?.method;
    this.attempts = meta?.attempts;
    this.elapsedMs = meta?.elapsedMs;
    this.requestId = meta?.requestId;
  }

  toJSON() {
    return {
      name: 'FetchError',
      code: this.code,
      message: this.message,
      status: this.status,
      method: this.method,
      url: this.url,
      attempts: this.attempts,
      elapsedMs: this.elapsedMs,
      requestId: this.requestId,
      data: this.data,
    };
  }
}

/**
 * Represents an error for unsupported response types.
 * @extends Error
 */
export class UnsupportedResponseTypeError extends Error {
  constructor(type: string) {
    super(`Unsupported response type: ${type}`);
  }
}

/**
 * Represents a timeout error when a request times out.
 * @extends Error
 */
export class TimeoutError extends Error {
  code: string;
  elapsedMs?: number;
  cause?: unknown;

  constructor(params?: { elapsedMs?: number; cause?: unknown; message?: string }) {
    super(params?.message || 'Request timed out.');
    this.code = 'ETIMEDOUT';
    this.elapsedMs = params?.elapsedMs;
    if (params?.cause !== undefined) {
      // Preserve cause in environments that support Error.cause
      try {
        this.cause = params.cause;
      } catch {
        // ignore
      }
    }
  }

  toJSON() {
    return {
      name: 'TimeoutError',
      message: this.message,
      code: this.code,
      elapsedMs: this.elapsedMs,
    };
  }
}

/**
 * Represents an error when a request fails after several retries.
 * @extends Error
 */
export class RetryError extends Error {
  code: string;
  attempts: number;
  causeError?: unknown;
  method?: string;
  url?: string;
  elapsedMs?: number;

  constructor(attempts: number, causeError?: unknown, meta?: { method?: string; url?: string; elapsedMs?: number }) {
    super(`Request failed after ${attempts} attempts.`);
    this.code = 'ERETRY';
    this.attempts = attempts;
    this.causeError = causeError;
    this.method = meta?.method;
    this.url = meta?.url;
    this.elapsedMs = meta?.elapsedMs;
  }

  toJSON() {
    return {
      name: 'RetryError',
      code: this.code,
      message: this.message,
      attempts: this.attempts,
      method: this.method,
      url: this.url,
      elapsedMs: this.elapsedMs,
      causeError: this.causeError instanceof Error
        ? { name: this.causeError.name, message: this.causeError.message }
        : this.causeError,
    };
  }
}

/**
 * Thrown when a request or response interceptor returns `false` to halt the chain.
 * Kept separate from plain `Error` so the retry loop in `_fetchAndParse` does not
 * treat it as a transient network failure and re-attempt the request.
 */
export class InterceptorAbortError extends Error {
  code: string;
  constructor(message?: string) {
    super(message ?? 'Interceptor halted request.');
    this.name = 'InterceptorAbortError';
    this.code = 'EINTERCEPTOR_ABORT';
  }
}

/**
 * Thrown when an auth strategy returns `false` from `onRequest` to halt the request.
 * Kept separate from plain `Error` so the retry loop in `_fetchAndParse` does not
 * treat it as a transient network failure and re-attempt the request.
 */
export class AuthAbortError extends Error {
  code: string;
  constructor(message?: string) {
    super(message ?? 'Auth strategy halted request.');
    this.name = 'AuthAbortError';
    this.code = 'EAUTH_ABORT';
  }
}
