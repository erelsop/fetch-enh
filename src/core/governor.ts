import { sleep } from './retryEngine';

/**
 * Options controlling the {@link RequestGovernor}. All fields are optional; an
 * empty config produces a pass-through governor with no limiting.
 */
export interface GovernorOptions {
  /** Maximum number of logical requests allowed in flight at once. */
  concurrency?: number;
  /**
   * Maximum requests started per second. Converted internally to a minimum
   * spacing between request starts (`1000 / maxRps` ms). Ignored if
   * `minIntervalMs` is also set.
   */
  maxRps?: number;
  /** Minimum spacing (ms) between successive request starts. Takes precedence over `maxRps`. */
  minIntervalMs?: number;
}

/**
 * Serialises access to the network according to a concurrency ceiling and/or a
 * minimum spacing between request starts. Applied once per *logical* request
 * (not per retry attempt), so a request does not hold a concurrency slot while
 * it sleeps between retries.
 *
 * The concurrency gate is a fair FIFO semaphore. The rate gate is a virtual
 * "next allowed start" clock, so spacing holds across bursts without needing a
 * background timer. Both gates honour an optional `AbortSignal` so a cancelled
 * request does not sit in the queue forever.
 *
 * @internal
 */
export class RequestGovernor {
  private readonly _concurrency?: number;
  private readonly _minIntervalMs?: number;

  private _active = 0;
  private _waiters: Array<{ resolve: () => void; reject: (e: unknown) => void; onAbort?: () => void; signal?: AbortSignal }> = [];
  private _nextAllowedStart = 0;

  constructor(opts: GovernorOptions = {}) {
    if (opts.concurrency != null && opts.concurrency > 0) {
      this._concurrency = opts.concurrency;
    }
    if (opts.minIntervalMs != null && opts.minIntervalMs > 0) {
      this._minIntervalMs = opts.minIntervalMs;
    } else if (opts.maxRps != null && opts.maxRps > 0) {
      this._minIntervalMs = 1000 / opts.maxRps;
    }
  }

  /** True when this governor imposes no limits (fast path). */
  get isNoop(): boolean {
    return this._concurrency === undefined && this._minIntervalMs === undefined;
  }

  /**
   * Runs `fn` under the governor's limits. Acquires a concurrency slot (waiting
   * in FIFO order if at capacity), then waits out any required inter-request
   * spacing, then invokes `fn`. The slot is always released when `fn` settles.
   */
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.isNoop) return fn();
    await this._acquireSlot(signal);
    try {
      await this._awaitRateWindow(signal);
      return await fn();
    } finally {
      this._releaseSlot();
    }
  }

  private async _acquireSlot(signal?: AbortSignal): Promise<void> {
    if (this._concurrency === undefined) return;
    if (this._active < this._concurrency) {
      this._active++;
      return;
    }
    // At capacity — queue until a slot frees up (or the caller aborts).
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(makeAbortError());
        return;
      }
      const waiter = { resolve, reject, signal, onAbort: undefined as (() => void) | undefined };
      if (signal) {
        waiter.onAbort = () => {
          const idx = this._waiters.indexOf(waiter);
          if (idx >= 0) this._waiters.splice(idx, 1);
          reject(makeAbortError());
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this._waiters.push(waiter);
    });
    // A waiter is only resolved by _releaseSlot, which hands over the slot
    // without decrementing — so _active already accounts for this holder.
  }

  private _releaseSlot(): void {
    if (this._concurrency === undefined) return;
    const next = this._waiters.shift();
    if (next) {
      // Hand the slot directly to the next waiter (no decrement/increment race).
      if (next.onAbort && next.signal) next.signal.removeEventListener('abort', next.onAbort);
      next.resolve();
    } else {
      this._active--;
    }
  }

  private async _awaitRateWindow(signal?: AbortSignal): Promise<void> {
    if (this._minIntervalMs === undefined) return;
    const now = Date.now();
    const start = Math.max(now, this._nextAllowedStart);
    this._nextAllowedStart = start + this._minIntervalMs;
    const wait = start - now;
    if (wait > 0) await sleep(wait, signal);
  }
}

function makeAbortError(): Error {
  const err: any = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}
