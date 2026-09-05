import { MemoryStorageAdapter } from "../storage";
import { createCommerce } from "../commerce";
import type { GrigoraCommerce, GrigoraCommerceConfig } from "../types";

export interface FakeRequest {
  method: string;
  url: URL;
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

export interface FakeResponseInit {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type RouteHandler = (request: FakeRequest) => FakeResponseInit | Promise<FakeResponseInit> | undefined;

/** A fetch double that records calls and answers from a handler. Envelopes bodies in `Output` unless `raw` is set. */
export function fakeFetch(handler: RouteHandler) {
  const calls: FakeRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url);
    const headers: Record<string, string> = {};
    const rawHeaders = (init?.headers || {}) as Record<string, string>;
    for (const [key, value] of Object.entries(rawHeaders)) headers[key.toLowerCase()] = String(value);
    let body: Record<string, unknown> = {};
    if (typeof init?.body === "string" && init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = {};
      }
    }
    const request: FakeRequest = {
      method: (init?.method || "GET").toUpperCase(),
      url,
      path: url.pathname.replace(/^\/general\/commerce/, ""),
      body,
      headers,
    };
    calls.push(request);
    const result = (await handler(request)) || { status: 404, body: { message: "no route" } };
    const status = result.status ?? 200;
    const payload = result.body === undefined ? {} : result.body;
    const text = JSON.stringify(payload && typeof payload === "object" && "Output" in (payload as object) ? payload : { Output: payload });
    const responseHeaders = new Map<string, string>(Object.entries(result.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => responseHeaders.get(name.toLowerCase()) ?? null },
      text: async () => text,
      json: async () => JSON.parse(text),
    } as unknown as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export function validateResponse(lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  const subtotal = lines.reduce((sum, line) => sum + Number(line.unit_amount) * Number(line.quantity), 0);
  return {
    line_items: lines,
    subtotal_amount: subtotal,
    discount_code: "",
    discount_amount: 0,
    subtotal_after_discount_amount: subtotal,
    shipping_amount: 0,
    shipping_quote: { required: false, eligible: true, code: "not_required", message: "", available_rates: [] },
    tax_mode: "none",
    tax_amount: 0,
    tax_breakdown: [],
    prices_include_tax: false,
    tax_calculation_status: "none",
    total_is_estimate: false,
    total_amount: subtotal,
    currency: "USD",
    all_in_stock: lines.every((line) => line.in_stock !== false),
    requires_shipping: lines.some((line) => line.requires_shipping === true),
    item_count: lines.reduce((sum, line) => sum + Number(line.quantity), 0),
    ...extra,
  };
}

export function serverLine(productId: string, unit: number, quantity: number, extra: Record<string, unknown> = {}) {
  return {
    product_id: productId,
    variant_id: "",
    quantity,
    unit_amount: unit,
    total_amount: unit * quantity,
    currency: "USD",
    title: `Product ${productId}`,
    image_url: `https://img/${productId}.jpg`,
    product_url: `https://shop.test/product/${productId}`,
    product_slug: productId,
    in_stock: true,
    requires_shipping: false,
    pricing_type: "one_time",
    available: null,
    ...extra,
  };
}

export function catalogLine(productId: string) {
  return {
    id: productId,
    slug: productId,
    title: `Product ${productId}`,
    price_amount: 1200,
    currency: "USD",
    image_url: `https://img/${productId}.jpg`,
    in_stock: true,
    inventory: { tracked: false, available: null },
    options: [],
    has_variants: false,
    variants: [],
    collections: [],
    product_url: `https://shop.test/product/${productId}`,
  };
}

export const STORE = {
  project_id: "p1",
  store_name: "Test Store",
  currency: "USD",
  storefront_origins: ["https://shop.test"],
  checkout: {
    provider: "stripe",
    mode: "embedded",
    embedded_supported: true,
    hosted_supported: true,
    test_mode: true,
    code: "",
    message: "",
    stripe_publishable_key: "pk_test_1",
  },
  shipping: { configured: true, allowed_countries: ["US", "IN"] },
  tax: { mode: "none", prices_include_tax: false },
  appearance: { accent_color: "#111111" },
};

export function makeCommerce(handler: RouteHandler, config: Partial<GrigoraCommerceConfig> = {}) {
  const { fetchImpl, calls } = fakeFetch(handler);
  const storage = (config.storage as MemoryStorageAdapter) || new MemoryStorageAdapter();
  const commerce: GrigoraCommerce = createCommerce({
    projectId: "p1",
    apiBase: "https://api.test",
    fetch: fetchImpl,
    storage,
    locale: "en-US",
    catalogTtlMs: 60_000,
    ...config,
  });
  return { commerce, calls, storage };
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
