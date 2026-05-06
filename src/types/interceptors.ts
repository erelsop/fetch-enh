export interface RequestInterceptor {
  readonly handler: (request: Request, next: () => Promise<void>) => Request | boolean | void | Promise<Request | boolean | void>;
  readonly priority?: number;
}

export interface ResponseInterceptor {
  readonly handler: (response: Response, next: () => Promise<void>) => Response | boolean | void | Promise<Response | boolean | void>;
  readonly priority?: number;
}
