import { GrigoraError } from "./errors";
import type { PaymentAdapterContext, PaymentProviderAdapter, ProviderId, ProviderRegistry } from "./types";
import { isBrowser } from "./util";

const globalAdapters: PaymentProviderAdapter[] = [];

/** Adapters registered before any instance exists apply to every instance created later. */
export function registerGlobalProvider(adapter: PaymentProviderAdapter): void {
  const index = globalAdapters.findIndex((existing) => existing.id === adapter.id);
  if (index >= 0) globalAdapters[index] = adapter;
  else globalAdapters.push(adapter);
}

export function listGlobalProviders(): PaymentProviderAdapter[] {
  return globalAdapters.slice();
}

export class ProviderRegistryImpl implements ProviderRegistry {
  private readonly adapters = new Map<string, PaymentProviderAdapter>();

  constructor(initial: PaymentProviderAdapter[] = []) {
    for (const adapter of initial) this.register(adapter);
  }

  register(adapter: PaymentProviderAdapter): void {
    if (!adapter || !adapter.id) throw new GrigoraError("A payment adapter needs an id.", { code: "validation_error" });
    this.adapters.set(String(adapter.id), adapter);
  }

  get(id: ProviderId): PaymentProviderAdapter | null {
    return this.adapters.get(String(id)) || null;
  }

  has(id: ProviderId): boolean {
    return this.adapters.has(String(id));
  }

  list(): PaymentProviderAdapter[] {
    return Array.from(this.adapters.values());
  }
}

/**
 * The always-available fallback: send the shopper to the provider-hosted
 * checkout page the API created. Used for PayPal and Paddle (redirect-only on
 * the Grigora API), for merchants who prefer Stripe's hosted page, and whenever
 * an embedded adapter is missing or its script fails to load.
 */
export const hostedAdapter: PaymentProviderAdapter = {
  id: "hosted",
  supportsEmbedded: false,
  async mount() {
    // nothing to render
  },
  async submit(context: PaymentAdapterContext) {
    const url = context.session.checkoutUrl;
    if (!url) throw new GrigoraError("Checkout did not return a payment link.", { code: "checkout_failed" });
    context.commerce.navigate(url);
  },
  destroy() {
    // nothing to tear down
  },
  submitLabel(context) {
    return `Continue to ${providerLabel(context.session.provider)}`;
  },
};

export function providerLabel(provider: ProviderId): string {
  switch (String(provider)) {
    case "stripe":
      return "Stripe";
    case "razorpay":
      return "Razorpay";
    case "paypal":
      return "PayPal";
    case "paddle":
      return "Paddle";
    case "manual":
      return "the store";
    default:
      return "payment";
  }
}

const scriptLoads = new Map<string, Promise<void>>();

/** Inject a third-party script once; concurrent callers share the same promise. */
export function loadExternalScript(src: string, options: { attributes?: Record<string, string>; timeoutMs?: number } = {}): Promise<void> {
  if (!isBrowser()) return Promise.reject(new GrigoraError("Scripts can only load in a browser.", { code: "provider_error" }));
  const existing = scriptLoads.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const already = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (already && already.dataset.grigoraLoaded === "true") {
      resolve();
      return;
    }
    const script = already || document.createElement("script");
    const timeout = setTimeout(() => {
      scriptLoads.delete(src);
      reject(new GrigoraError("The payment provider's script took too long to load.", { code: "provider_error" }));
    }, options.timeoutMs ?? 20_000);
    script.addEventListener("load", () => {
      clearTimeout(timeout);
      script.dataset.grigoraLoaded = "true";
      resolve();
    });
    script.addEventListener("error", () => {
      clearTimeout(timeout);
      scriptLoads.delete(src);
      script.remove();
      reject(new GrigoraError("The payment provider's script could not be loaded.", { code: "provider_error" }));
    });
    if (!already) {
      script.src = src;
      script.async = true;
      for (const [key, value] of Object.entries(options.attributes || {})) script.setAttribute(key, value);
      document.head.appendChild(script);
    }
  });
  scriptLoads.set(src, promise);
  return promise;
}

/** Test seam: forget that a script was loaded. */
export function resetExternalScripts(): void {
  scriptLoads.clear();
}
