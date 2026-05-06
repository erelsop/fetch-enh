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
    const apply = async (index: number, req: Request): Promise<Request> => {
      if (index >= this._requestInterceptors.length) return req;
      const interceptor = this._requestInterceptors[index];
      const downstream = await apply(index + 1, req);
      try {
        const result = await interceptor.handler(downstream, async () => { /* no-op for back-compat */ });
        if (result === false) {
          throw new InterceptorAbortError();
        }
        return result instanceof Request ? result : downstream;
      } catch (error) {
        throw error;
      }
    };
    return apply(0, request);
  }

  async applyResponseInterceptors(response: Response): Promise<Response> {
    const apply = async (index: number, res: Response): Promise<Response> => {
      if (index >= this._responseInterceptors.length) return res;
      const interceptor = this._responseInterceptors[index];
      const downstream = await apply(index + 1, res);
      try {
        const result = await interceptor.handler(downstream, async () => { /* no-op for back-compat */ });
        if (result === false) {
          throw new InterceptorAbortError('Response interceptor halted.');
        }
        return result instanceof Response ? result : downstream;
      } catch (error) {
        throw error;
      }
    };
    return apply(0, response);
  }
}
