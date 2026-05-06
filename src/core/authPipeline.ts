import type { AuthStrategy } from '../types/auth';
import { AuthAbortError } from '../errors/fetchErrors';

export class AuthPipeline {
  private _authStrategies: AuthStrategy[] = [];

  useAuthStrategy(strategy: AuthStrategy): void {
    this._authStrategies.push(strategy);
    this._authStrategies.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  async applyAuthOnRequest(request: Request): Promise<Request> {
    for (const strategy of this._authStrategies) {
      if (strategy.onRequest) {
        const result = await strategy.onRequest(request);
        if (result instanceof Request) {
          request = result;
        } else if (result === false) {
          throw new AuthAbortError();
        }
      }
    }
    return request;
  }

  /**
   * Handles 401/403 responses by delegating to auth strategies.
   * Returns a Response if an auth strategy successfully handled it,
   * `false` if a strategy explicitly halted, or `undefined` if no strategy handled it.
   */
  async handleAuthError(
    request: Request,
    response: Response,
    retryFn: (newRequest: Request) => Promise<Response>
  ): Promise<Response | false | undefined> {
    for (const strategy of this._authStrategies) {
      if (strategy.onAuthError) {
        const maybeRes = await strategy.onAuthError(request, response, retryFn);
        if (maybeRes instanceof Response) {
          return maybeRes;
        }
        if (maybeRes === false) {
          return false;
        }
      }
    }
    return undefined;
  }

  /** Removes all registered auth strategies. */
  clearAuthStrategies(): void {
    this._authStrategies = [];
  }

  /**
   * Removes a specific auth strategy by reference.
   * Has no effect if the strategy is not currently registered.
   */
  removeAuthStrategy(strategy: AuthStrategy): void {
    const idx = this._authStrategies.indexOf(strategy);
    if (idx !== -1) this._authStrategies.splice(idx, 1);
  }

  get strategies(): readonly AuthStrategy[] {
    return this._authStrategies;
  }
}
