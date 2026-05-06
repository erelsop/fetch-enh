import FetchEnh from '../src';
import fetchMock from 'jest-fetch-mock';

beforeEach(() => {
  fetchMock.resetMocks();
});

test('head returns Response', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  fetchMock.mockResponseOnce('', { status: 204 });
  const res = await api.head({ endpoint: '/head' });
  expect(res.status).toBe(204);
});

test('auto returns binary as ArrayBuffer for octet-stream', async () => {
  const api = new FetchEnh({ baseURL: 'https://api.test' });
  fetchMock.mockResponseOnce('BINARY', { status: 200, headers: { 'content-type': 'application/octet-stream' } });
  const res = await api.get({ endpoint: '/bin', responseType: 'auto' });
  const ab = res as ArrayBuffer;
  expect(ab && typeof (ab as any).byteLength === 'number').toBe(true);
});
