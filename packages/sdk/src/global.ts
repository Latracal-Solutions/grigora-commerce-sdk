import {
  createCommerce,
  getInstance,
  init as initCore,
  isBrowser,
  onReady,
  registerProvider,
  VERSION,
  type GrigoraCommerce,
  type GrigoraCommerceConfig,
  type PaymentPreference,
  type PaymentProviderAdapter,
} from "@grigora/commerce-core";
import { installUI, type UIHandle, type UIOptions } from "@grigora/commerce-ui";
import { stripeAdapter } from "@grigora/commerce-adapter-stripe";
import { razorpayAdapter } from "@grigora/commerce-adapter-razorpay";

export interface StorefrontOptions extends Omit<GrigoraCommerceConfig, "ui"> {
  /** UI options; `false` for headless. */
  ui?: UIOptions & { enabled?: boolean };
  adapters?: PaymentProviderAdapter[];
}

/**
 * One call for the common case: core instance + built-in adapters + UI.
 * Returns the commerce instance; the UI handle is on `commerce.ui`.
 */
export function createStorefront(options: StorefrontOptions): GrigoraCommerce {
  const { ui, adapters, ...config } = options;
  for (const adapter of [stripeAdapter, razorpayAdapter, ...(adapters || [])]) registerProvider(adapter);
  const commerce = initCore({ ...config, ui: (ui && typeof ui === "object" ? ui : {}) as unknown as Record<string, unknown> });
  if (isBrowser() && (ui === undefined || (ui as { enabled?: boolean }).enabled !== false)) {
    if (!commerce.ui) installUI(commerce, ui && typeof ui === "object" ? ui : {});
  }
  return commerce;
}

export interface GrigoraGlobal {
  q?: Array<() => void> & { push?: (fn: () => void) => number };
  Commerce?: GrigoraCommerceGlobal;
}

export interface GrigoraCommerceGlobal {
  version: string;
  init(config: StorefrontOptions): GrigoraCommerce;
  create(config: GrigoraCommerceConfig): GrigoraCommerce;
  get(): GrigoraCommerce | null;
  onReady(callback: (commerce: GrigoraCommerce) => void): void;
  registerProvider(adapter: PaymentProviderAdapter): void;
  installUI(commerce: GrigoraCommerce, options?: UIOptions): UIHandle;
  adapters: { stripe: PaymentProviderAdapter; razorpay: PaymentProviderAdapter };
  openCart(): void;
  closeCart(): void;
  openCheckout(): void;
}

declare global {
  interface Window {
    Grigora?: GrigoraGlobal;
  }
}

function withUI(fn: (ui: UIHandle) => void): void {
  const instance = getInstance();
  const ui = instance?.ui as UIHandle | undefined;
  if (ui) fn(ui);
}

/**
 * Expose `window.Grigora.Commerce` and run anything queued on `window.Grigora.q`
 * before the script loaded. Idempotent.
 */
export function installGlobal(): GrigoraCommerceGlobal {
  const globalObject = globalThis as unknown as { Grigora?: GrigoraGlobal };
  const grigora: GrigoraGlobal = globalObject.Grigora || (globalObject.Grigora = {});
  if (grigora.Commerce && grigora.Commerce.version === VERSION) return grigora.Commerce;

  const api: GrigoraCommerceGlobal = {
    version: VERSION,
    init: createStorefront,
    create: createCommerce,
    get: getInstance,
    onReady,
    registerProvider,
    installUI,
    adapters: { stripe: stripeAdapter, razorpay: razorpayAdapter },
    openCart: () => withUI((ui) => ui.openCart()),
    closeCart: () => withUI((ui) => ui.closeCart()),
    openCheckout: () => withUI((ui) => ui.openCheckout()),
  };
  grigora.Commerce = api;

  // Flush the pre-load queue, then make later pushes run immediately.
  const queued = Array.isArray(grigora.q) ? grigora.q.slice() : [];
  const live: Array<() => void> & { push: (fn: () => void) => number } = Object.assign([], {
    push(fn: () => void) {
      try {
        fn();
      } catch (error) {
        console.error("[grigora-commerce] queued callback threw", error);
      }
      return 0;
    },
  });
  grigora.q = live;
  for (const fn of queued) live.push(fn);
  return api;
}

function attr(script: Element | null, name: string): string {
  return (script?.getAttribute(`data-${name}`) || "").trim();
}

function flag(value: string, fallback: boolean): boolean {
  if (!value) return fallback;
  return !["false", "0", "no", "off"].includes(value.toLowerCase());
}

/**
 * Read configuration from the <script> tag (or <html data-g-project>) and
 * start the storefront. Returns null when no project id can be found, in which
 * case the page is expected to call Grigora.Commerce.init itself.
 */
export function autoInit(script: Element | null = typeof document !== "undefined" ? document.currentScript : null): GrigoraCommerce | null {
  if (!isBrowser()) return null;
  const projectId =
    attr(script, "project") ||
    (document.documentElement.getAttribute("data-g-project") || "").trim() ||
    (document.querySelector('meta[name="grigora:project"]')?.getAttribute("content") || "").trim();
  if (!projectId) return null;
  if (attr(script, "auto-init") && !flag(attr(script, "auto-init"), true)) return null;

  const payment = attr(script, "payment");
  const cartMode = attr(script, "cart-mode");
  const placement = attr(script, "checkout-placement");
  const ui: UIOptions & { enabled?: boolean } = {
    enabled: flag(attr(script, "ui"), true),
    cartMode: cartMode === "page" || cartMode === "none" ? cartMode : "drawer",
    cartUrl: attr(script, "cart-url") || undefined,
    checkoutUrl: attr(script, "checkout-url") || undefined,
    checkoutPlacement: placement === "page" || placement === "dialog" ? placement : undefined,
    autoOpenCartOnAdd: flag(attr(script, "auto-open"), true),
    autobind: flag(attr(script, "autobind"), true),
    injectStyles: flag(attr(script, "styles"), true),
    handleReturn: flag(attr(script, "handle-return"), true),
    continueShoppingUrl: attr(script, "continue-url") || undefined,
    theme: {
      ...(attr(script, "accent") ? { accent: attr(script, "accent") } : {}),
      ...(attr(script, "font") ? { font: attr(script, "font") } : {}),
      ...(attr(script, "radius") ? { radius: attr(script, "radius") } : {}),
    },
  };

  return createStorefront({
    projectId,
    apiBase: attr(script, "api-base") || undefined,
    currency: attr(script, "currency") || undefined,
    locale: attr(script, "locale") || undefined,
    successUrl: attr(script, "success-url") || undefined,
    cancelUrl: attr(script, "cancel-url") || undefined,
    payment: payment === "embedded" || payment === "hosted" ? (payment as PaymentPreference) : "auto",
    debug: flag(attr(script, "debug"), false),
    ui,
  });
}
