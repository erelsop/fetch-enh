/**
 * Authentication Examples
 * 
 * Demonstrates various authentication strategies with FetchEnh.
 */

import FetchEnh, { 
  BearerTokenAuth, 
  ApiKeyAuth, 
  BasicAuth, 
  MemoryTokenStore,
  LocalStorageTokenStore 
} from 'fetch-enh';

// Example 1: Bearer Token Authentication with Auto-Refresh
async function bearerTokenExample() {
  console.log('=== Bearer Token Authentication ===\n');
  
  const tokenStore = new MemoryTokenStore('initial-access-token');
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });

  // Configure Bearer token authentication with refresh logic
  api.useAuthStrategy(new BearerTokenAuth(
    tokenStore,
    async () => {
      console.log('Token expired, refreshing...');
      
      // Replace with your actual token-refresh endpoint.
      // This callback is only invoked when the server returns 401/403.
      const response = await fetch('https://your-auth-server.example/token/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Refresh-Token': getRefreshTokenFromStorage() // Your refresh token
        }
      });
      
      if (!response.ok) {
        console.error('Token refresh failed');
        return null; // Return null to indicate failure
      }
      
      const data = await response.json();
      console.log('Token refreshed successfully');
      return data.access_token;
    }
  ));

  try {
    // Make authenticated requests.
    // jsonplaceholder doesn't enforce auth, but FetchEnh attaches the header.
    // If the server returned 401/403 the refresh callback above would fire.
    const data = await api.get({ endpoint: '/posts/1' });
    console.log('Protected data:', data);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Example 2: API Key Authentication (Header-based)
async function apiKeyHeaderExample() {
  console.log('\n=== API Key Authentication (Header) ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });

  api.useAuthStrategy(new ApiKeyAuth({
    headerName: 'X-API-Key',
    getApiKey: () => process.env.API_KEY || 'your-api-key-here'
  }));

  try {
    const data = await api.get({ endpoint: '/posts/1' });
    console.log('Data:', data);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Example 3: API Key Authentication (Query Parameter)
async function apiKeyQueryExample() {
  console.log('\n=== API Key Authentication (Query) ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });

  api.useAuthStrategy(new ApiKeyAuth({
    queryName: 'api_key',
    getApiKey: async () => {
      // Can fetch from secure storage asynchronously
      return await getApiKeyFromSecureStorage();
    }
  }));

  try {
    // URL will be: https://jsonplaceholder.typicode.com/posts/1?api_key=YOUR_KEY
    const data = await api.get({ endpoint: '/posts/1' });
    console.log('Data:', data);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Example 4: Basic Authentication
async function basicAuthExample() {
  console.log('\n=== Basic Authentication ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });

  api.useAuthStrategy(new BasicAuth(
    process.env.USERNAME || 'username',
    process.env.PASSWORD || 'password'
  ));

  try {
    const data = await api.get({ endpoint: '/posts/1' });
    console.log('Protected data:', data);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Example 5: Multiple Authentication Strategies
async function multipleAuthExample() {
  console.log('\n=== Multiple Authentication Strategies ===\n');
  
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });

  // Add Bearer token (priority 1 - runs first)
  const tokenStore = new MemoryTokenStore('access-token');
  api.useAuthStrategy(new BearerTokenAuth(
    tokenStore,
    async () => refreshToken(),
    1  // Priority
  ));

  // Add API key (priority 2 - runs second)
  api.useAuthStrategy(new ApiKeyAuth({
    headerName: 'X-API-Key',
    getApiKey: () => 'api-key-value',
    priority: 2
  }));

  try {
    // Request will have both Authorization header and X-API-Key header
    const data = await api.get({ endpoint: '/posts/1' });
    console.log('Data:', data);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Example 6: Persistent Token Storage (Browser)
async function persistentTokenExample() {
  console.log('\n=== Persistent Token Storage ===\n');
  
  // Use LocalStorage to persist tokens across page refreshes
  const tokenStore = new LocalStorageTokenStore('app_access_token');
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });

  api.useAuthStrategy(new BearerTokenAuth(
    tokenStore,
    async () => {
      // Refresh logic
      const newToken = await refreshToken();
      return newToken;
    }
  ));

  try {
    // Token is automatically saved to localStorage
    const data = await api.get({ endpoint: '/users/1' });
    console.log('User profile:', data);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Example 7: Custom Token Store
class DatabaseTokenStore {
  async getToken(): Promise<string | null> {
    // Fetch from your database or secure storage
    const token = await fetchTokenFromDatabase();
    return token;
  }

  async setToken(token: string | null): Promise<void> {
    if (token) {
      await saveTokenToDatabase(token);
    } else {
      await deleteTokenFromDatabase();
    }
  }
}

async function customTokenStoreExample() {
  console.log('\n=== Custom Token Store ===\n');
  
  const tokenStore = new DatabaseTokenStore();
  const api = new FetchEnh({ baseURL: 'https://jsonplaceholder.typicode.com' });

  api.useAuthStrategy(new BearerTokenAuth(
    tokenStore,
    async () => refreshToken()
  ));

  try {
    const data = await api.get({ endpoint: '/posts/1' });
    console.log('Data:', data);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Helper functions (mock implementations)
function getRefreshTokenFromStorage(): string {
  return 'refresh-token-from-storage';
}

async function getApiKeyFromSecureStorage(): Promise<string> {
  return 'secure-api-key';
}

async function refreshToken(): Promise<string> {
  return 'new-access-token';
}

async function fetchTokenFromDatabase(): Promise<string | null> {
  return 'token-from-db';
}

async function saveTokenToDatabase(token: string): Promise<void> {
  console.log('Saving token to database:', token);
}

async function deleteTokenFromDatabase(): Promise<void> {
  console.log('Deleting token from database');
}

// Run examples
(async () => {
  await bearerTokenExample();
  await apiKeyHeaderExample();
  await apiKeyQueryExample();
  await basicAuthExample();
  await multipleAuthExample();
  await persistentTokenExample();
  await customTokenStoreExample();
})();
