import { isBrowser, type GrigoraCommerce } from "@grigora/commerce-core";
import { installAutobind } from "./autobind";
import { GCartBadge, GCartLauncher } from "./badge";
import { GAddToCart, GBuyBox, GPrice } from "./buy-box";
import { GCheckout } from "./checkout";
import { makeTranslator, resolveUIOptions, setContext, type ResolvedUIOptions, type UIContext, type UIOptions } from "./context";
import { openDialog, type DialogHandle } from "./dialog";
import { GCart, GCartDrawer } from "./drawer";
import { GOrderStatus } from "./order-status";
import { getReturn } from "./return";
import { applyTheme, injectStyles, type UITheme } from "./styles";
import { showToast } from "./toast";

export interface UIHandle {
  readonly options: ResolvedUIOptions;
  openCart(opener?: HTMLElement | null): void;
  closeCart(): void;
  toggleCart(opener?: HTMLElement | null): void;
  openCheckout(): void;
  closeCheckout(): void;
  showOrderStatus(input: { orderId: string; lookupToken: string }): void;
  notify(message: string, type?: "info" | "error" | "success"): void;
  /** Re-apply theme variables at runtime. */
  setTheme(theme: Partial<UITheme>): void;
  destroy(): void;
}

const ELEMENTS: Array<[string, CustomElementConstructor]> = [
  ["g-cart-drawer", GCartDrawer],
  ["g-cart", GCart],
  ["g-cart-badge", GCartBadge],
  ["g-cart-launcher", GCartLauncher],
  ["g-buy-box", GBuyBox],
  ["g-add-to-cart", GAddToCart],
  ["g-price", GPrice],
  ["g-checkout", GCheckout],
  ["g-order-status", GOrderStatus],
];

/** Register the custom elements once. Safe to call repeatedly and on the server (no-op). */
export function defineElements(): void {
  if (!isBrowser() || typeof customElements === "undefined") return;
  for (const [tag, ctor] of ELEMENTS) {
    if (!customElements.get(tag)) customElements.define(tag, ctor);
  }
}

/**
 * Wire the UI to a commerce instance: styles, custom elements, data-attribute
 * bindings, the drawer, and return-URL handling. Returns a handle that is also
 * exposed as `commerce.ui`.
 */
export function installUI(commerce: GrigoraCommerce, options: UIOptions = {}): UIHandle {
  if (!isBrowser()) {
    throw new Error("installUI needs a browser environment; call it from an effect or after hydration.");
  }
  const resolved = resolveUIOptions(options, commerce.config.ui);
  const t = makeTranslator(resolved);
  let theme: Partial<UITheme> = { ...resolved.theme };
  if (resolved.injectStyles) injectStyles(document, theme);
  defineElements();

  let checkoutDialog: DialogHandle | null = null;
  let statusDialog: DialogHandle | null = null;

  const findDrawer = (): GCartDrawer | null => {
    const existing = document.querySelector<GCartDrawer>("g-cart-drawer");
    if (existing) return existing;
    if (resolved.cartMode !== "drawer") return null;
    const drawer = document.createElement("g-cart-drawer") as GCartDrawer;
    document.body.appendChild(drawer);
    return drawer;
  };

  const ctx: UIContext = {
    commerce,
    options: resolved,
    t,
    openCart(opener) {
      if (resolved.cartMode === "none") return;
      if (resolved.cartMode === "page") {
        if (!document.querySelector("g-cart")) commerce.navigate(resolved.cartUrl);
        return;
      }
      findDrawer()?.show(opener || null);
    },
    closeCart() {
      document.querySelector<GCartDrawer>("g-cart-drawer")?.hide();
    },
    toggleCart(opener) {
      if (resolved.cartMode !== "drawer") ctx.openCart(opener);
      else findDrawer()?.toggle(opener || null);
    },
    openCheckout() {
      ctx.closeCart();
      const inline = document.querySelector<GCheckout>("g-checkout");
      if (resolved.checkoutPlacement === "page") {
        if (inline) inline.scrollIntoView?.({ behavior: "smooth", block: "start" });
        else commerce.navigate(resolved.checkoutUrl);
        return;
      }
      if (inline && !inline.closest(".g-dialog")) {
        inline.scrollIntoView?.({ behavior: "smooth", block: "start" });
        return;
      }
      if (checkoutDialog?.isOpen()) return;
      const checkout = document.createElement("g-checkout") as GCheckout;
      checkoutDialog = openDialog(checkout, {
        label: t("checkout"),
        size: "lg",
        closeLabel: t("close"),
        beforeClose: () => !checkout.busy,
        onClose: () => {
          checkoutDialog = null;
        },
      });
    },
    closeCheckout() {
      checkoutDialog?.close();
    },
    showOrderStatus({ orderId, lookupToken }) {
      if (statusDialog?.isOpen()) return;
      const status = document.createElement("g-order-status") as GOrderStatus;
      status.setAttribute("order-id", orderId);
      status.setAttribute("lookup-token", lookupToken);
      statusDialog = openDialog(status, {
        label: t("order", { ref: "" }).trim(),
        size: "sm",
        closeLabel: t("close"),
        onClose: () => {
          statusDialog = null;
        },
      });
    },
    notify(message, type) {
      showToast(message, type);
    },
  };
  setContext(ctx);

  // The store's accent colour becomes the UI accent unless the integrator set one.
  const applyStoreTheme = () => {
    const store = commerce.store.current();
    if (!resolved.useStoreTheme || !store) return;
    const next: Partial<UITheme> = { ...theme };
    if (!resolved.theme.accent && /^#[0-9a-f]{3,8}$/i.test(store.appearance.accentColor)) next.accent = store.appearance.accentColor;
    theme = next;
    if (resolved.injectStyles) applyTheme(document, theme);
  };
  const offStore = commerce.on("store:loaded", applyStoreTheme);
  applyStoreTheme();
  void commerce.store.get().catch(() => {});

  let unbind: (() => void) | null = null;
  if (resolved.autobind) unbind = installAutobind(ctx);

  const start = () => {
    if (resolved.cartMode === "drawer") findDrawer();
    if (resolved.handleReturn) {
      void getReturn(commerce).then((returned) => {
        if (!returned) return;
        if (document.querySelector("g-checkout,g-order-status,[data-grigora-checkout],[data-grigora-order-status]")) return;
        ctx.showOrderStatus({ orderId: returned.orderId, lookupToken: returned.lookupToken });
      });
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  const handle: UIHandle = {
    options: resolved,
    openCart: ctx.openCart,
    closeCart: ctx.closeCart,
    toggleCart: ctx.toggleCart,
    openCheckout: ctx.openCheckout,
    closeCheckout: ctx.closeCheckout,
    showOrderStatus: ctx.showOrderStatus,
    notify: ctx.notify,
    setTheme(next) {
      theme = { ...theme, ...next };
      applyTheme(document, theme);
    },
    destroy() {
      unbind?.();
      offStore();
      checkoutDialog?.close();
      statusDialog?.close();
      setContext(null);
      if (commerce.ui === handle) commerce.ui = undefined;
    },
  };
  commerce.ui = handle;
  return handle;
}
