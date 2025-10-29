/**
 * New Features in v4.0.0
 * 
 * Demonstrates the latest features added in version 4.0.0:
 * - Generic TypeScript support
 * - AbortController support
 * - Enhanced type exports
 */

import FetchEnh from 'fetch-enh';
import type { RetryClassifier, BackoffStrategy } from 'fetch-enh';

// Example 1: Generic TypeScript Support
async function genericTypeExample() {
  console.log('=== Generic TypeScript Support ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });

  // Define your types
  interface User {
    id: number;
    name: string;
    email: string;
    phone: string;
  }

  interface Post {
    id: number;
    userId: number;
    title: string;
    body: string;
  }

  try {
    // Get a single user with type safety
    const user = await api.get<User>({ endpoint: '/users/1' });
    console.log('User:', user.name, user.email); // TypeScript knows these properties exist
    
    // Get multiple users
    const users = await api.get<User[]>({ endpoint: '/users' });
    console.log(`Fetched ${users.length} users`);
    users.forEach(u => console.log(`  - ${u.name}`));

    // Create a new post with type safety
    const newPost = await api.post<Post>({
      endpoint: '/posts',
      body: {
        title: 'My New Post',
        body: 'This is the content',
        userId: 1
      }
    });
    console.log('\nCreated post:', newPost.id, '-', newPost.title);

    // Update with type safety
    const updatedUser = await api.put<User>({
      endpoint: '/users/1',
      body: {
        id: 1,
        name: 'Updated Name',
        email: 'updated@example.com',
        phone: '555-1234'
      }
    });
    console.log('Updated user:', updatedUser.name);

  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 2: Complex Generic Types
async function complexGenericExample() {
  console.log('\n=== Complex Generic Types ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://api.example.com' });

  // API wrapper response
  interface ApiResponse<T> {
    data: T;
    status: number;
    message: string;
    timestamp: string;
  }

  // Paginated response
  interface PaginatedResponse<T> {
    items: T[];
    page: number;
    perPage: number;
    total: number;
    hasMore: boolean;
  }

  interface Product {
    id: string;
    name: string;
    price: number;
  }

  try {
    // Wrapped API response
    const response = await api.get<ApiResponse<Product>>({ 
      endpoint: '/products/123' 
    });
    console.log('Product:', response.data.name, '$' + response.data.price);
    console.log('Status:', response.status, response.message);

    // Paginated response
    const paginatedProducts = await api.get<PaginatedResponse<Product>>({
      endpoint: '/products',
      query: { page: 1, limit: 20 }
    });
    console.log(`Page ${paginatedProducts.page} of products:`);
    paginatedProducts.items.forEach(p => console.log(`  - ${p.name}: $${p.price}`));
    console.log(`Total: ${paginatedProducts.total}, Has more: ${paginatedProducts.hasMore}`);

  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 3: AbortController Support
async function abortControllerExample() {
  console.log('\n=== AbortController Support ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });

  try {
    // Create an AbortController
    const controller = new AbortController();

    // Start a request
    const requestPromise = api.get({
      endpoint: '/users',
      options: {
        signal: controller.signal
      }
    });

    // Abort after 100ms if needed (simulating user cancellation)
    setTimeout(() => {
      console.log('Aborting request...');
      // controller.abort(); // Uncomment to actually abort
    }, 100);

    const users = await requestPromise;
    console.log(`Fetched ${users.length} users successfully`);

  } catch (error: any) {
    if (error.name === 'AbortError' || error.message.includes('abort')) {
      console.log('Request was cancelled by user');
    } else {
      console.error('Error:', error);
    }
  }
}

// Example 4: AbortController with Multiple Requests
async function abortMultipleRequestsExample() {
  console.log('\n=== Abort Multiple Requests ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });
  const controller = new AbortController();

  try {
    // Start multiple requests with the same controller
    const requests = [
      api.get({ endpoint: '/users', options: { signal: controller.signal } }),
      api.get({ endpoint: '/posts', options: { signal: controller.signal } }),
      api.get({ endpoint: '/comments', options: { signal: controller.signal } })
    ];

    // Simulate aborting all requests if user navigates away
    // setTimeout(() => controller.abort(), 50);

    const [users, posts, comments] = await Promise.all(requests);
    console.log(`Fetched ${users.length} users`);
    console.log(`Fetched ${posts.length} posts`);
    console.log(`Fetched ${comments.length} comments`);

  } catch (error: any) {
    console.log('Requests were cancelled');
  }
}

// Example 5: Combining Features
async function combinedFeaturesExample() {
  console.log('\n=== Combined Features: Generics + AbortController + Retry ===\n');
  
  const api = new FetchEnh({ 
    baseURL: 'https://jsonplaceholder.typicode.com',
    defaultRetries: 3
  });

  // Custom retry logic
  const retryClassifier: RetryClassifier = {
    shouldRetry: ({ response, error, attempt }) => {
      console.log(`Attempt ${attempt}:`, response?.status || error);
      return response ? response.status >= 500 : true;
    }
  };

  const backoff: BackoffStrategy = {
    computeDelay: ({ attempt }) => {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`Waiting ${delay}ms before retry...`);
      return delay;
    }
  };

  api.setRetryBehavior(retryClassifier, backoff);

  interface Todo {
    id: number;
    title: string;
    completed: boolean;
    userId: number;
  }

  const controller = new AbortController();

  try {
    // Type-safe request with abort support and custom retry logic
    const todos = await api.get<Todo[]>({
      endpoint: '/todos',
      query: { _limit: 5 },
      options: {
        signal: controller.signal,
        timeout: 10000,
        retries: 3
      }
    });

    console.log(`\nFetched ${todos.length} todos:`);
    todos.forEach(todo => {
      console.log(`  ${todo.completed ? '✓' : '○'} ${todo.title}`);
    });

  } catch (error) {
    console.error('Failed to fetch todos:', error);
  }
}

// Example 6: Type-safe Error Handling
async function typeSafeErrorHandlingExample() {
  console.log('\n=== Type-safe Error Handling ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });

  interface ApiError {
    error: string;
    code: string;
    details?: any;
  }

  try {
    const result = await api.get<any>({ endpoint: '/nonexistent' });
    console.log('Result:', result);
  } catch (error: any) {
    // Type-safe error handling
    if (error.response) {
      console.log('HTTP Error:', error.response.status);
      
      // Parse error response with type safety
      const errorData = error.data as ApiError;
      console.log('Error message:', errorData.error || 'Unknown error');
    }
  }
}

// Run all examples
if (require.main === module) {
  (async () => {
    await genericTypeExample();
    await complexGenericExample();
    await abortControllerExample();
    await abortMultipleRequestsExample();
    await combinedFeaturesExample();
    await typeSafeErrorHandlingExample();
  })();
}
