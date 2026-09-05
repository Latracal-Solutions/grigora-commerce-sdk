import type { Cart, GrigoraCommerce } from "@grigora/commerce-core";
import { getContext, requireContext, whenContext } from "./context";
import { h, icon, replaceChildren } from "./dom";

/** <g-cart-badge>: the live item count. Hidden at zero unless `show-zero` is set. */
export class GCartBadge extends HTMLElement {
  commerce?: GrigoraCommerce;
  private unsubscribe: (() => void) | null = null;
  private unwait: (() => void) | null = null;

  connectedCallback(): void {
    const commerce = this.commerce || getContext()?.commerce;
    if (!commerce) {
      this.unwait = whenContext(() => {
        this.unwait = null;
        if (this.isConnected) this.connectedCallback();
      });
      return;
    }
    this.setAttribute("data-g-ui", "");
    this.setAttribute("aria-live", "polite");
    this.setAttribute("aria-atomic", "true");
    this.unsubscribe = commerce.on("cart:changed", (cart) => this.render(cart));
    this.render(commerce.cart.get());
  }

  disconnectedCallback(): void {
    this.unwait?.();
    this.unwait = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  render(cart: Cart): void {
    this.textContent = String(cart.itemCount);
    if (cart.itemCount > 0 || this.hasAttribute("show-zero")) this.removeAttribute("hidden");
    else this.setAttribute("hidden", "");
  }
}

/** <g-cart-launcher>: a cart button with the badge, wired to open the cart. */
export class GCartLauncher extends HTMLElement {
  commerce?: GrigoraCommerce;
  private unwait: (() => void) | null = null;

  connectedCallback(): void {
    const ctx = getContext();
    if (!ctx && !this.commerce) {
      this.unwait = whenContext(() => {
        this.unwait = null;
        if (this.isConnected) this.connectedCallback();
      });
      return;
    }
    this.unwait = null;
    const t = (ctx || requireContext()).t;
    this.setAttribute("data-g-ui", "");
    const badge = document.createElement("g-cart-badge") as GCartBadge;
    if (this.commerce) badge.commerce = this.commerce;
    const label = this.getAttribute("label") || "";
    const button = h(
      "button",
      { type: "button", class: "g-btn g-btn-secondary", "aria-haspopup": "dialog", "aria-label": label || t("cartTitle"), onClick: () => requireContext().openCart(button) },
      icon("cart", 18),
      label ? h("span", null, label) : null,
      badge
    );
    replaceChildren(this, button);
  }
}
