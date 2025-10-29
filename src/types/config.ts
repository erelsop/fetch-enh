export interface FetchEnhConfig {
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  defaultTimeout?: number;
  defaultRetries?: number;
  queryStyle?: {
    array?: 'brackets' | 'repeat' | 'comma';
    object?: 'brackets' | 'dot';
  };
  dedupe?: boolean;
  dedupeKey?: (params: { method: string; url: string; body?: any }) => string;
  onRetry?: (info: { attempt: number; delay: number; method: string; url: string; reason: 'status' | 'network'; status?: number }) => void;
  onComplete?: (info: { method: string; url: string; status?: number; ok: boolean; attempts: number; elapsedMs: number }) => void;
}
