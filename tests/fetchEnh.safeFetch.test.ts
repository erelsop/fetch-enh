import fetchMock from 'jest-fetch-mock';
import { safeFetch } from '../src/core/requestBuilder';

beforeEach(() => {
  fetchMock.resetMocks();
});

describe('safeFetch redirect handling', () => {
  test('non-redirect response is returned as-is', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const res = await safeFetch('https://api.test/path', { method: 'GET', headers: new Headers() });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/path');
  });

  test('follows 302 redirect to absolute Location URL', async () => {
    fetchMock
      .mockResponseOnce('', { status: 302, headers: { location: 'https://api.test/final' } })
      .mockResponseOnce(JSON.stringify({ done: true }), { status: 200, headers: { 'content-type': 'application/json' } });

    const res = await safeFetch('https://api.test/original', { method: 'GET', headers: new Headers() });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/final');
  });

  test('resolves relative Location URL against current URL', async () => {
    fetchMock
      .mockResponseOnce('', { status: 301, headers: { location: '/new-path' } })
      .mockResponseOnce('{}', { status: 200 });

    await safeFetch('https://api.test/old', { method: 'GET', headers: new Headers() });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/new-path');
  });

  test('302 on GET preserves GET method', async () => {
    fetchMock
      .mockResponseOnce('', { status: 302, headers: { location: 'https://api.test/next' } })
      .mockResponseOnce('{}', { status: 200 });

    await safeFetch('https://api.test/start', { method: 'GET', headers: new Headers() });
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(secondInit.method).toBe('GET');
  });

  test('301 on POST switches to GET (browser convention)', async () => {
    fetchMock
      .mockResponseOnce('', { status: 301, headers: { location: 'https://api.test/result' } })
      .mockResponseOnce('{}', { status: 200 });

    await safeFetch('https://api.test/submit', {
      method: 'POST',
      body: 'payload',
      headers: new Headers({ 'content-type': 'text/plain' }),
    });
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(secondInit.method).toBe('GET');
    expect(secondInit.body).toBeUndefined();
  });

  test('302 on POST switches to GET (browser convention)', async () => {
    fetchMock
      .mockResponseOnce('', { status: 302, headers: { location: 'https://api.test/result' } })
      .mockResponseOnce('{}', { status: 200 });

    await safeFetch('https://api.test/submit', {
      method: 'POST',
      body: 'payload',
      headers: new Headers(),
    });
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(secondInit.method).toBe('GET');
    expect(secondInit.body).toBeUndefined();
  });

  test('303 always switches to GET regardless of original method', async () => {
    fetchMock
      .mockResponseOnce('', { status: 303, headers: { location: 'https://api.test/result' } })
      .mockResponseOnce('{}', { status: 200 });

    await safeFetch('https://api.test/action', {
      method: 'POST',
      body: 'data',
      headers: new Headers(),
    });
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(secondInit.method).toBe('GET');
    expect(secondInit.body).toBeUndefined();
  });

  test('307 preserves original method and body', async () => {
    fetchMock
      .mockResponseOnce('', { status: 307, headers: { location: 'https://api.test/new' } })
      .mockResponseOnce('{}', { status: 200 });

    await safeFetch('https://api.test/original', {
      method: 'POST',
      body: 'payload',
      headers: new Headers(),
    });
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(secondInit.method).toBe('POST');
    expect(secondInit.body).toBe('payload');
  });

  test('308 preserves original method and body', async () => {
    fetchMock
      .mockResponseOnce('', { status: 308, headers: { location: 'https://api.test/permanent' } })
      .mockResponseOnce('{}', { status: 200 });

    await safeFetch('https://api.test/original', {
      method: 'PUT',
      body: JSON.stringify({ x: 1 }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(secondInit.method).toBe('PUT');
    expect(secondInit.body).toBe(JSON.stringify({ x: 1 }));
  });

  test('same-origin redirect preserves Authorization header', async () => {
    fetchMock
      .mockResponseOnce('', { status: 302, headers: { location: 'https://api.test/final' } })
      .mockResponseOnce('{}', { status: 200 });

    await safeFetch('https://api.test/original', {
      method: 'GET',
      headers: new Headers({ authorization: 'Bearer secret', 'x-custom': 'keep' }),
    });
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Headers;
    expect(secondHeaders.get('authorization')).toBe('Bearer secret');
    expect(secondHeaders.get('x-custom')).toBe('keep');
  });

  test('cross-origin redirect strips authorization header', async () => {
    fetchMock
      .mockResponseOnce('', { status: 302, headers: { location: 'https://other.com/api' } })
      .mockResponseOnce('{}', { status: 200 });

    await safeFetch('https://api.test/original', {
      method: 'GET',
      headers: new Headers({ authorization: 'Bearer secret', 'x-custom': 'keep' }),
    });
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Headers;
    expect(secondHeaders.get('authorization')).toBeNull();
    expect(secondHeaders.get('x-custom')).toBe('keep');
  });

  test('cross-origin redirect strips cookie and proxy-authorization headers', async () => {
    fetchMock
      .mockResponseOnce('', { status: 302, headers: { location: 'https://cdn.example.com/asset' } })
      .mockResponseOnce('{}', { status: 200 });

    await safeFetch('https://api.test/original', {
      method: 'GET',
      headers: new Headers({
        cookie: 'session=abc',
        'proxy-authorization': 'Basic xyz',
        'accept-language': 'en',
      }),
    });
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Headers;
    expect(secondHeaders.get('cookie')).toBeNull();
    expect(secondHeaders.get('proxy-authorization')).toBeNull();
    expect(secondHeaders.get('accept-language')).toBe('en');
  });

  test('returns redirect response when Location header is absent', async () => {
    fetchMock.mockResponseOnce('', { status: 302 }); // no Location

    const res = await safeFetch('https://api.test/original', { method: 'GET', headers: new Headers() });
    expect(res.status).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('returns redirect response when Location is a malformed URL', async () => {
    fetchMock.mockResponseOnce('', {
      status: 301,
      headers: { location: 'not-a-valid-url://::-1/???' },
    });

    const res = await safeFetch('https://api.test/original', { method: 'GET', headers: new Headers() });
    expect(res.status).toBe(301);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('throws after exceeding MAX_REDIRECTS (21 hops)', async () => {
    // MAX_REDIRECTS = 20; the loop runs hops 0..20 (21 iterations), then throws.
    for (let i = 0; i <= 20; i++) {
      fetchMock.mockResponseOnce('', {
        status: 302,
        headers: { location: 'https://api.test/loop' },
      });
    }

    await expect(
      safeFetch('https://api.test/loop', { method: 'GET', headers: new Headers() })
    ).rejects.toThrow('Too many redirects');

    expect(fetchMock).toHaveBeenCalledTimes(21);
  });

  test('4xx response is returned without following', async () => {
    fetchMock.mockResponseOnce('Not Found', { status: 404 });

    const res = await safeFetch('https://api.test/missing', { method: 'GET', headers: new Headers() });
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // body-framing headers must be stripped when switching to GET
  test('POST→GET switch on 303 strips Content-Type and Content-Length headers', async () => {
    fetchMock
      .mockResponseOnce('', { status: 303, headers: { location: 'https://api.test/final' } })
      .mockResponseOnce(JSON.stringify({ done: true }), { status: 200, headers: { 'content-type': 'application/json' } });

    const initHeaders = new Headers({
      'Content-Type': 'application/json',
      'Content-Length': '42',
      'Transfer-Encoding': 'chunked',
    });

    await safeFetch('https://api.test/submit', {
      method: 'POST',
      headers: initHeaders,
      body: JSON.stringify({ x: 1 }),
    });

    const redirectedInit = fetchMock.mock.calls[1][1] as RequestInit;
    const redirectedHeaders = redirectedInit.headers as Headers;
    expect(redirectedInit.method).toBe('GET');
    expect(redirectedHeaders.has('content-type')).toBe(false);
    expect(redirectedHeaders.has('content-length')).toBe(false);
    expect(redirectedHeaders.has('transfer-encoding')).toBe(false);
  });

  test('POST→GET switch on 301 strips body-framing headers', async () => {
    fetchMock
      .mockResponseOnce('', { status: 301, headers: { location: 'https://api.test/moved' } })
      .mockResponseOnce('{}', { status: 200 });

    const initHeaders = new Headers({ 'Content-Type': 'application/json', 'Content-Length': '10' });
    await safeFetch('https://api.test/original', { method: 'POST', headers: initHeaders, body: '{"x":1}' });

    const redirectedHeaders = fetchMock.mock.calls[1][1]?.headers as Headers;
    expect(redirectedHeaders.has('content-type')).toBe(false);
    expect(redirectedHeaders.has('content-length')).toBe(false);
  });
});
