import { GrigoraError, isGrigoraError, mapApiError, type ErrorContext } from "./errors";
import { delay, trimSlashes, type Logger } from "./util";

export interface ApiClientOptions {
  apiBase: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  log?: Logger;
}

export interface RequestOptions {
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** GET requests retry on network errors, 5xx and 429 unless set to false. */
  retry?: boolean;
  context?: ErrorContext;
  /** Adds Idempotency-Key and X-Grigora-Checkout-Client. Required by every checkout POST. */
  idempotency?: { key: string; clientId: string };
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const COMMERCE_PATH = "/general/commerce";

/**
 * Thin fetch wrapper for the Grigora commerce API.
 *
 * - Unwraps the `{ Output: ... }` envelope.
 * - Maps failures to GrigoraError with a stable code.
 * - Retries idempotent GETs with exponential backoff; never retries a POST
 *   (a checkout POST is replay-safe only through its Idempotency-Key, which
 *   the caller owns).
 */
export class ApiClient {
  readonly apiBase: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly log: Logger;

  constructor(options: ApiClientOptions) {
    this.apiBase = trimSlashes(options.apiBase);
    this.fetchImpl = options.fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retries = Math.max(1, options.retries ?? 3);
    this.log = options.log || (() => {});
  }

  /** Absolute URL for a commerce path ("/cart/validate") or a full URL. */
  url(path: string, query?: Record<string, unknown>): string {
    const base = /^https?:\/\//.test(path) ? path : `${this.apiBase}${COMMERCE_PATH}${path.startsWith("/") ? "" : "/"}${path}`;
    if (!query) return base;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      params.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
    const qs = params.toString();
    return qs ? `${base}${base.includes("?") ? "&" : "?"}${qs}` : base;
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("POST", path, { ...options, body });
  }

  private resolveFetch(): typeof fetch {
    if (this.fetchImpl) return this.fetchImpl;
    const global = (globalThis as { fetch?: typeof fetch }).fetch;
    if (!global) throw new GrigoraError("fetch is not available in this environment.", { code: "network_error" });
    return global.bind(globalThis);
  }

  private async request<T>(method: "GET" | "POST", path: string, options: RequestOptions & { body?: unknown }): Promise<T> {
    const url = this.url(path, options.query);
    const headers: Record<string, string> = { Accept: "application/json", ...(options.headers || {}) };
    let body: string | undefined;
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body ?? {});
    }
    if (options.idempotency) {
      headers["Idempotency-Key"] = options.idempotency.key;
      headers["X-Grigora-Checkout-Client"] = options.idempotency.clientId;
    }
    const attempts = method === "GET" && options.retry !== false ? this.retries : 1;
    const context = options.context || "generic";
    const fetchImpl = this.resolveFetch();

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs) : null;
      if (controller && options.signal) {
        if (options.signal.aborted) controller.abort();
        else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
      try {
        this.log(`${method} ${url}`);
        const response = await fetchImpl(url, {
          method,
          headers,
          body,
          credentials: "omit",
          mode: "cors",
          signal: controller?.signal,
        });
        const json = await readJson(response);
        if (!response.ok) {
          const output = envelope(json);
          const error = mapApiError({
            status: response.status,
            output,
            retryAfterHeader: response.headers?.get?.("Retry-After") ?? null,
            context,
          });
          const retryable = response.status >= 500 || response.status === 429;
          if (retryable && attempt < attempts - 1) {
            await delay(backoff(attempt, error.retryAfter));
            continue;
          }
          throw error;
        }
        return unwrap<T>(json);
      } catch (error) {
        if (isGrigoraError(error)) throw error;
        const aborted = (error as { name?: string })?.name === "AbortError";
        const wrapped = new GrigoraError(
          aborted ? "The request timed out. Please try again." : "We could not reach the store. Check your connection and try again.",
          { code: aborted ? "timeout" : "network_error", cause: error }
        );
        if (attempt < attempts - 1) {
          await delay(backoff(attempt));
          continue;
        }
        throw wrapped;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    throw new GrigoraError("Request failed.", { code: "unknown" });
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function envelope(json: unknown): { code?: unknown; message?: unknown; [key: string]: unknown } | null {
  if (!json || typeof json !== "object") return null;
  const record = json as Record<string, unknown>;
  const output = record.Output;
  if (output && typeof output === "object") return output as { code?: unknown; message?: unknown };
  if ("error" in record && typeof record.error === "string") return { message: record.error };
  return record as { code?: unknown; message?: unknown };
}

function unwrap<T>(json: unknown): T {
  if (json && typeof json === "object" && "Output" in (json as Record<string, unknown>)) {
    return (json as { Output: T }).Output;
  }
  return json as T;
}

function backoff(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined && retryAfterSeconds <= 5) return retryAfterSeconds * 1000;
  return 500 * 2 ** attempt + Math.floor(Math.random() * 250);
}
