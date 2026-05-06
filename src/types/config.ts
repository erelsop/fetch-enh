export interface FetchEnhConfig {
  readonly baseURL?: string;
  readonly defaultHeaders?: Record<string, string>;
  readonly defaultTimeout?: number;
  readonly defaultRetries?: number;
  readonly queryStyle?: {
    readonly array?: 'brackets' | 'repeat' | 'comma';
    readonly object?: 'brackets' | 'dot';
  };
  readonly dedupe?: boolean;
  readonly dedupeKey?: (params: { method: string; url: string; body?: unknown }) => string;
  readonly onRetry?: (info: { attempt: number; delay: number; method: string; url: string; reason: 'status' | 'network'; status?: number }) => void;
  readonly onComplete?: (info: { method: string; url: string; status?: number; ok: boolean; attempts: number; elapsedMs: number }) => void;
}
