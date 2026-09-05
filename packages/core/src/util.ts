/** True when running in a real browser (never during SSR or in Node tests without jsdom). */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** RFC 4122 v4 id; falls back to Math.random when crypto is unavailable. */
export function uuid(): string {
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    if (c && typeof c.getRandomValues === "function") {
      const bytes = c.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {
    // fall through
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function clean(value: unknown, max = 2000): string {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, max);
}

export function toInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function nowMs(): number {
  return Date.now();
}

/** Deterministic JSON with sorted keys, used for idempotency fingerprints. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function trimSlashes(value: string): string {
  return String(value || "").replace(/\/+$/, "");
}

/**
 * The API the SDK talks to. Local development against a locally running
 * Grigora API mirrors the platform's own storefront scripts: on localhost the
 * default flips to the local API port.
 */
export function defaultApiBase(): string {
  if (isBrowser()) {
    try {
      const host = window.location.hostname.toLowerCase();
      // Grigora's local preview serves sites at <slug>.localhost, and browsers
      // resolve every *.localhost name to the loopback address.
      if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")) {
        return "http://localhost:2706";
      }
    } catch {
      // ignore
    }
  }
  return "https://api.grigora.co";
}

/** Only http(s) URLs are ever placed in href/src attributes. */
export function isSafeHttpUrl(value: unknown): boolean {
  const text = clean(value, 4000);
  if (!text) return false;
  if (text.startsWith("/") && !text.startsWith("//")) return true;
  try {
    const parsed = new URL(text, isBrowser() ? window.location.href : "https://grigora.co");
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function currentUrl(): string {
  return isBrowser() ? window.location.href : "";
}

export function currentPageUrl(): string {
  if (!isBrowser()) return "";
  return `${window.location.origin}${window.location.pathname}`;
}

export function absoluteUrl(value: string): string {
  if (!value) return "";
  if (!isBrowser()) return value;
  try {
    return new URL(value, window.location.href).toString();
  } catch {
    return value;
  }
}

export type Logger = (...args: unknown[]) => void;

export function createLogger(enabled: boolean, prefix = "[grigora-commerce]"): Logger {
  if (!enabled) return () => {};
  return (...args: unknown[]) => {
    try {
      console.info(prefix, ...args);
    } catch {
      // ignore
    }
  };
}
