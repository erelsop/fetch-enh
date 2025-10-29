import fetchMock from 'jest-fetch-mock';
import 'whatwg-fetch';

fetchMock.enableMocks();
(global as any).fetch = fetchMock as any;
