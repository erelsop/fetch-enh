/**
 * Basic Usage Example
 * 
 * Demonstrates the fundamental usage of FetchEnh for making HTTP requests.
 */

import FetchEnh from '@erelsop/fetch-enh';

// Initialize the API client
const api = new FetchEnh({
  baseURL: 'https://jsonplaceholder.typicode.com',
  defaultHeaders: {
    'X-Client-Version': '1.0.0'
  },
  defaultTimeout: 10000,  // 10 seconds
  defaultRetries: 3
});

async function basicExamples() {
  try {
    // GET request - fetch a single resource
    console.log('Fetching user...');
    const user = await api.get({ 
      endpoint: '/users/1' 
    });
    console.log('User:', user);

    // GET request with query parameters
    console.log('\nFetching posts with query params...');
    const posts = await api.get({
      endpoint: '/posts',
      query: {
        userId: 1,
        _limit: 5
      }
    });
    console.log('Posts:', posts);

    // POST request - create a new resource
    console.log('\nCreating new post...');
    const newPost = await api.post({
      endpoint: '/posts',
      body: {
        title: 'My New Post',
        body: 'This is the content of my post',
        userId: 1
      }
    });
    console.log('Created post:', newPost);

    // PUT request - update a resource
    console.log('\nUpdating post...');
    const updatedPost = await api.put({
      endpoint: '/posts/1',
      body: {
        id: 1,
        title: 'Updated Title',
        body: 'Updated content',
        userId: 1
      }
    });
    console.log('Updated post:', updatedPost);

    // PATCH request - partial update
    console.log('\nPatching post...');
    const patchedPost = await api.patch({
      endpoint: '/posts/1',
      body: {
        title: 'Partially Updated Title'
      }
    });
    console.log('Patched post:', patchedPost);

    // DELETE request
    console.log('\nDeleting post...');
    await api.delete({ 
      endpoint: '/posts/1' 
    });
    console.log('Post deleted successfully');

    // Custom headers for a specific request
    console.log('\nRequest with custom headers...');
    const customResponse = await api.get({
      endpoint: '/users/1',
      headers: {
        'X-Custom-Header': 'CustomValue'
      }
    });
    console.log('Response:', customResponse);

    // Different response types
    console.log('\nFetching as text...');
    const textResponse = await api.get({
      endpoint: '/users/1',
      responseType: 'text'
    });
    console.log('Text response:', textResponse.substring(0, 100) + '...');

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the examples
basicExamples();
