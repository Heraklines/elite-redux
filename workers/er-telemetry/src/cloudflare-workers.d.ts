// Minimal ambient Cloudflare Worker types used by the telemetry Worker.
interface D1Meta {
  changes?: number;
  last_row_id?: number | bigint;
  duration?: number;
}

interface D1Result<T = Record<string, unknown>> {
  success?: boolean;
  results: T[];
  meta: D1Meta;
  error?: string;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
