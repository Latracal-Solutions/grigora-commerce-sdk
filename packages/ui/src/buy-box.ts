import { isValidEmail, type GrigoraCommerce, type Product, type ProductVariant } from "@grigora/commerce-core";
import { getContext, requireContext, whenContext, type UIContext } from "./context";
import { openDialog } from "./dialog";
import { h, icon, replaceChildren, dispatch } from "./dom";

/**
 * <g-buy-box product="slug-or-id">: price, option pickers, quantity and the
 * Add to cart / Buy now pair for one product, fed by the storefront API.
 * Pay-what-you-want products get an amount field and a direct checkout; a
 * subscription product (not sellable through this API yet) is shown disabled.
 */
export class GBuyBox extends HTMLElement {
  commerce?: GrigoraCommerce;
  private ctx: UIContext | null = null;
  private product: Product | null = null;
  private selected: Record<string, string> = {};
  private quantity = 1;
  private busy = false;
  private message: { text: string; type: "error" | "success" | "info" } | null = null;
  private addedTimer: ReturnType<typeof setTimeout> | null = null;
  private pwywAmount = 0;
  private unsubscribe: (() => void) | null = null;
  private unwait: (() => void) | null = null;
  /** True once connected with a context; attribute changes before that are ignored (upgrade fires them first). */
  private started = false;

  static get observedAttributes(): string[] {
    return ["product", "variant"];
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
    this.started = true;
    this.setAttribute("data-g-ui", "");
    this.classList.add("g-buybox");
    this.quantity = Math.max(1, Number(this.getAttribute("quantity")) || 1);
    this.unsubscribe = this.commerceOrThrow().on("cart:changed", () => this.render());
    void this.load();
  }

