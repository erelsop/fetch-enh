import FetchEnh from '../src';
import { FetchError, TimeoutError, UnsupportedResponseTypeError, RetryError } from '../src/errors/fetchErrors';
import fetchMock from 'jest-fetch-mock';

beforeEach(() => {
  fetchMock.resetMocks();
});

describe('Error Handling', () => {
  describe('FetchError', () => {
    test('throws FetchError on 4xx client errors', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
      
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Not found', code: 'NOT_FOUND' }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      );
      
      await expect(api.get({ endpoint: '/missing' })).rejects.toThrow(FetchError);
      
      try {
        await api.get({ endpoint: '/missing' });
      } catch (error) {
        if (error instanceof FetchError) {
          expect(error.response.status).toBe(404);
          expect(error.data).toEqual({ error: 'Not found', code: 'NOT_FOUND' });
        }
      }
    });

    test('throws RetryError on 5xx server errors after retries exhausted', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 2 });
      
      fetchMock
        .mockResponseOnce('', { status: 500 })
        .mockResponseOnce('', { status: 500 })
        .mockResponseOnce('', { status: 500 });
      
      await expect(api.get({ endpoint: '/error' })).rejects.toThrow(RetryError);
      expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    test('includes response data in FetchError', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
      
      fetchMock.mockResponseOnce(
        JSON.stringify({ message: 'Validation failed', fields: ['email'] }),
        { status: 422, headers: { 'content-type': 'application/json' } }
      );
      
      try {
        await api.post({ endpoint: '/users', body: { name: 'Test' } });
      } catch (error) {
        if (error instanceof FetchError) {
          expect(error.data.message).toBe('Validation failed');
          expect(error.data.fields).toEqual(['email']);
        }
      }
    });

    test('handles non-JSON error responses', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
      
      fetchMock.mockResponseOnce('Internal Server Error', { status: 500 });
      
      try {
        await api.get({ endpoint: '/error' });
      } catch (error) {
        if (error instanceof FetchError) {
          expect(error.data.message).toBe('Unable to parse error data.');
        }
      }
    });
  });

  describe('TimeoutError', () => {
    test('throws TimeoutError when request times out', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultTimeout: 100 });
      
      fetchMock.mockResponseOnce(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return JSON.stringify({ data: 'late' });
        }
      );
      
      await expect(api.get({ endpoint: '/slow' })).rejects.toThrow(TimeoutError);
    });

    test('per-request timeout overrides default', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultTimeout: 5000 });
      
      fetchMock.mockResponseOnce(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 150));
          return JSON.stringify({ data: 'late' });
        }
      );
      
      await expect(
        api.get({ endpoint: '/slow', options: { timeout: 100 } })
      ).rejects.toThrow(TimeoutError);
    });
  });

  describe('UnsupportedResponseTypeError', () => {
    test('throws UnsupportedResponseTypeError for invalid response type', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await expect(
        api.get({ endpoint: '/data', responseType: 'invalid' as any })
      ).rejects.toThrow(UnsupportedResponseTypeError);
    });
  });

  describe('Network Errors', () => {
    test('retries on network errors', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 2 });
      
      fetchMock
        .mockRejectOnce(new Error('Network error'))
        .mockRejectOnce(new Error('Network error'))
        .mockResponseOnce(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      
      const result = await api.get({ endpoint: '/data', responseType: 'auto' });
      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    test('throws RetryError when all network retries fail', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 2 });
      
      fetchMock
        .mockRejectOnce(new Error('Network error'))
        .mockRejectOnce(new Error('Network error'))
        .mockRejectOnce(new Error('Network error'));
      
      await expect(api.get({ endpoint: '/data' })).rejects.toThrow(RetryError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('Edge Cases', () => {
    test('handles empty response body', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      fetchMock.mockResponseOnce('', { status: 204 });
      
      const result = await api.delete({ endpoint: '/resource/1', responseType: 'text' });
      expect(result).toBe('');
    });

    test('handles response without content-type in auto mode', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      fetchMock.mockResponseOnce('plain text', { status: 200, headers: { 'content-type': 'text/plain' } });
      
      const result = await api.get({ endpoint: '/data', responseType: 'auto' });
      expect(typeof result).toBe('string');
      expect(result).toBe('plain text');
    });

    test('handles FormData body', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      const formData = new FormData();
      formData.append('file', new Blob(['content'], { type: 'text/plain' }), 'test.txt');
      formData.append('name', 'Test File');
      
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.post({ endpoint: '/upload', body: formData });
      
      // Just verify the request was made successfully
      expect(fetchMock).toHaveBeenCalled();
    });

    test('handles Blob body', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      const blob = new Blob(['binary content'], { type: 'application/octet-stream' });
      
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.post({ endpoint: '/upload', body: blob });
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.get('Content-Type')).toBe('application/octet-stream');
    });

    test('handles ArrayBuffer body', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      const buffer = new ArrayBuffer(8);
      
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.post({ endpoint: '/upload', body: buffer });
      
      expect(fetchMock).toHaveBeenCalled();
    });

    test('handles plain string body', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.post({ endpoint: '/text', body: 'plain text content' });
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.get('Content-Type')).toBe('text/plain;charset=UTF-8');
    });

    test('automatically stringifies objects', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.post({ endpoint: '/data', body: { name: 'Test', value: 123 } });
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(fetchMock).toHaveBeenCalled();
    });

    test('handles valid query params only', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.get({
        endpoint: '/search',
        query: {
          a: 'value',
          d: 'another',
          page: 1
        }
      });
      
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('a=value');
      expect(url).toContain('d=another');
      expect(url).toContain('page=1');
    });

    test('handles URL without baseURL', async () => {
      const api = new FetchEnh({ baseURL: '' });
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.get({ endpoint: 'https://external-api.com/data' });
      
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toBe('https://external-api.com/data');
    });

    test('serializes Date as ISO in query', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      const d = new Date(Date.UTC(2025, 0, 2, 3, 4, 5));
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      await api.get({ endpoint: '/q', responseType: 'auto', query: { when: d } });
      const url = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
      expect(url).toContain('when=2025-01-02T03:04:05.000Z');
    });

    test('merges query params with existing query string', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.get({
        endpoint: '/search?existing=param',
        query: { new: 'value' }
      });
      
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('existing=param');
      expect(url).toContain('new=value');
    });
  });

  describe('New Error Model', () => {
    test('FetchError has structured metadata and toJSON', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0 });
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'nope' }), { status: 400, headers: { 'content-type': 'application/json', 'x-request-id': 'req-123' } });
      try {
        await api.get({ endpoint: '/err' });
      } catch (e: any) {
        expect(e).toBeInstanceOf(FetchError);
        const j = e.toJSON();
        expect(j.code).toBe('EHTTP');
        expect(j.status).toBe(400);
        expect(j.url).toContain('/err');
        expect(j.requestId).toBe('req-123');
      }
    });

    test('RetryError has structured metadata and toJSON', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 1 });
      fetchMock.mockRejectOnce(new Error('offline')).mockRejectOnce(new Error('offline'));
      try {
        await api.get({ endpoint: '/x' });
      } catch (e: any) {
        expect(e).toBeInstanceOf(RetryError);
        const j = e.toJSON();
        expect(j.code).toBe('ERETRY');
        expect(j.attempts).toBeGreaterThan(0);
        expect(j.url).toContain('/x');
      }
    });
  });

  describe('Hooks', () => {
    test('onRetry is called with attempt and delay on 5xx', async () => {
      const calls: any[] = [];
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 1, onRetry: (info) => calls.push(info) });
      fetchMock
        .mockResponseOnce('', { status: 500 })
        .mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      await api.get({ endpoint: '/hook' });
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0].reason).toBe('status');
      expect(calls[0].attempt).toBe(1);
    });
  });

  describe('onComplete hook', () => {
    test('onComplete called on success with status and ok=true', async () => {
      const calls: any[] = [];
      const api = new FetchEnh({ baseURL: 'https://api.test', onComplete: (info) => calls.push(info) });
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      await api.get({ endpoint: '/ok', responseType: 'json' });
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const last = calls[calls.length - 1];
      expect(last.ok).toBe(true);
      expect(last.status).toBe(200);
    });

    test('onComplete called on error with ok=false and status', async () => {
      const calls: any[] = [];
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 0, onComplete: (info) => calls.push(info) });
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'nope' }), { status: 404, headers: { 'content-type': 'application/json' } });
      await expect(api.get({ endpoint: '/missing' })).rejects.toBeTruthy();
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const last = calls[calls.length - 1];
      expect(last.ok).toBe(false);
      expect(last.status).toBe(404);
    });
  });

  describe('Replayability and unsafe retries', () => {
    test('POST Blob 5xx does not retry without bodyFactory and unsafe config', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 1 });
      const blob = new Blob(['x'], { type: 'text/plain' });
      fetchMock
        .mockResponseOnce('', { status: 500 })
        .mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      await expect(api.post({ endpoint: '/upload', body: blob })).rejects.toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(1); // no retry
    });

    test('POST with bodyFactory retries and attaches Idempotency-Key', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 1 });
      api.setRetryBehavior(
        { shouldRetry: ({ response }) => !!response && response.status >= 500 },
        { computeDelay: () => 1 },
        { idempotentOnly: false, allowUnsafeRetries: true, idempotencyKeyFactory: () => 'idem-xyz' }
      );
      fetchMock
        .mockResponseOnce('', { status: 500 })
        .mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      await api.post({ endpoint: '/data', body: { a: 1 }, bodyFactory: () => ({ a: 1 }) });
      const secondHeaders = fetchMock.mock.calls[1][1]?.headers as any;
      expect(secondHeaders.get('Idempotency-Key')).toBe('idem-xyz');
    });
  });

  describe('Retry Configuration', () => {
    test('respects idempotentOnly config for POST requests (no retries on 5xx without opt-in)', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 2 });
      // Default behavior: don't retry non-idempotent methods
      fetchMock.mockResponseOnce('', { status: 500 });
      await expect(api.post({ endpoint: '/data', body: {} })).rejects.toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('allows custom retry behavior', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 2 });
      api.setRetryBehavior(
        {
          shouldRetry: ({ response }) => {
            // Custom: only retry 503
            return response ? response.status === 503 : false;
          },
        },
        {
          computeDelay: () => 10,
        }
      );
      // 500 should NOT retry with custom classifier
      fetchMock
        .mockResponseOnce('', { status: 500 })
        .mockResponseOnce('', { status: 500 });
      await expect(api.get({ endpoint: '/data' })).rejects.toThrow();
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);

      fetchMock.resetMocks();
      // 503 SHOULD retry
      fetchMock
        .mockResponseOnce('', { status: 503 })
        .mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      const result = await api.get({ endpoint: '/data', responseType: 'auto' });
      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('injects Idempotency-Key on POST retries when idempotencyKeyFactory is set', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 1 });
      api.setRetryBehavior(
        { shouldRetry: ({ response }) => !!response && response.status >= 500 },
        { computeDelay: () => 10 },
        { idempotencyKeyFactory: () => 'key-123', idempotentOnly: false, allowUnsafeRetries: true }
      );
      fetchMock
        .mockResponseOnce('', { status: 500 })
        .mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      await api.post({ endpoint: '/data', body: { x: 1 } });
      // Second call should have Idempotency-Key
      const headers2 = fetchMock.mock.calls[1][1]?.headers as any;
      expect(headers2.get('Idempotency-Key')).toBe('key-123');
    });

    test('network errors do not retry for POST when idempotentOnly is true', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 2 });
      fetchMock
        .mockRejectOnce(new Error('Network error'))
        .mockRejectOnce(new Error('Network error'));
      await expect(api.post({ endpoint: '/data', body: {} })).rejects.toThrow('Network error');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('respects Retry-After header (parses header and retries)', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test', defaultRetries: 1 });
      fetchMock
        .mockResponseOnce('', { status: 429, headers: { 'retry-after': '0' } })
        .mockResponseOnce(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      await api.get({ endpoint: '/data', responseType: 'auto' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('Configuration', () => {
    test('setConfig updates instance configuration', async () => {
      const api = new FetchEnh({ baseURL: 'https://api1.test' });
      
      api.setConfig({
        baseURL: 'https://api2.test',
        defaultHeaders: { 'X-Custom': 'Header' }
      });
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      await api.get({ endpoint: '/data' });
      
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('api2.test');
      
      const headers = fetchMock.mock.calls[0][1]?.headers as any;
      expect(headers.get('X-Custom')).toBe('Header');
    });
  });

  describe('Request Cancellation', () => {
    test('already aborted signal throws AbortError immediately', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      const controller = new AbortController();
      controller.abort();
      
      await expect(
        api.get({
          endpoint: '/data',
          options: { signal: controller.signal }
        })
      ).rejects.toHaveProperty('name', 'AbortError');
    });

    test('signal is passed to fetch options', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      const controller = new AbortController();
      
      fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      
      const result = await api.get({
        endpoint: '/data',
        options: {
          signal: controller.signal,
          timeout: 5000,
          retries: 2
        }
      });
      
      expect(result).toEqual({ ok: true });
      // Verify signal was passed to fetch
      const fetchCall = fetchMock.mock.calls[0][1];
      expect(fetchCall).toHaveProperty('signal');
    });

    test('multiple requests with same controller', async () => {
      const api = new FetchEnh({ baseURL: 'https://api.test' });
      const controller = new AbortController();
      
      fetchMock
        .mockResponseOnce(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
        .mockResponseOnce(JSON.stringify({ id: 2 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      
      const result1 = await api.get({
        endpoint: '/data/1',
        options: { signal: controller.signal }
      });
      
      const result2 = await api.get({
        endpoint: '/data/2',
        options: { signal: controller.signal }
      });
      
      expect(result1).toEqual({ id: 1 });
      expect(result2).toEqual({ id: 2 });
    });
  });
});
