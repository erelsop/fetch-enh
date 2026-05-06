export interface RequestInterceptor {
  handler: (request: Request, next: () => Promise<void>) => Request | boolean | void | Promise<Request | boolean | void>;
  priority?: number;
}

export interface ResponseInterceptor {
  handler: (response: Response, next: () => Promise<void>) => Response | boolean | void | Promise<Response | boolean | void>;
  priority?: number;
}