  disconnectedCallback(): void {
    this.started = false;
    this.unwait?.();
    this.unwait = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.addedTimer) clearTimeout(this.addedTimer);
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue || !this.started || !this.isConnected) return;
    if (name === "product") void this.load();
    if (name === "variant") this.applyVariantAttribute();
  }

  private commerceOrThrow(): GrigoraCommerce {
    // The instance this element connected with; the global only as a last resort.
    return this.commerce || this.ctx?.commerce || requireContext().commerce;
  }

  private t(key: Parameters<UIContext["t"]>[0], vars?: Record<string, string | number>): string {
    return (this.ctx || requireContext()).t(key, vars);
  }

  async load(): Promise<void> {
    if (!this.started) return;
    const key = (this.getAttribute("product") || "").trim();
    this.product = null;
    this.message = null;
    if (!key) {
      this.message = { text: "Missing product attribute.", type: "error" };
      this.render();
      return;
    }
    this.renderLoading();
    try {
      const product = await this.commerceOrThrow().products.get(key);
      this.product = product;
      this.selected = {};
      this.applyVariantAttribute();
      if (product.pricingType === "pay_what_you_want") this.pwywAmount = product.priceAmount;
      // A single variant needs no picker; select it so Add works at once.
      if (product.hasVariants && product.variants.length === 1) {
        this.selected = { ...product.variants[0].optionValues };
      }
    } catch (error) {
      this.message = { text: (error as Error).message || this.t("error"), type: "error" };
    }
    this.render();
  }

  private applyVariantAttribute(): void {
    const variantId = (this.getAttribute("variant") || "").trim();
    if (!variantId || !this.product) return;
    const variant = this.product.variants.find((v) => v.id === variantId);
    if (variant) this.selected = { ...variant.optionValues };
  }

  /** The variant matching every chosen option, if all options are chosen. */
  selectedVariant(): ProductVariant | null {
    const product = this.product;
    if (!product || !product.hasVariants) return null;
    const options = product.options.length ? product.options : [];
    if (!options.length) return product.variants[0] || null;
    if (!options.every((option) => this.selected[option.name])) return null;
    return product.variants.find((variant) => options.every((option) => variant.optionValues[option.name] === this.selected[option.name])) || null;
  }

  private valueAvailable(optionName: string, value: string): boolean {
    const product = this.product;
    if (!product) return false;
    return product.variants.some((variant) => {
      if (variant.optionValues[optionName] !== value) return false;
      for (const [name, chosen] of Object.entries(this.selected)) {
        if (name !== optionName && chosen && variant.optionValues[name] !== chosen) return false;
      }
      return variant.inStock;
    });
  }

  private renderLoading(): void {
    replaceChildren(this, h("div", { class: "g-price" }, h("span", { class: "g-skeleton", style: "width:120px;height:24px" })), h("div", { class: "g-skeleton", style: "width:100%;height:46px" }));
  }

  render(): void {
    const commerce = this.commerceOrThrow();
    const product = this.product;
    if (!product) {
      replaceChildren(this, this.message ? h("div", { class: "g-alert", role: "alert" }, icon("alert", 16), h("span", null, this.message.text)) : null);
      return;
    }
    const variant = this.selectedVariant();
    const priceAmount = variant ? variant.priceAmount : product.priceAmount;
    const compareAt = variant ? variant.compareAtAmount : product.compareAtAmount;
    const currency = variant ? variant.currency : product.currency;
    const inStock = variant ? variant.inStock : product.hasVariants ? product.inStock : product.inStock;
    const available = variant ? variant.available : product.available;
    const needsChoice = product.hasVariants && !variant;
    const pwyw = product.pricingType === "pay_what_you_want";
    const subscription = product.pricingType === "subscription";
    const children: Node[] = [];

    if (this.getAttribute("show-price") !== "off") {
      children.push(
        h(
          "div",
          { class: "g-price" },
          h("span", { class: "g-price-now" }, pwyw ? this.t("payWhatYouWant") : commerce.formatCurrency(priceAmount, currency)),
          !pwyw && compareAt > priceAmount ? h("s", { class: "g-price-was" }, commerce.formatCurrency(compareAt, currency)) : null
        )
      );
    }

    for (const option of product.options) {
      children.push(
        h(
          "div",
          { class: "g-option", role: "group", "aria-label": option.name },
          h("div", { class: "g-option-label" }, option.name),
          h(
            "div",
            { class: "g-option-values" },
            ...option.values.map((value) => {
              const pressed = this.selected[option.name] === value;
              const unavailable = !this.valueAvailable(option.name, value);
              return h(
                "button",
                {
                  type: "button",
                  class: "g-chip",
                  "aria-pressed": pressed ? "true" : "false",
                  "data-unavailable": unavailable ? "" : null,
                  onClick: () => {
                    this.selected = { ...this.selected, [option.name]: pressed ? "" : value };
                    this.message = null;
                    this.render();
                  },
                },
                value
              );
            })
          )
        )
      );
    }

    if (!subscription) {
      const stock = h("div", { class: "g-stock" });
      if (needsChoice) stock.textContent = this.t("chooseOption", { option: product.options.map((o) => o.name.toLowerCase()).join(" / ") });
      else if (!inStock) {
        stock.textContent = this.t("soldOut");
        stock.setAttribute("data-out", "");
      } else if (available !== null && available <= 5) {
        stock.textContent = this.t("lowStock", { count: available });
        stock.setAttribute("data-low", "");
      } else stock.textContent = this.t("inStock");
      children.push(stock);
    }

    if (pwyw) {
      const input = h("input", {
        class: "g-input",
        type: "number",
        min: String(product.priceAmount / 100),
        step: "0.01",
        value: (this.pwywAmount / 100).toFixed(2),
        "aria-label": this.t("payWhatYouWant"),
        onInput: ((event: Event) => {
          this.pwywAmount = commerce.currency.toMinor(Number((event.target as HTMLInputElement).value) || 0);
        }) as EventListener,
      });
      children.push(
        h("div", { class: "g-pwyw" }, h("span", null, commerce.currency.symbol(currency)), input, product.priceAmount > 0 ? h("span", { class: "g-stock" }, this.t("minimum", { amount: commerce.formatCurrency(product.priceAmount, currency) })) : null)
      );
      children.push(
        h("div", { class: "g-buybox-actions" }, h("button", { type: "button", class: "g-btn g-btn-primary", disabled: this.busy || !inStock, onClick: () => void this.payWhatYouWant() }, this.busy ? h("span", { class: "g-spinner" }) : icon("lock", 16), this.t("continue")))
      );
    } else if (subscription) {
      children.push(h("div", { class: "g-buybox-actions" }, h("button", { type: "button", class: "g-btn g-btn-primary", disabled: true }, this.t("unavailable"))));
    } else {
      const line = commerce.cart.findLine(product.id, variant?.id || "");
      const qty = h(
        "div",
        { class: "g-qty", role: "group", "aria-label": this.t("quantity") },
        h("button", { type: "button", "aria-label": this.t("decrease"), disabled: this.quantity <= 1, onClick: () => { this.quantity = Math.max(1, this.quantity - 1); this.render(); } }, icon("minus", 14)),
        h("input", {
          type: "number",
          min: "1",
          value: String(this.quantity),
          "aria-label": this.t("quantity"),
          onChange: ((event: Event) => {
            this.quantity = Math.max(1, Math.floor(Number((event.target as HTMLInputElement).value)) || 1);
            this.render();
          }) as EventListener,
        }),
        h("button", { type: "button", "aria-label": this.t("increase"), disabled: available !== null && this.quantity >= available, onClick: () => { this.quantity += 1; this.render(); } }, icon("plus", 14))
      );
      const disabled = this.busy || needsChoice || !inStock;
      const addLabel = this.message?.type === "success" ? this.t("added") : this.busy ? this.t("adding") : !inStock && !needsChoice ? this.t("soldOut") : this.t("addToCart");
      const actions = h(
        "div",
        { class: "g-buybox-actions" },
        qty,
        h(
          "button",
          { type: "button", class: `g-btn g-btn-primary${this.message?.type === "success" ? " g-added" : ""}`, disabled, "data-buybox-add": "", onClick: () => void this.add(false) },
          this.busy ? h("span", { class: "g-spinner" }) : this.message?.type === "success" ? icon("check", 16) : icon("cart", 16),
          addLabel
        ),
        this.getAttribute("buy-now") === "off"
          ? null
          : h("button", { type: "button", class: "g-btn g-btn-secondary", disabled, "data-buybox-buy": "", onClick: () => void this.add(true) }, this.t("buyNow"))
      );
      children.push(actions);
      if (line) children.push(h("div", { class: "g-stock" }, this.t("inCart", { count: line.quantity })));
    }

    if (this.message && this.message.type !== "success") {
      children.push(h("div", { class: `g-alert${this.message.type === "info" ? " g-alert-info" : ""}`, role: "alert" }, icon("alert", 16), h("span", null, this.message.text)));
    }
    replaceChildren(this, ...children);
  }

  async add(buyNow: boolean): Promise<void> {
    const commerce = this.commerceOrThrow();
    const product = this.product;
    if (!product || this.busy) return;
    const variant = this.selectedVariant();
    if (product.hasVariants && !variant) {
      this.message = { text: this.t("chooseOption", { option: product.options.map((o) => o.name.toLowerCase()).join(" / ") }), type: "error" };
      this.render();
      return;
    }
    this.busy = true;
    this.message = null;
    this.render();
    try {
      await commerce.cart.add({
        productId: product.id,
        variantId: variant?.id,
        quantity: this.quantity,
        title: variant ? `${product.title} — ${variant.title}` : product.title,
        unitAmount: variant ? variant.priceAmount : product.priceAmount,
        currency: variant ? variant.currency : product.currency,
        imageUrl: variant?.imageUrl || product.imageUrl,
        productUrl: product.productUrl || window.location.pathname,
        requiresShipping: variant ? variant.requiresShipping : product.requiresShipping,
        pricingType: product.pricingType,
      });
      dispatch(this, "grigora:added", { productId: product.id, variantId: variant?.id || "", quantity: this.quantity });
      this.busy = false;
      if (buyNow) {
        this.render();
        (this.ctx || requireContext()).openCheckout();
        return;
      }
      this.message = { text: this.t("added"), type: "success" };
      this.render();
      if (this.addedTimer) clearTimeout(this.addedTimer);
      this.addedTimer = setTimeout(() => {
        if (this.message?.type === "success") this.message = null;
        this.render();
      }, 1800);
      if ((this.ctx || requireContext()).options.autoOpenCartOnAdd) (this.ctx || requireContext()).openCart(this.querySelector<HTMLElement>("[data-buybox-add]"));
    } catch (error) {
      this.busy = false;
      this.message = { text: (error as Error).message || this.t("error"), type: "error" };
      this.render();
    }
  }

  private async payWhatYouWant(): Promise<void> {
    const commerce = this.commerceOrThrow();
    const product = this.product;
    if (!product || this.busy) return;
    if (product.priceAmount > 0 && this.pwywAmount < product.priceAmount) {
      this.message = { text: this.t("minimum", { amount: commerce.formatCurrency(product.priceAmount, product.currency) }), type: "error" };
      this.render();
      return;
    }
    const email = await this.askEmail();
    if (!email) return;
    this.busy = true;
    this.message = null;
    this.render();
    try {
      const session = await commerce.checkout.startSingle({ productId: product.id, amount: this.pwywAmount, customerEmail: email });
      if (session.checkoutUrl) {
        commerce.navigate(session.checkoutUrl);
        return;
      }
      this.message = { text: this.t("error"), type: "error" };
    } catch (error) {
      this.message = { text: (error as Error).message || this.t("error"), type: "error" };
    }
    this.busy = false;
    this.render();
  }

  private askEmail(): Promise<string> {
    return new Promise((resolve) => {
      const input = h("input", { class: "g-input", type: "email", autocomplete: "email", required: true, "aria-label": this.t("emailForReceipt") });
      const error = h("p", { class: "g-field-error", hidden: true });
      let settled = false;
      const form = h(
        "form",
        {
          class: "g-field",
          onSubmit: ((event: Event) => {
            event.preventDefault();
            if (!isValidEmail(input.value)) {
              error.textContent = this.t("invalidField", { field: this.t("fieldEmail").toLowerCase() });
              error.removeAttribute("hidden");
              return;
            }
            settled = true;
            dialog.close();
            resolve(input.value.trim());
          }) as EventListener,
        },
        h("h3", { style: "margin:0 0 8px" }, this.t("emailForReceipt")),
        input,
        error,
        h("button", { type: "submit", class: "g-btn g-btn-primary g-btn-block", style: "margin-top:8px" }, this.t("continue"))
      );
      const dialog = openDialog(form, {
        label: this.t("emailForReceipt"),
        size: "sm",
        onClose: () => {
          if (!settled) resolve("");
        },
      });
    });
  }
}

