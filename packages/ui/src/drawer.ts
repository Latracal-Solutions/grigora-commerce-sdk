import type { Cart, CartLine, GrigoraCommerce } from "@grigora/commerce-core";
import { getContext, requireContext, whenContext, type UIContext } from "./context";
import { clear, h, icon, image, lockScroll, replaceChildren, safeHref, trapFocus } from "./dom";

let idCounter = 0;

/**
 * <g-cart-drawer>: the slide-in cart. Also the engine behind <g-cart>, which
 * renders the same content inline on a cart page.
 *
 * Rows are rebuilt from the cart snapshot on every change (carts are small);
 * the element whose control had focus is refocused by a stable key so a
 * shopper tapping "+" repeatedly is not thrown off the button.
 */
export class GCartDrawer extends HTMLElement {
  commerce?: GrigoraCommerce;
  protected inline = false;
  private ctx: UIContext | null = null;
  private unsubscribe: (() => void) | null = null;
  private built = false;
  private isOpen = false;
  private opener: HTMLElement | null = null;
  private untrap: (() => void) | null = null;
  private unlock: (() => void) | null = null;
  private overlay!: HTMLElement;
  private panel!: HTMLElement;
  private titleEl!: HTMLElement;
  private countEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private footEl!: HTMLElement;
  private closeBtn!: HTMLButtonElement;
  private discountInput: HTMLInputElement | null = null;
  private discountBusy = false;
  private discountMessage: { text: string; type: "error" | "success" } | null = null;
  private pendingFocusKey = "";
  private unwait: (() => void) | null = null;

  static get observedAttributes(): string[] {
    return ["open"];
  }

  connectedCallback(): void {
    this.ctx = getContext();
    if (!this.ctx && !this.commerce) {
      this.unwait = whenContext(() => {
        this.unwait = null;
        if (this.isConnected) this.connectedCallback();
      });
      return;
    }
    this.build();
    const commerce = this.commerceOrThrow();
    this.unsubscribe = commerce.on("cart:changed", (cart) => this.render(cart));
    this.render(commerce.cart.get());
    if (this.hasAttribute("open") && !this.inline) this.show();
  }

