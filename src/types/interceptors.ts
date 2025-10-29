export interface RequestInterceptor {
  handler: (request: Request, next: Function) => Request | boolean | void | Promise<Request | boolean | void>;
  priority?: number;
}

export interface ResponseInterceptor {
  handler: (response: Response, next: Function) => Response | boolean | void | Promise<Response | boolean | void>;
  priority?: number;
}
