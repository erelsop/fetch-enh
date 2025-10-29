export interface TokenStore {
  getToken(): Promise<string | null> | string | null;
  setToken(token: string | null): Promise<void> | void;
}

export interface AuthStrategy {
  priority?: number;
  onRequest?: (request: Request) => Promise<Request | void | false> | Request | void | false;
  onAuthError?: (
    request: Request,
    response: Response,
    retry: (newRequest: Request) => Promise<Response>
  ) => Promise<Response | void | false> | Response | void | false;
}