  disconnectedCallback(): void {
    this.unwait?.();
    this.unwait = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.isOpen) this.hide(false);
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name !== "open" || !this.built || this.inline) return;
    if (value !== null && !this.isOpen) this.show();
    if (value === null && this.isOpen) this.hide();
  }

  private commerceOrThrow(): GrigoraCommerce {
    // The instance this element connected with; the global only as a last resort.
    return this.commerce || this.ctx?.commerce || requireContext().commerce;
  }

  private commerceOrNull(): GrigoraCommerce | null {
    return this.commerce || getContext()?.commerce || null;
  }

  private t(key: Parameters<UIContext["t"]>[0], vars?: Record<string, string | number>): string {
    return (this.ctx || requireContext()).t(key, vars);
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const id = `g-cart-title-${++idCounter}`;
    this.style.display = "block";
    this.countEl = h("span", { class: "g-cart-count-pill", hidden: true });
    this.titleEl = h("h2", { class: "g-cart-title", id }, this.t("cartTitle"), " ", this.countEl);
    this.closeBtn = h("button", { type: "button", class: "g-icon-btn", "aria-label": this.t("closeCart"), onClick: () => this.hide() }, icon("close", 18));
    this.bodyEl = h("div", { class: "g-cart-body" });
    this.footEl = h("footer", { class: "g-cart-foot" });
    this.panel = h(
      "aside",
      {
        class: "g-cart-drawer",
        "data-g-ui": "",
        tabindex: "-1",
        ...(this.inline ? { "data-inline": "" } : { role: "dialog", "aria-modal": "true", "aria-labelledby": id, "aria-hidden": "true" }),
      },
      h("header", { class: "g-cart-head" }, this.titleEl, this.inline ? null : this.closeBtn),
      this.bodyEl,
      this.footEl
    );
    this.overlay = h("div", { class: "g-cart-overlay", "data-g-ui": "", hidden: this.inline, onClick: () => this.hide() });
    this.appendChild(this.overlay);
    this.appendChild(this.panel);
  }

  // ------------------------------------------------------------ open/close

  show(opener?: HTMLElement | null): void {
    if (this.inline || this.isOpen) return;
    this.isOpen = true;
    this.opener = opener || (document.activeElement as HTMLElement | null);
    const commerce = this.commerceOrThrow();
    this.overlay.setAttribute("data-open", "");
    this.panel.setAttribute("data-open", "");
    this.panel.setAttribute("aria-hidden", "false");
    if (!this.hasAttribute("open")) this.setAttribute("open", "");
    this.unlock = lockScroll();
    this.untrap = trapFocus(this.panel, () => this.hide());
    this.closeBtn.focus();
    void commerce.cart.validate();
    commerce.emit("cart:opened", commerce.cart.get());
  }

  hide(restoreFocus = true): void {
    if (this.inline || !this.isOpen) return;
    this.isOpen = false;
    this.overlay.removeAttribute("data-open");
    this.panel.removeAttribute("data-open");
    this.panel.setAttribute("aria-hidden", "true");
    if (this.hasAttribute("open")) this.removeAttribute("open");
    this.untrap?.();
    this.untrap = null;
    this.unlock?.();
    this.unlock = null;
    const commerce = this.commerceOrNull();
    if (commerce) commerce.emit("cart:closed", commerce.cart.get());
    if (restoreFocus && this.opener && document.contains(this.opener)) this.opener.focus();
    this.opener = null;
  }

  toggle(opener?: HTMLElement | null): void {
    if (this.isOpen) this.hide();
    else this.show(opener);
  }

  get open(): boolean {
    return this.isOpen;
  }

  // --------------------------------------------------------------- render

  render(cart: Cart): void {
    if (!this.built) return;
    const active = document.activeElement as HTMLElement | null;
    const focusKey = (active && this.panel.contains(active) ? active.getAttribute("data-focus-key") : "") || this.pendingFocusKey;
    this.countEl.textContent = String(cart.itemCount);
    if (cart.itemCount > 0) this.countEl.removeAttribute("hidden");
    else this.countEl.setAttribute("hidden", "");
    this.renderBody(cart);
    this.renderFoot(cart);
    this.pendingFocusKey = "";
    if (focusKey) {
      const target = this.panel.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`);
      if (target && !target.hasAttribute("disabled")) target.focus();
      else if (target) this.pendingFocusKey = focusKey;
    }
  }

  private renderBody(cart: Cart): void {
    const commerce = this.commerceOrThrow();
    const children: Node[] = [];
    if (cart.error) {
      children.push(
        h(
          "div",
          { class: "g-alert", role: "alert" },
          icon("alert", 16),
          h("span", null, cart.error.message),
          h("button", { type: "button", class: "g-btn g-btn-secondary g-btn-sm", onClick: () => void commerce.cart.validate() }, this.t("retry"))
        )
      );
    }
    if (!cart.lines.length) {
      children.push(
        h(
          "div",
          { class: "g-cart-empty" },
          icon("bag", 44),
          h("p", null, this.t("cartEmpty")),
          h("a", { class: "g-btn g-btn-secondary", href: safeHref(this.ctx?.options.continueShoppingUrl || "/"), onClick: () => this.hide() }, this.t("continueShopping"))
        )
      );
    } else {
      for (const line of cart.lines) children.push(this.renderLine(line, cart));
    }
    replaceChildren(this.bodyEl, ...children);
  }

  private renderLine(line: CartLine, cart: Cart): HTMLElement {
    const commerce = this.commerceOrThrow();
    const img = image(line.imageUrl, line.title);
    const thumbInner = img || icon("package", 24);
    const thumb = line.productUrl
      ? h("a", { class: "g-cart-thumb", href: safeHref(line.productUrl), "aria-label": line.title, tabindex: "-1" }, thumbInner)
      : h("div", { class: "g-cart-thumb" }, thumbInner);
    const title = line.productUrl
      ? h("a", { class: "g-cart-line-title", href: safeHref(line.productUrl) }, line.title || "Item")
      : h("div", { class: "g-cart-line-title" }, line.title || "Item");
    const qty = h(
      "div",
      { class: "g-qty", role: "group", "aria-label": this.t("quantity") },
      h(
        "button",
        {
          type: "button",
          "aria-label": this.t("decrease"),
          "data-focus-key": `dec:${line.lineId}`,
          disabled: line.quantity <= 1,
          onClick: () => void commerce.cart.increment(line.lineId, -1),
        },
        icon("minus", 14)
      ),
      h("output", { "aria-live": "polite" }, String(line.quantity)),
      h(
        "button",
        {
          type: "button",
          "aria-label": this.t("increase"),
          "data-focus-key": `inc:${line.lineId}`,
          disabled: line.available !== null && line.quantity >= line.available,
          onClick: () => void commerce.cart.increment(line.lineId, 1),
        },
        icon("plus", 14)
      )
    );
    const remove = h(
      "button",
      { type: "button", class: "g-link-btn", "data-focus-key": `rm:${line.lineId}`, onClick: () => void commerce.cart.remove(line.lineId) },
      this.t("remove")
    );
    const meta: Node[] = [];
    if (!line.inStock) meta.push(h("span", { class: "g-badge g-badge-danger" }, this.t("outOfStock")));
    else if (line.available !== null && line.available > 0 && line.available <= 5) {
      meta.push(h("span", { class: "g-badge g-badge-muted" }, this.t("lowStock", { count: line.available })));
    }
    const price = h(
      "div",
      { class: "g-cart-line-price" },
      commerce.formatCurrency(line.totalAmount, line.currency),
      line.quantity > 1 ? h("span", { class: "g-cart-line-unit" }, `${commerce.formatCurrency(line.unitAmount, line.currency)} × ${line.quantity}`) : null
    );
    return h(
      "div",
      { class: "g-cart-line", "data-line-id": line.lineId },
      thumb,
      h("div", { class: "g-cart-line-main" }, title, meta.length ? h("div", { class: "g-cart-line-meta" }, ...meta) : null, h("div", { class: "g-cart-line-actions" }, qty, remove)),
      price
    );
  }

  private renderFoot(cart: Cart): void {
    const ctx = this.ctx || requireContext();
    const commerce = this.commerceOrThrow();
    const children: Node[] = [];
    const showDiscount = ctx.options.drawerDiscount && this.getAttribute("discount") !== "off" && cart.lines.length > 0;
    if (showDiscount) children.push(this.renderDiscount(cart));

    const money = (amount: number) => commerce.formatCurrency(amount, cart.currency);
    const pendingTotals = cart.validating && !cart.validated && cart.lines.length > 0;
    const skeleton = () => h("span", { class: "g-skeleton", "aria-hidden": "true" });
    const rows: Node[] = [h("div", { class: "g-row" }, h("span", null, this.t("subtotal")), h("strong", null, pendingTotals ? skeleton() : money(cart.subtotalAmount)))];
    if (cart.discountAmount > 0) {
      rows.push(h("div", { class: "g-row" }, h("span", null, `${this.t("discount")}${cart.discountCode ? ` (${cart.discountCode})` : ""}`), h("strong", null, `−${money(cart.discountAmount)}`)));
    }
    if (cart.requiresShipping) {
      const shippingValue = cart.validated && cart.shippingQuote?.eligible && cart.shippingQuote.required ? money(cart.shippingAmount) : this.t("calculatedAtCheckout");
      rows.push(h("div", { class: "g-row" }, h("span", null, this.t("shipping")), h("strong", null, pendingTotals ? skeleton() : shippingValue)));
    }
    if (cart.taxAmount > 0) {
      rows.push(h("div", { class: "g-row" }, h("span", null, `${this.t("tax")}${cart.totalIsEstimate ? ` (${this.t("estimated").toLowerCase()})` : ""}`), h("strong", null, money(cart.taxAmount))));
    }
    rows.push(
      h(
        "div",
        { class: "g-row g-row-total" },
        h("span", null, cart.validated && cart.totalIsEstimate ? `${this.t("total")} (${this.t("estimated").toLowerCase()})` : this.t("total")),
        h("span", null, pendingTotals ? skeleton() : money(cart.validated ? cart.totalAmount : cart.subtotalAmount))
      )
    );
    children.push(h("div", { class: "g-rows" }, ...rows));

    const blocked = !cart.lines.length || !cart.allInStock || pendingTotals;
    children.push(
      h(
        "button",
        { type: "button", class: "g-btn g-btn-primary g-btn-block", disabled: blocked, "data-cart-checkout": "", onClick: () => ctx.openCheckout() },
        icon("lock", 16),
        this.t("checkout")
      )
    );
    children.push(h("p", { class: "g-note" }, !cart.allInStock ? this.t("removeOutOfStock") : cart.requiresShipping || !cart.validated ? this.t("calculatedAtCheckout") : ""));
    replaceChildren(this.footEl, ...children);
  }

  private renderDiscount(cart: Cart): HTMLElement {
    const commerce = this.commerceOrThrow();
    if (cart.discountCode && cart.validated) {
      return h(
        "div",
        { class: "g-discount-applied" },
        h("span", null, icon("tag", 14), " ", this.t("discountAppliedLabel"), " ", h("code", null, cart.discountCode)),
        h("button", { type: "button", class: "g-link-btn", onClick: () => void commerce.cart.setDiscount(null).catch(() => {}) }, this.t("remove"))
      );
    }
    const input = h("input", {
      class: "g-input",
      type: "text",
      autocomplete: "off",
      autocapitalize: "characters",
      placeholder: this.t("discountPlaceholder"),
      "aria-label": this.t("discountPlaceholder"),
      "data-focus-key": "discount-input",
      value: this.discountInput?.value || "",
      onKeydown: ((event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.applyDiscount();
        }
      }) as EventListener,
    });
    this.discountInput = input;
    const apply = h("button", { type: "button", class: "g-btn g-btn-secondary", disabled: this.discountBusy, onClick: () => void this.applyDiscount() }, this.t("apply"));
    const wrapper = h("div", null, h("div", { class: "g-discount" }, input, apply));
    if (this.discountMessage) {
      wrapper.appendChild(h("p", { class: `g-note${this.discountMessage.type === "error" ? " g-field-error" : " g-added"}`, role: "status" }, this.discountMessage.text));
    }
    return wrapper;
  }

  private async applyDiscount(): Promise<void> {
    const commerce = this.commerceOrThrow();
    const code = (this.discountInput?.value || "").trim();
    if (!code || this.discountBusy) return;
    this.discountBusy = true;
    this.discountMessage = null;
    this.render(commerce.cart.get());
    try {
      await commerce.cart.setDiscount(code);
      this.discountMessage = null;
      if (this.discountInput) this.discountInput.value = "";
    } catch (error) {
      this.discountMessage = { text: (error as Error).message || this.t("error"), type: "error" };
    } finally {
      this.discountBusy = false;
      this.render(commerce.cart.get());
      this.panel.querySelector<HTMLElement>('[data-focus-key="discount-input"]')?.focus();
    }
  }
}

/** <g-cart>: the drawer's content rendered inline, for a dedicated cart page. */
export class GCart extends GCartDrawer {
  constructor() {
    super();
    this.inline = true;
  }
}

export function clearElement(el: Element): void {
  clear(el);
}
