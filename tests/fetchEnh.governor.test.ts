/**
 * fetchEnh.governor.test.ts
 *
 * Tests for the F3 request governor: concurrency ceiling, rate spacing
 * (maxRps / minIntervalMs), abort-while-queued, and the no-op fast path.
 * The RequestGovernor unit is exercised directly (deterministic), and the
 * FetchEnh integration is smoke-tested via fetch-mock.
 */
import FetchEnh from '../src';
import { RequestGovernor } from '../src/core/governor';
import fetchMock from 'jest-fetch-mock';

beforeEach(() => {
  fetchMock.resetMocks();
});

const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('RequestGovernor — concurrency', () => {
  test('never exceeds the concurrency ceiling and drains all tasks', async () => {
    const gov = new RequestGovernor({ concurrency: 2 });
    let active = 0;
    let peak = 0;
    const gates = [deferred(), deferred(), deferred(), deferred(), deferred()];

    const runs = gates.map((g, i) =>
      gov.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await g.promise;
        active--;
        return i;
      }),
    );

    // Let the scheduler settle: only 2 should be active.
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(2);

    // Release one at a time; a queued task should take each freed slot.
    for (const g of gates) {
      g.resolve(undefined);
      await Promise.resolve();
      await Promise.resolve();
    }

    const results = await Promise.all(runs);
    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(active).toBe(0);
  });

  test('queued tasks are served in FIFO order', async () => {
    const gov = new RequestGovernor({ concurrency: 1 });
    const order: number[] = [];
    const g0 = deferred();

    // First task occupies the single slot until we release g0.
    const first = gov.run(async () => { order.push(0); await g0.promise; });
    await Promise.resolve();

    // These three queue behind it.
    const rest = [1, 2, 3].map((n) => gov.run(async () => { order.push(n); }));

    g0.resolve(undefined);
    await Promise.all([first, ...rest]);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  test('a rejecting task still releases its slot', async () => {
    const gov = new RequestGovernor({ concurrency: 1 });
    await expect(gov.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // Slot must be free for the next task.
    await expect(gov.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('RequestGovernor — abort while queued', () => {
  test('an aborted queued task rejects and frees no real slot', async () => {
    const gov = new RequestGovernor({ concurrency: 1 });
    const g0 = deferred();
    const first = gov.run(async () => { await g0.promise; });
    await Promise.resolve();

    const ac = new AbortController();
    const queued = gov.run(async () => 'should-not-run', ac.signal);
    ac.abort();

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });

    // The first task can still finish and a fresh task can acquire the slot.
    g0.resolve(undefined);
    await first;
    await expect(gov.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('RequestGovernor — rate spacing', () => {
  test('minIntervalMs spaces out successive starts', async () => {
    const gov = new RequestGovernor({ minIntervalMs: 40 });
    const starts: number[] = [];
    const t0 = Date.now();
    await Promise.all(
      [0, 1, 2].map(() => gov.run(async () => { starts.push(Date.now() - t0); })),
    );
    starts.sort((a, b) => a - b);
    // Second start ≥ ~40ms after first, third ≥ ~80ms (allow scheduler slack).
    expect(starts[1]).toBeGreaterThanOrEqual(30);
    expect(starts[2]).toBeGreaterThanOrEqual(70);
  });

  test('maxRps is converted to a minimum interval', async () => {
    const gov = new RequestGovernor({ maxRps: 25 }); // 40ms spacing
    const starts: number[] = [];
    const t0 = Date.now();
    await Promise.all(
      [0, 1].map(() => gov.run(async () => { starts.push(Date.now() - t0); })),
    );
    starts.sort((a, b) => a - b);
    expect(starts[1]).toBeGreaterThanOrEqual(30);
  });
});

describe('RequestGovernor — no-op', () => {
  test('isNoop is true with no limits and runs fn directly', async () => {
    const gov = new RequestGovernor();
    expect(gov.isNoop).toBe(true);
    await expect(gov.run(async () => 42)).resolves.toBe(42);
  });
});

describe('FetchEnh integration', () => {
  test('concurrency caps simultaneous in-flight requests', async () => {
    let active = 0;
    let peak = 0;
    fetchMock.mockResponse(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return { body: JSON.stringify({ ok: true }), init: { status: 200, headers: { 'content-type': 'application/json' } } } as any;
    });

    const api = new FetchEnh({ baseURL: 'https://api.test', concurrency: 3 });
    await Promise.all(
      Array.from({ length: 9 }, (_, i) => api.get({ endpoint: `/r/${i}`, responseType: 'json' })),
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  test('setConfig can install a governor after construction', async () => {
    let active = 0;
    let peak = 0;
    fetchMock.mockResponse(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { body: '{}', init: { status: 200, headers: { 'content-type': 'application/json' } } } as any;
    });

    const api = new FetchEnh({ baseURL: 'https://api.test' });
    api.setConfig({ concurrency: 2 });
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => api.get({ endpoint: `/r/${i}`, responseType: 'json' })),
    );
    expect(peak).toBeLessThanOrEqual(2);
  });
});
