export interface TokenStore {
  getToken(): Promise<string | null> | string | null;
  setToken(token: string | null): Promise<void> | void;
}

export interface AuthStrategy {
  readonly priority?: number;
  readonly onRequest?: (request: Request) => Promise<Request | void | false> | Request | void | false;
  readonly onAuthError?: (
    request: Request,
    response: Response,
    retry: (newRequest: Request) => Promise<Response>
  ) => Promise<Response | void | false> | Response | void | false;
}



