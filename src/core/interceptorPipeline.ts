import type { RequestInterceptor, ResponseInterceptor } from '../types/interceptors';
import { InterceptorAbortError } from '../errors/fetchErrors';

export class InterceptorPipeline {
  private _requestInterceptors: RequestInterceptor[] = [];
  private _responseInterceptors: ResponseInterceptor[] = [];

  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this._requestInterceptors.push(interceptor);
    this._requestInterceptors.sort((a, b) => {
      const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
      const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
      return priorityA - priorityB;
    });
  }

  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this._responseInterceptors.push(interceptor);
    this._responseInterceptors.sort((a, b) => {
      const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
      const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
      return priorityA - priorityB;
    });
  }

  clearRequestInterceptors(): void {
    this._requestInterceptors = [];
  }

  removeRequestInterceptor(interceptor: RequestInterceptor): void {
    const index = this._requestInterceptors.indexOf(interceptor);
    if (index > -1) {
      this._requestInterceptors.splice(index, 1);
    }
  }

  clearResponseInterceptors(): void {
    this._responseInterceptors = [];
  }

  removeResponseInterceptor(interceptor: ResponseInterceptor): void {
    const index = this._responseInterceptors.indexOf(interceptor);
    if (index > -1) {
      this._responseInterceptors.splice(index, 1);
    }
  }

  async applyRequestInterceptors(request: Request): Promise<Request> {
    // Iterate forward through the priority-sorted array so that lower-priority
    // numbers (sorted to the front) execute first — matching the documented
    // contract: "lower numbers run first on the way in".
    let req = request;
    for (const interceptor of this._requestInterceptors) {
      const result = await interceptor.handler(req, async () => { /* no-op for back-compat */ });
      if (result === false) throw new InterceptorAbortError();
      if (result instanceof Request) req = result;
    }
    return req;
  }

  async applyResponseInterceptors(response: Response): Promise<Response> {
    // Same forward-iteration contract as applyRequestInterceptors.
    let res = response;
    for (const interceptor of this._responseInterceptors) {
      const result = await interceptor.handler(res, async () => { /* no-op for back-compat */ });
      if (result === false) throw new InterceptorAbortError('Response interceptor halted.');
      if (result instanceof Response) res = result;
    }
    return res;
  }
}
