import FetchEnh from '../src';
import fetchMock from 'jest-fetch-mock';

beforeEach(() => {
  fetchMock.resetMocks();
});

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  userId: number;
  title: string;
  body: string;
}

describe('Generic TypeScript Support', () => {
  test('GET with generic type returns typed response', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    
    const mockUser: User = {
      id: 1,
      name: 'John Doe',
      email: 'john@example.com'
    };
    
    fetchMock.mockResponseOnce(JSON.stringify(mockUser), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    
    const user = await api.get<User>({ endpoint: '/users/1' });
    
    // TypeScript should infer user as User type
    expect(user.id).toBe(1);
    expect(user.name).toBe('John Doe');
    expect(user.email).toBe('john@example.com');
  });

  test('GET with array generic type returns typed array', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    
    const mockUsers: User[] = [
      { id: 1, name: 'John', email: 'john@example.com' },
      { id: 2, name: 'Jane', email: 'jane@example.com' }
    ];
    
    fetchMock.mockResponseOnce(JSON.stringify(mockUsers), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    
    const users = await api.get<User[]>({ endpoint: '/users' });
    
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBe(2);
    expect(users[0].name).toBe('John');
  });

  test('POST with generic type returns typed response', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    
    const newPost: Post = {
      id: 1,
      userId: 1,
      title: 'Test Post',
      body: 'This is a test'
    };
    
    fetchMock.mockResponseOnce(JSON.stringify(newPost), {
      status: 201,
      headers: { 'content-type': 'application/json' }
    });
    
    const post = await api.post<Post>({
      endpoint: '/posts',
      body: { title: 'Test Post', body: 'This is a test', userId: 1 }
    });
    
    expect(post.id).toBe(1);
    expect(post.title).toBe('Test Post');
  });

  test('PUT with generic type returns typed response', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    
    const updatedUser: User = {
      id: 1,
      name: 'John Updated',
      email: 'john@example.com'
    };
    
    fetchMock.mockResponseOnce(JSON.stringify(updatedUser), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    
    const user = await api.put<User>({
      endpoint: '/users/1',
      body: { name: 'John Updated', email: 'john@example.com' }
    });
    
    expect(user.name).toBe('John Updated');
  });

  test('PATCH with generic type returns typed response', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    
    const patchedUser: User = {
      id: 1,
      name: 'John Patched',
      email: 'john@example.com'
    };
    
    fetchMock.mockResponseOnce(JSON.stringify(patchedUser), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    
    const user = await api.patch<User>({
      endpoint: '/users/1',
      body: { name: 'John Patched' }
    });
    
    expect(user.name).toBe('John Patched');
  });

  test('DELETE with generic type returns typed response', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    
    interface DeleteResponse {
      success: boolean;
      message: string;
    }
    
    const mockResponse: DeleteResponse = {
      success: true,
      message: 'User deleted'
    };
    
    fetchMock.mockResponseOnce(JSON.stringify(mockResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    
    const response = await api.delete<DeleteResponse>({ endpoint: '/users/1' });
    
    expect(response.success).toBe(true);
    expect(response.message).toBe('User deleted');
  });

  test('HEAD returns Response directly', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    
    fetchMock.mockResponseOnce('', { status: 200 });
    
    const response = await api.head({ endpoint: '/users/1' });
    
    // Should return Response object
    expect(response).toBeDefined();
  });

  test('Generic type works with pagination', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    
    const page1: User[] = [
      { id: 1, name: 'User 1', email: 'user1@example.com' },
      { id: 2, name: 'User 2', email: 'user2@example.com' }
    ];
    
    const page2: User[] = [
      { id: 3, name: 'User 3', email: 'user3@example.com' }
    ];
    
    fetchMock
      .mockResponseOnce(JSON.stringify(page1), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
      .mockResponseOnce(JSON.stringify(page2), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    
    const allUsers = await api.get<User[]>({
      endpoint: '/users',
      page: 1,
      pageSize: 2,
      limit: 5
    });
    
    expect(Array.isArray(allUsers)).toBe(true);
    expect(allUsers.length).toBe(3);
  });

  test('Generic type with custom response structure', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    
    interface ApiResponse<T> {
      data: T;
      status: number;
      message: string;
    }
    
    const mockResponse: ApiResponse<User> = {
      data: { id: 1, name: 'John', email: 'john@example.com' },
      status: 200,
      message: 'Success'
    };
    
    fetchMock.mockResponseOnce(JSON.stringify(mockResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    
    const response = await api.get<ApiResponse<User>>({ endpoint: '/users/1' });
    
    expect(response.status).toBe(200);
    expect(response.data.name).toBe('John');
    expect(response.message).toBe('Success');
  });

  test('Generic type with different response types', async () => {
    const api = new FetchEnh({ baseURL: 'https://api.test' });
    
    // Text response
    fetchMock.mockResponseOnce('Hello World', {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
    
    const text = await api.get<string>({
      endpoint: '/text',
      responseType: 'text'
    });
    
    expect(text).toBe('Hello World');
  });
});