/** <g-price product="slug" [variant="id"] [compare]>: a formatted price, filled from the catalog. */
export class GPrice extends HTMLElement {
  commerce?: GrigoraCommerce;

  connectedCallback(): void {
    const commerce = this.commerce || getContext()?.commerce;
    if (!commerce) {
      whenContext(() => {
        if (this.isConnected) this.connectedCallback();
      });
      return;
    }
    this.setAttribute("data-g-ui", "");
    const key = (this.getAttribute("product") || "").trim();
    if (!key) return;
    void commerce.products
      .get(key)
      .then((product) => {
        const variant = product.variants.find((v) => v.id === (this.getAttribute("variant") || ""));
        const amount = this.hasAttribute("compare") ? (variant?.compareAtAmount ?? product.compareAtAmount) : variant?.priceAmount ?? product.priceAmount;
        this.textContent = amount > 0 || !this.hasAttribute("compare") ? commerce.formatCurrency(amount, variant?.currency || product.currency) : "";
      })
      .catch(() => {
        this.textContent = "";
      });
  }
}

/** <g-add-to-cart product="slug" [variant] [quantity] [label]>: a single button. */
export class GAddToCart extends HTMLElement {
  commerce?: GrigoraCommerce;

  connectedCallback(): void {
    const ctx = getContext();
    const commerce = this.commerce || ctx?.commerce;
    if (!commerce || !ctx) {
      whenContext(() => {
        if (this.isConnected) this.connectedCallback();
      });
      return;
    }
    this.setAttribute("data-g-ui", "");
    const label = this.getAttribute("label") || this.textContent?.trim() || ctx.t("addToCart");
    const button = h("button", { type: "button", class: "g-btn g-btn-primary", "data-grigora-add": "", "data-product-slug": this.getAttribute("product") || "" }, icon("cart", 16), label);
    if (this.getAttribute("variant")) button.setAttribute("data-variant-id", this.getAttribute("variant") || "");
    if (this.getAttribute("quantity")) button.setAttribute("data-quantity", this.getAttribute("quantity") || "1");
    replaceChildren(this, button);
  }
}
