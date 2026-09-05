import { isBrowser, uuid } from "./util";

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
}

/** localStorage with every call guarded: private mode, quota and disabled storage all degrade to no-ops. */
export class LocalStorageAdapter implements StorageAdapter {
  static available(): boolean {
    if (!isBrowser()) return false;
    try {
      const probe = "__grigora_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore quota / privacy errors
    }
  }
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

export function defaultStorage(): StorageAdapter {
  return LocalStorageAdapter.available() ? new LocalStorageAdapter() : new MemoryStorageAdapter();
}

/** The shape the checkout guard accepts for X-Grigora-Checkout-Client. */
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

export const DEFAULT_CLIENT_ID_KEY = "grigora-commerce-client-v1";

/**
 * A persistent, anonymous client id. It is the same key the platform's own
 * storefront scripts use, so a shopper moving between a platform-rendered page
 * and an SDK-rendered one keeps one identity for checkout replay protection.
 */
export function getOrCreateClientId(storage: StorageAdapter, key = DEFAULT_CLIENT_ID_KEY): string {
  let value = storage.get(key) || "";
  if (!CLIENT_ID_PATTERN.test(value)) {
    value = uuid();
    storage.set(key, value);
  }
  return value;
}

export function readJson<T>(storage: StorageAdapter, key: string, fallback: T): T {
  const raw = storage.get(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function writeJson(storage: StorageAdapter, key: string, value: unknown): void {
  try {
    storage.set(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}
