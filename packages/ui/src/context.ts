import type { GrigoraCommerce } from "@grigora/commerce-core";
import { translator, type Translate, type UIStrings } from "./i18n";
import type { UITheme } from "./styles";

export type CartMode = "drawer" | "page" | "none";
export type CheckoutPlacement = "dialog" | "page";

export interface UIOptions {
  /** "drawer" (default) creates a slide-in cart; "page" expects a <g-cart> on a cart page; "none" disables the built-in cart UI. */
  cartMode?: CartMode;
  /** A cart page URL used by the launcher when cartMode is "page". Default "/cart". */
  cartUrl?: string;
  /** Where the checkout renders. Default: "page" when checkoutUrl is set, else "dialog". */
  checkoutPlacement?: CheckoutPlacement;
  /** The page hosting <g-checkout>. Setting it switches checkoutPlacement to "page". */
  checkoutUrl?: string;
  /** Open the drawer after an add-to-cart. Default true. */
  autoOpenCartOnAdd?: boolean;
  /** Bind data-* attributes and keep [data-cart-count] in sync. Default true. */
  autobind?: boolean;
  /** Inject the stylesheet. Default true. */
  injectStyles?: boolean;
  /** Read order_id/lookup_token (and Stripe's payment_intent) from the URL on load. Default true. */
  handleReturn?: boolean;
  /** Apply the store's accent colour from its settings. Default true. */
  useStoreTheme?: boolean;
  theme?: Partial<UITheme>;
  strings?: Partial<UIStrings>;
  /** "Continue shopping" destination. Default "/". */
  continueShoppingUrl?: string;
  /** Show the discount field in the drawer. Default true. */
  drawerDiscount?: boolean;
}

export interface ResolvedUIOptions {
  cartMode: CartMode;
  cartUrl: string;
  checkoutPlacement: CheckoutPlacement;
  checkoutUrl: string;
  autoOpenCartOnAdd: boolean;
  autobind: boolean;
  injectStyles: boolean;
  handleReturn: boolean;
  useStoreTheme: boolean;
  theme: Partial<UITheme>;
  strings: Partial<UIStrings>;
  continueShoppingUrl: string;
  drawerDiscount: boolean;
}

export function resolveUIOptions(options: UIOptions = {}, fromConfig: Record<string, unknown> = {}): ResolvedUIOptions {
  const merged: UIOptions = { ...(fromConfig as UIOptions), ...options };
  const checkoutUrl = typeof merged.checkoutUrl === "string" ? merged.checkoutUrl.trim() : "";
  const cartMode: CartMode = merged.cartMode === "page" || merged.cartMode === "none" ? merged.cartMode : "drawer";
  return {
    cartMode,
    cartUrl: typeof merged.cartUrl === "string" && merged.cartUrl.trim() ? merged.cartUrl.trim() : "/cart",
    checkoutPlacement: merged.checkoutPlacement === "page" || merged.checkoutPlacement === "dialog" ? merged.checkoutPlacement : checkoutUrl ? "page" : "dialog",
    checkoutUrl: checkoutUrl || "/checkout",
    autoOpenCartOnAdd: merged.autoOpenCartOnAdd !== false && cartMode === "drawer",
    autobind: merged.autobind !== false,
    injectStyles: merged.injectStyles !== false,
    handleReturn: merged.handleReturn !== false,
    useStoreTheme: merged.useStoreTheme !== false,
    theme: merged.theme && typeof merged.theme === "object" ? { ...merged.theme } : {},
    strings: merged.strings && typeof merged.strings === "object" ? { ...merged.strings } : {},
    continueShoppingUrl: typeof merged.continueShoppingUrl === "string" && merged.continueShoppingUrl.trim() ? merged.continueShoppingUrl.trim() : "/",
    drawerDiscount: merged.drawerDiscount !== false,
  };
}

/**
 * The UI surfaces share one commerce instance and one options object. Custom
 * elements cannot take constructor arguments, so they read them from here; a
 * page that runs several stores can still pass an instance explicitly via
 * `element.commerce = ...` before connecting.
 */
export interface UIContext {
  commerce: GrigoraCommerce;
  options: ResolvedUIOptions;
  t: Translate;
  openCart(opener?: HTMLElement | null): void;
  closeCart(): void;
  toggleCart(opener?: HTMLElement | null): void;
  openCheckout(): void;
  closeCheckout(): void;
  showOrderStatus(input: { orderId: string; lookupToken: string }): void;
  notify(message: string, type?: "info" | "error" | "success"): void;
}

let current: UIContext | null = null;

export function setContext(context: UIContext | null): void {
  current = context;
}

export function getContext(): UIContext | null {
  return current;
}

export function requireContext(): UIContext {
  if (!current) {
    throw new Error("Grigora Commerce UI is not installed. Call installUI(commerce) or load the CDN bundle with data-project.");
  }
  return current;
}

export function makeTranslator(options: ResolvedUIOptions): Translate {
  return translator(options.strings);
}
