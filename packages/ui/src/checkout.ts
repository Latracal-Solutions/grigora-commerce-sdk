import {
  addressErrors,
  normalizeAddress,
  normalizePostalForCountry,
  providerLabel,
  readJson,
  writeJson,
  type Address,
  type AddressField,
  type Cart,
  type CheckoutMode,
  type CheckoutSession,
  type GrigoraCommerce,
  type PaymentAdapterContext,
  type PaymentProviderAdapter,
  type StoreSettings,
} from "@grigora/commerce-core";
import { getContext, requireContext, type UIContext } from "./context";
import { COUNTRIES } from "./countries";
import { debounce, h, icon, image, replaceChildren, setText, toggle } from "./dom";
import { GOrderStatus } from "./order-status";
import { getReturn, withOrderParams } from "./return";

type Scope = "billing" | "shipping";
type Phase = "loading" | "form" | "preparing" | "payment" | "submitting" | "redirecting" | "status";

interface FieldSpec {
  key: AddressField;
  label: "fieldName" | "fieldEmail" | "fieldPhone" | "fieldLine1" | "fieldLine2" | "fieldCity" | "fieldState" | "fieldPostalCode" | "fieldCountry";
  type: "text" | "email" | "tel" | "select";
  autocomplete: string;
  span?: boolean;
  optional?: boolean;
}

const CONTACT_FIELDS: FieldSpec[] = [
  { key: "email", label: "fieldEmail", type: "email", autocomplete: "email", span: true },
  { key: "name", label: "fieldName", type: "text", autocomplete: "name" },
  { key: "phone", label: "fieldPhone", type: "tel", autocomplete: "tel" },
];

const ADDRESS_FIELDS: FieldSpec[] = [
  { key: "country", label: "fieldCountry", type: "select", autocomplete: "country", span: true },
  { key: "line1", label: "fieldLine1", type: "text", autocomplete: "address-line1", span: true },
  { key: "line2", label: "fieldLine2", type: "text", autocomplete: "address-line2", span: true, optional: true },
  { key: "city", label: "fieldCity", type: "text", autocomplete: "address-level2" },
  { key: "state", label: "fieldState", type: "text", autocomplete: "address-level1", optional: true },
  { key: "postalCode", label: "fieldPostalCode", type: "text", autocomplete: "postal-code" },
];

interface SavedAddress {
  billing: Partial<Address>;
  shipping: Partial<Address>;
  sameAsBilling: boolean;
}

/**
 * <g-checkout>: the whole checkout. Contact and addresses, live totals from
 * the server, shipping rate choice, discount, then payment through the
 * store's gateway: an embedded form (Stripe Payment Element, Razorpay) or a
 * hosted redirect, whichever the store supports and the adapters allow.
 *
 * The form is built once and mutated in place, so typing is never interrupted
 * by a re-render; the summary, totals, rates and pay button are the parts that
 * redraw as the cart changes.
 */
export class GCheckout extends HTMLElement {
  commerce?: GrigoraCommerce;
  private ctx: UIContext | null = null;
  private phase: Phase = "loading";
  private cart!: Cart;
  private store: StoreSettings | null = null;
  private billing: Partial<Address> = {};
  private shipping: Partial<Address> = {};
  private sameAsBilling = true;
  private rateId = "";
  private touched = new Set<string>();
  private submitted = false;
  private session: CheckoutSession | null = null;
  private adapter: PaymentProviderAdapter | null = null;
  private adapterContext: PaymentAdapterContext | null = null;
  private resolvedMode: CheckoutMode | null = null;
  private message: { text: string; type: "error" | "info" | "success" } | null = null;
  private unsubscribe: (() => void) | null = null;
  private built = false;
  private els: Record<string, HTMLElement> = {};
  private inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private discountInput: HTMLInputElement | null = null;
  private discountBusy = false;
  private discountMessage: { text: string; type: "error" | "success" } | null = null;
  private providerAcknowledged = false;
  private readonly scheduleQuote = debounce(() => void this.quote(), 450);
  private onPageHide = () => {
    if (this.session && this.phase === "payment" && !this.providerAcknowledged) void this.commerceOrThrow().checkout.cancel(this.session);
  };

  connectedCallback(): void {
    this.ctx = getContext();
    if (!this.ctx && !this.commerce) return;
    this.setAttribute("data-g-ui", "");
    this.classList.add("g-checkout");
    const commerce = this.commerceOrThrow();
    this.cart = commerce.cart.get();
    this.unsubscribe = commerce.on("cart:changed", (cart) => this.onCartChanged(cart));
    window.addEventListener("pagehide", this.onPageHide);
    void this.boot();
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.scheduleQuote.cancel();
    window.removeEventListener("pagehide", this.onPageHide);
    this.adapter?.destroy();
  }

  private commerceOrThrow(): GrigoraCommerce {
    return this.commerce || requireContext().commerce;
  }

  private t(key: Parameters<UIContext["t"]>[0], vars?: Record<string, string | number>): string {
    return (this.ctx || requireContext()).t(key, vars);
  }

  private get options() {
    return (this.ctx || requireContext()).options;
  }

  /** True while a payment is being submitted; dialogs use it to refuse closing. */
  get busy(): boolean {
    return this.phase === "preparing" || this.phase === "submitting" || this.phase === "redirecting";
  }

  // ------------------------------------------------------------------ boot

  private async boot(): Promise<void> {
    const commerce = this.commerceOrThrow();
    this.renderLoading();
    const returned = await getReturn(commerce);
    if (returned) {
      this.phase = "status";
      const status = document.createElement("g-order-status") as GOrderStatus;
      status.setAttribute("order-id", returned.orderId);
      status.setAttribute("lookup-token", returned.lookupToken);
      if (this.commerce) status.commerce = this.commerce;
      replaceChildren(this, status);
      return;
    }
    this.restoreAddress();
    try {
      this.store = await commerce.store.get();
    } catch {
      this.store = null;
    }
    this.phase = "form";
    this.build();
    void this.quote();
  }

  private storageKey(): string {
    return `grigora-commerce-address-${this.commerceOrThrow().projectId}`;
  }

  private restoreAddress(): void {
    const saved = readJson<SavedAddress | null>(this.commerceOrThrow().config.storage, this.storageKey(), null);
    if (!saved) return;
    this.billing = saved.billing || {};
    this.shipping = saved.shipping || {};
    this.sameAsBilling = saved.sameAsBilling !== false;
  }

  private saveAddress(): void {
    writeJson(this.commerceOrThrow().config.storage, this.storageKey(), { billing: this.billing, shipping: this.shipping, sameAsBilling: this.sameAsBilling } satisfies SavedAddress);
  }

  // ----------------------------------------------------------------- build

  private renderLoading(): void {
    replaceChildren(this, h("div", { class: "g-checkout-layout" }, h("div", { class: "g-section" }, h("span", { class: "g-skeleton", style: "width:40%;height:20px" }), h("span", { class: "g-skeleton", style: "width:100%;height:46px" }), h("span", { class: "g-skeleton", style: "width:100%;height:46px" })), h("div", { class: "g-checkout-summary" }, h("span", { class: "g-skeleton", style: "width:60%" }))));
  }

  private build(): void {
    this.built = true;
    const commerce = this.commerceOrThrow();
    const storeName = this.store?.storeName || "";
    const e = this.els;

    e.stepDetails = h("span", { class: "g-step", "data-active": "" }, h("i", null, "1"), this.t("contact"));
    e.stepPayment = h("span", { class: "g-step" }, h("i", null, "2"), this.t("payment"));

    e.shippingBlock = h("div", { class: "g-section" }, h("h3", null, icon("truck", 16), this.t("shippingAddress")));
    e.sameCheck = h("input", {
      type: "checkbox",
      checked: this.sameAsBilling,
      onChange: ((event: Event) => {
        this.sameAsBilling = (event.target as HTMLInputElement).checked;
        this.invalidateSession();
        this.saveAddress();
        this.syncShippingFields();
        void this.quote();
      }) as EventListener,
    }) as HTMLInputElement;
    e.shippingBlock.appendChild(h("label", { class: "g-check" }, e.sameCheck, this.t("sameAsBilling")));
    e.shippingFields = h("div", { class: "g-grid" }, ...ADDRESS_FIELDS.map((spec) => this.buildField("shipping", spec)));
    e.shippingBlock.appendChild(e.shippingFields);

    e.ratesBlock = h("div", { class: "g-section" }, h("h3", null, icon("package", 16), this.t("shippingMethod")));
    e.rates = h("div", { class: "g-radio-list" });
    e.ratesBlock.appendChild(e.rates);

    e.paymentMount = h("div", { class: "g-payment-mount", "data-payment-mount": "" });
    e.paymentNote = h("p", { class: "g-note" });
    e.paymentBlock = h("div", { class: "g-section", hidden: true }, h("h3", null, icon("card", 16), this.t("payment")), e.paymentMount, e.paymentNote);

    e.message = h("div", { class: "g-alert", role: "alert", hidden: true });
    e.payLabel = h("span", null, this.t("continueToPayment"));
    e.payButton = h("button", { type: "submit", class: "g-btn g-btn-primary g-btn-block", "data-pay": "" }, icon("lock", 16), e.payLabel);
    e.testMode = h("span", { class: "g-testmode", hidden: true }, this.t("testMode"));

    const form = h(
      "form",
      {
        novalidate: true,
        onSubmit: ((event: Event) => {
          event.preventDefault();
          void this.pay();
        }) as EventListener,
      },
      h("div", { class: "g-section" }, h("h3", null, icon("user", 16), this.t("contact")), h("div", { class: "g-grid" }, ...CONTACT_FIELDS.map((spec) => this.buildField("billing", spec)))),
      h("div", { class: "g-section" }, h("h3", null, icon("package", 16), this.t("billingAddress")), h("div", { class: "g-grid" }, ...ADDRESS_FIELDS.map((spec) => this.buildField("billing", spec)))),
      e.shippingBlock,
      e.ratesBlock,
      e.paymentBlock,
      e.message,
      e.payButton,
      h("div", { class: "g-secure" }, icon("lock", 14), h("span", null, this.t("secureCheckout")), e.testMode)
    );
    e.form = form;

    e.summaryLines = h("div", { class: "g-summary-lines" });
    e.summaryRows = h("div", { class: "g-rows" });
    e.discount = h("div", null);
    e.summary = h(
      "aside",
      { class: "g-checkout-summary", "aria-label": this.t("orderSummary") },
      h("h3", { style: "margin:0;font-size:15px" }, this.t("orderSummary")),
      e.summaryLines,
      e.discount,
      e.summaryRows
    );

    replaceChildren(
      this,
      h(
        "div",
        { class: "g-checkout-head" },
        h("div", null, h("h2", null, this.t("checkout")), storeName ? h("div", { class: "g-checkout-store" }, storeName) : null),
        h("div", { class: "g-steps" }, e.stepDetails, e.stepPayment)
      ),
      h("div", { class: "g-checkout-layout" }, h("div", null, form), e.summary)
    );
    this.syncShippingFields();
    this.renderSummary(this.cart);
    this.renderRates(this.cart);
    this.renderPayButton();
    this.applyStoreState();
    void commerce.store.get().then(() => this.applyStoreState()).catch(() => {});
  }

  private buildField(scope: Scope, spec: FieldSpec): HTMLElement {
    const id = `g-${scope}-${spec.key}`;
    const value = String((scope === "billing" ? this.billing : this.shipping)[spec.key] || "");
    let control: HTMLInputElement | HTMLSelectElement;
    if (spec.type === "select") {
      control = h("select", { class: "g-select", id, name: `${scope}.${spec.key}`, autocomplete: spec.autocomplete, required: !spec.optional }) as HTMLSelectElement;
      this.fillCountries(control as HTMLSelectElement, value);
    } else {
      control = h("input", { class: "g-input", id, type: spec.type, name: `${scope}.${spec.key}`, autocomplete: spec.autocomplete, value, required: !spec.optional, inputmode: spec.key === "postalCode" ? "text" : spec.type === "tel" ? "tel" : null }) as HTMLInputElement;
    }
    control.addEventListener("input", () => this.onFieldChange(scope, spec.key, control, false));
    control.addEventListener("change", () => this.onFieldChange(scope, spec.key, control, true));
    control.addEventListener("blur", () => {
      this.touched.add(`${scope}.${spec.key}`);
      this.markField(scope, spec.key);
    });
    this.inputs.set(`${scope}.${spec.key}`, control);
    const error = h("span", { class: "g-field-error", id: `${id}-error`, hidden: true });
    control.setAttribute("aria-describedby", `${id}-error`);
    return h("div", { class: `g-field${spec.span ? " g-span" : ""}` }, h("label", { for: id }, this.t(spec.label)), control, error);
  }

  private fillCountries(select: HTMLSelectElement, value: string): void {
    const allowed = this.cart.requiresShipping && this.store?.shipping.allowedCountries.length ? new Set(this.store.shipping.allowedCountries) : null;
    const current = select.value || value;
    replaceChildren(select, h("option", { value: "" }, this.t("fieldCountry")), ...COUNTRIES.filter(([code]) => !allowed || allowed.has(code)).map(([code, name]) => h("option", { value: code, selected: code === current }, name)));
    if (current && !select.value) select.value = "";
  }

  private onFieldChange(scope: Scope, key: AddressField, control: HTMLInputElement | HTMLSelectElement, committed: boolean): void {
    const target = scope === "billing" ? this.billing : this.shipping;
    let value = control.value;
    if (key === "postalCode") {
      value = normalizePostalForCountry(value, target.country || "");
      if (control.value !== value) control.value = value;
    }
    target[key] = value;
    this.invalidateSession();
    this.saveAddress();
    if (this.touched.has(`${scope}.${key}`) || this.submitted) this.markField(scope, key);
    if (key === "country" || committed) {
      if (key === "country") this.rateId = "";
      void this.quote();
    } else if (key === "postalCode" || key === "state") {
      this.scheduleQuote();
    }
  }

  private effectiveShipping(): Partial<Address> {
    return this.sameAsBilling ? this.billing : this.shipping;
  }

  private syncShippingFields(): void {
    const e = this.els;
    toggle(e.shippingBlock, this.cart.requiresShipping);
    toggle(e.shippingFields, !this.sameAsBilling);
    toggle(e.ratesBlock, this.cart.requiresShipping);
    for (const scope of ["billing", "shipping"] as Scope[]) {
      const select = this.inputs.get(`${scope}.country`) as HTMLSelectElement | undefined;
      if (select) this.fillCountries(select, String((scope === "billing" ? this.billing : this.shipping).country || ""));
    }
  }

  private markField(scope: Scope, key: AddressField): void {
    const control = this.inputs.get(`${scope}.${key}`);
    if (!control) return;
    const address = scope === "billing" ? this.billing : this.shipping;
    const errors = addressErrors(address, { requirePhone: true });
    const invalid = errors.includes(key);
    control.setAttribute("aria-invalid", invalid ? "true" : "false");
    const error = control.parentElement?.querySelector<HTMLElement>(".g-field-error");
    if (error) {
      const spec = [...CONTACT_FIELDS, ...ADDRESS_FIELDS].find((candidate) => candidate.key === key);
      setText(error, invalid ? this.t("invalidField", { field: spec ? this.t(spec.label).toLowerCase() : key }) : "");
      toggle(error, invalid);
    }
  }

  private markAll(): AddressField[] {
    this.submitted = true;
    const scopes: Scope[] = this.cart.requiresShipping && !this.sameAsBilling ? ["billing", "shipping"] : ["billing"];
    let first: { scope: Scope; key: AddressField } | null = null;
    for (const scope of scopes) {
      const errors = addressErrors(scope === "billing" ? this.billing : this.shipping);
      for (const spec of [...CONTACT_FIELDS, ...ADDRESS_FIELDS]) {
        this.markField(scope, spec.key);
        if (!first && errors.includes(spec.key)) first = { scope, key: spec.key };
      }
    }
    if (first) {
      this.inputs.get(`${first.scope}.${first.key}`)?.focus();
      const isContact = CONTACT_FIELDS.some((spec) => spec.key === first?.key);
      const scopeLabel = first.scope === "shipping" ? this.t("shippingAddress") : isContact ? this.t("contact") : this.t("billingAddress");
      const spec = [...CONTACT_FIELDS, ...ADDRESS_FIELDS].find((candidate) => candidate.key === first?.key);
      this.setMessage(`${scopeLabel}: ${this.t("invalidField", { field: spec ? this.t(spec.label).toLowerCase() : first.key })}`, "error");
      return [first.key];
    }
    return [];
  }

  // ----------------------------------------------------------------- state

  private onCartChanged(cart: Cart): void {
    const requiresShippingChanged = cart.requiresShipping !== this.cart.requiresShipping;
    this.cart = cart;
    if (!this.built || this.phase === "status") return;
    if (requiresShippingChanged) this.syncShippingFields();
    this.renderSummary(cart);
    this.renderRates(cart);
    this.renderPayButton();
  }

  private applyStoreState(): void {
    const store = this.commerceOrThrow().store.current();
    if (store) this.store = store;
    toggle(this.els.testMode, Boolean(this.store?.checkout.testMode));
    this.renderPayButton();
  }

  private setMessage(text: string, type: "error" | "info" | "success"): void {
    this.message = text ? { text, type } : null;
    const el = this.els.message;
    if (!el) return;
    el.className = `g-alert${type === "info" ? " g-alert-info" : type === "success" ? " g-alert-success" : ""}`;
    replaceChildren(el, icon(type === "error" ? "alert" : type === "success" ? "check" : "shield", 16), h("span", null, text));
    toggle(el, Boolean(text));
  }

  private async quote(): Promise<void> {
    if (this.phase === "status" || this.busy) return;
    const commerce = this.commerceOrThrow();
    const billing = this.billing.country ? this.billing : null;
    const shipping = this.effectiveShipping().country ? this.effectiveShipping() : null;
    await commerce.checkout.quote({ billingAddress: billing || undefined, shippingAddress: shipping, sameAsBilling: false, shippingRateId: this.rateId || undefined }).catch(() => {});
  }

  /** Any edit after a payment session exists makes that session stale. */
  private invalidateSession(): void {
    if (!this.session) return;
    const commerce = this.commerceOrThrow();
    const session = this.session;
    this.session = null;
    this.adapter?.destroy();
    this.adapter = null;
    this.adapterContext = null;
    this.providerAcknowledged = false;
    void commerce.checkout.cancel(session);
    this.phase = "form";
    this.els.stepDetails.setAttribute("data-active", "");
    this.els.stepPayment.removeAttribute("data-active");
    toggle(this.els.paymentBlock, false);
    replaceChildren(this.els.paymentMount);
    this.setMessage(this.t("changedRecheck"), "info");
    this.renderPayButton();
  }

  // ---------------------------------------------------------------- render

  private renderSummary(cart: Cart): void {
    const commerce = this.commerceOrThrow();
    const money = (amount: number) => commerce.formatCurrency(amount, cart.currency);
    replaceChildren(
      this.els.summaryLines,
      ...cart.lines.map((line) => {
        const img = image(line.imageUrl, line.title);
        return h(
          "div",
          { class: "g-summary-line" },
          h("div", { class: "g-cart-thumb" }, img || icon("package", 20), h("span", { class: "g-summary-qty", "aria-label": `${this.t("quantity")} ${line.quantity}` }, String(line.quantity))),
          h("div", null, h("div", { class: "g-summary-title" }, line.title || "Item"), !line.inStock ? h("span", { class: "g-badge g-badge-danger" }, this.t("outOfStock")) : null),
          h("strong", null, money(line.totalAmount))
        );
      })
    );
    this.renderDiscount(cart);
    const rows: Node[] = [h("div", { class: "g-row" }, h("span", null, `${this.t("subtotal")} · ${cart.itemCount === 1 ? this.t("itemCount") : this.t("itemsCount", { count: cart.itemCount })}`), h("strong", null, money(cart.subtotalAmount)))];
    if (cart.discountAmount > 0) rows.push(h("div", { class: "g-row" }, h("span", null, `${this.t("discount")} (${cart.discountCode})`), h("strong", null, `−${money(cart.discountAmount)}`)));
    if (cart.requiresShipping) {
      const quote = cart.shippingQuote;
      const label = quote && quote.eligible && quote.required ? (quote.freeShipping ? this.t("free") : money(cart.shippingAmount)) : this.t("enterAddressForRates");
      rows.push(h("div", { class: "g-row" }, h("span", null, this.t("shipping")), h("strong", null, label)));
    }
    if (cart.taxAmount > 0 || cart.taxMode === "stripe_tax") {
      rows.push(h("div", { class: "g-row" }, h("span", null, `${this.t("tax")}${cart.totalIsEstimate ? ` (${this.t("estimated").toLowerCase()})` : ""}`), h("strong", null, cart.taxMode === "stripe_tax" && cart.taxAmount === 0 ? this.t("calculatedAtCheckout") : money(cart.taxAmount))));
    }
    rows.push(h("div", { class: "g-row g-row-total" }, h("span", null, cart.totalIsEstimate && cart.validated ? `${this.t("total")} (${this.t("estimated").toLowerCase()})` : this.t("total")), h("span", null, money(cart.validated ? cart.totalAmount : cart.subtotalAmount))));
    replaceChildren(this.els.summaryRows, ...rows);
  }

  private renderDiscount(cart: Cart): void {
    const commerce = this.commerceOrThrow();
    if (cart.discountCode && cart.validated) {
      replaceChildren(
        this.els.discount,
        h(
          "div",
          { class: "g-discount-applied" },
          h("span", null, icon("tag", 14), " ", h("code", null, cart.discountCode)),
          h("button", { type: "button", class: "g-link-btn", disabled: this.busy, onClick: () => { this.invalidateSession(); void commerce.cart.setDiscount(null).catch(() => {}); } }, this.t("remove"))
        )
      );
      return;
    }
    const input = h("input", {
      class: "g-input",
      type: "text",
      autocomplete: "off",
      autocapitalize: "characters",
      placeholder: this.t("discountPlaceholder"),
      "aria-label": this.t("discountPlaceholder"),
      value: this.discountInput?.value || "",
      onKeydown: ((event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.applyDiscount();
        }
      }) as EventListener,
    }) as HTMLInputElement;
    this.discountInput = input;
    replaceChildren(
      this.els.discount,
      h("div", { class: "g-discount" }, input, h("button", { type: "button", class: "g-btn g-btn-secondary", disabled: this.discountBusy || this.busy, onClick: () => void this.applyDiscount() }, this.t("apply"))),
      this.discountMessage ? h("p", { class: `g-note${this.discountMessage.type === "error" ? " g-field-error" : " g-added"}`, role: "status" }, this.discountMessage.text) : null
    );
  }

  private async applyDiscount(): Promise<void> {
    const code = (this.discountInput?.value || "").trim();
    if (!code || this.discountBusy || this.busy) return;
    this.invalidateSession();
    this.discountBusy = true;
    this.discountMessage = null;
    this.renderDiscount(this.cart);
    try {
      await this.commerceOrThrow().cart.setDiscount(code);
      if (this.discountInput) this.discountInput.value = "";
      this.discountMessage = null;
    } catch (error) {
      this.discountMessage = { text: (error as Error).message || this.t("error"), type: "error" };
    } finally {
      this.discountBusy = false;
      this.renderDiscount(this.cart);
    }
  }

  private renderRates(cart: Cart): void {
    const commerce = this.commerceOrThrow();
    const quote = cart.shippingQuote;
    const list = this.els.rates;
    if (!cart.requiresShipping) {
      replaceChildren(list);
      return;
    }
    if (!quote || !quote.required || (!quote.eligible && !quote.availableRates.length)) {
      replaceChildren(list, h("p", { class: "g-note" }, quote && !quote.eligible && quote.country ? quote.message : this.t("enterAddressForRates")));
      return;
    }
    const selected = quote.rateId || this.rateId;
    replaceChildren(
      list,
      ...quote.availableRates.map((rate) =>
        h(
          "label",
          { class: "g-radio" },
          h("input", {
            type: "radio",
            name: "g-shipping-rate",
            value: rate.rateId,
            checked: rate.rateId === selected,
            disabled: this.busy,
            onChange: () => {
              this.rateId = rate.rateId;
              this.invalidateSession();
              void this.quote();
            },
          }),
          h("div", { class: "g-radio-main" }, h("div", null, rate.rateName), rate.zoneName ? h("div", { class: "g-radio-sub" }, rate.zoneName) : null),
          h("strong", null, rate.amount === 0 || (quote.freeShipping && rate.rateId === selected) ? this.t("free") : commerce.formatCurrency(rate.amount, rate.currency || cart.currency))
        )
      ),
      !quote.eligible && quote.message ? h("p", { class: "g-field-error" }, quote.message) : null
    );
  }

  private modeForStore(): CheckoutMode {
    const commerce = this.commerceOrThrow();
    if (!this.store) return "unavailable";
    let mode = commerce.checkout.resolveMode(this.store);
    if (mode === "embedded") {
      const adapter = commerce.providers.get(this.store.checkout.provider);
      if (!adapter || !adapter.supportsEmbedded) mode = this.store.checkout.hostedSupported ? "hosted" : "unavailable";
    }
    return mode;
  }

  private renderPayButton(): void {
    const commerce = this.commerceOrThrow();
    const button = this.els.payButton as HTMLButtonElement;
    const label = this.els.payLabel;
    if (!button) return;
    const cart = this.cart;
    const free = cart.validated && cart.totalAmount === 0;
    const mode = this.modeForStore();
    this.resolvedMode = mode;
    let text = this.t("continueToPayment");
    let disabled = false;
    if (this.phase === "preparing") text = this.t("preparing");
    else if (this.phase === "submitting") text = this.t("processing");
    else if (this.phase === "redirecting") text = this.t("redirecting", { provider: providerLabel(this.session?.provider || this.store?.checkout.provider || "stripe") });
    else if (this.phase === "payment" && this.session) {
      text = this.adapter?.submitLabel && this.adapterContext ? this.adapter.submitLabel(this.adapterContext) : this.t("pay", { amount: commerce.formatCurrency(this.session.amount, this.session.currency) });
    } else if (free) text = this.t("completeOrder");
    else if (mode === "hosted") text = this.t("continueTo", { provider: providerLabel(this.store?.checkout.provider || "stripe") });
    else if (mode === "unavailable" && this.store) {
      text = this.t("storeUnavailable");
      disabled = true;
    }
    if (!cart.lines.length || !cart.allInStock || cart.validating && !cart.validated) disabled = true;
    if (this.busy) disabled = true;
    replaceChildren(label, text);
    replaceChildren(button, this.busy ? h("span", { class: "g-spinner" }) : icon("lock", 16), label);
    button.disabled = disabled;
    const note = this.els.paymentNote;
    if (mode === "hosted" && this.phase !== "payment") setText(note, this.t("hostedNote", { provider: providerLabel(this.store?.checkout.provider || "stripe") }));
    else if (this.phase === "payment" && this.session) setText(note, this.t("securedBy", { provider: providerLabel(this.session.provider) }));
    else setText(note, "");
  }

  // ------------------------------------------------------------------- pay

  async pay(): Promise<void> {
    if (this.busy) return;
    const commerce = this.commerceOrThrow();
    if (this.phase === "payment" && this.session && this.adapter && this.adapterContext) {
      await this.submitPayment();
      return;
    }
    if (!this.cart.lines.length) return;
    this.setMessage("", "info");
    if (this.markAll().length) return;
    const quote = this.cart.shippingQuote;
    if (this.cart.requiresShipping && quote && !quote.eligible) {
      this.setMessage(quote.message || this.t("enterAddressForRates"), "error");
      return;
    }
    const mode = this.modeForStore();
    if (mode === "unavailable" && !(this.cart.validated && this.cart.totalAmount === 0)) {
      this.setMessage(this.store?.checkout.message || this.t("storeUnavailable"), "error");
      return;
    }
    await this.startSession(mode === "unavailable" ? "hosted" : mode);
  }

  private async startSession(mode: "embedded" | "hosted"): Promise<void> {
    const commerce = this.commerceOrThrow();
    this.phase = "preparing";
    this.renderPayButton();
    this.setMessage(this.t("preparing"), "info");
    try {
      const session = await commerce.checkout.start(
        {
          billingAddress: this.billing,
          shippingAddress: this.effectiveShipping(),
          sameAsBilling: false,
          shippingRateId: this.rateId || this.cart.shippingQuote?.rateId || undefined,
        },
        { payment: mode }
      );
      this.session = session;
      if (session.mode === "free") {
        this.phase = "redirecting";
        this.renderPayButton();
        this.finish(session.orderId, session.lookupToken, session.checkoutUrl);
        return;
      }
      if (session.mode === "hosted") {
        this.phase = "redirecting";
        this.renderPayButton();
        this.setMessage(this.t("redirecting", { provider: providerLabel(session.provider) }), "info");
        const hosted = commerce.providers.get("hosted");
        if (!hosted) throw new Error(this.t("error"));
        await hosted.submit(this.makeAdapterContext(session));
        return;
      }
      await this.mountEmbedded(session);
    } catch (error) {
      this.session = null;
      this.phase = "form";
      this.setMessage((error as Error).message || this.t("error"), "error");
      this.renderPayButton();
    }
  }

  private async mountEmbedded(session: CheckoutSession): Promise<void> {
    const commerce = this.commerceOrThrow();
    const adapter = commerce.providers.get(session.provider);
    if (!adapter || !adapter.supportsEmbedded) {
      await this.fallbackToHosted(session);
      return;
    }
    const context = this.makeAdapterContext(session);
    try {
      if (adapter.loadScript) await adapter.loadScript();
      toggle(this.els.paymentBlock, true);
      await adapter.mount(context);
    } catch (error) {
      commerce.log("embedded adapter failed, falling back to hosted", error);
      adapter.destroy();
      await this.fallbackToHosted(session);
      return;
    }
    this.adapter = adapter;
    this.adapterContext = context;
    this.phase = "payment";
    this.els.stepDetails.removeAttribute("data-active");
    this.els.stepPayment.setAttribute("data-active", "");
    this.setMessage("", "info");
    this.renderPayButton();
    if (this.els.paymentMount.childElementCount === 0) {
      // Overlay providers (Razorpay) have nothing to mount; let the shopper pay right away.
      this.els.paymentMount.scrollIntoView?.({ block: "nearest" });
    }
    (this.els.payButton as HTMLButtonElement).focus();
  }

  private async fallbackToHosted(session: CheckoutSession): Promise<void> {
    const commerce = this.commerceOrThrow();
    await commerce.checkout.cancel(session);
    this.session = null;
    if (this.store?.checkout.hostedSupported) {
      await this.startSession("hosted");
      return;
    }
    this.phase = "form";
    this.setMessage(this.t("storeUnavailable"), "error");
    this.renderPayButton();
  }

  private makeAdapterContext(session: CheckoutSession): PaymentAdapterContext {
    const commerce = this.commerceOrThrow();
    const successUrl = commerce.checkout.defaultSuccessUrl();
    const accent = this.store?.appearance.accentColor || getComputedStyle(this).getPropertyValue("--g-accent").trim() || "#111827";
    return {
      commerce,
      session,
      container: this.els.paymentMount,
      billing: normalizeAddress(this.billing),
      shipping: this.cart.requiresShipping ? normalizeAddress(this.effectiveShipping()) : null,
      returnUrl: withOrderParams(successUrl, session.orderId, session.lookupToken),
      theme: { accent, font: getComputedStyle(this).fontFamily || "inherit" },
      onComplete: (payload) => void this.onProviderComplete(session, payload),
      onCancel: () => {
        if (this.phase === "submitting") {
          this.phase = "payment";
          this.setMessage(this.t("paymentCancelled"), "info");
          this.renderPayButton();
        }
      },
      onError: (error) => {
        if (this.providerAcknowledged) return;
        this.phase = "payment";
        this.setMessage(error.message || this.t("paymentFailed"), "error");
        this.renderPayButton();
      },
      onReady: () => this.renderPayButton(),
    };
  }

  private async submitPayment(): Promise<void> {
    if (!this.session || !this.adapter || !this.adapterContext) return;
    this.phase = "submitting";
    this.setMessage("", "info");
    this.renderPayButton();
    try {
      await this.adapter.submit(this.adapterContext);
    } catch (error) {
      if (this.providerAcknowledged) return;
      this.phase = "payment";
      this.setMessage((error as Error).message || this.t("paymentFailed"), "error");
      this.renderPayButton();
    }
  }

  private async onProviderComplete(session: CheckoutSession, payload: Record<string, unknown>): Promise<void> {
    const commerce = this.commerceOrThrow();
    this.providerAcknowledged = true;
    this.phase = "submitting";
    this.renderPayButton();
    try {
      await commerce.checkout.confirm({ provider: session.provider, orderId: session.orderId, payload });
    } catch (error) {
      // The provider took the payment; the webhook settles the order. The status page keeps checking.
      commerce.log("confirm failed after provider acknowledgement", error);
    }
    this.finish(session.orderId, session.lookupToken);
  }

  private finish(orderId: string, lookupToken: string, explicitUrl?: string): void {
    const commerce = this.commerceOrThrow();
    this.phase = "redirecting";
    this.renderPayButton();
    const target = explicitUrl && /^https?:/.test(explicitUrl) ? explicitUrl : withOrderParams(commerce.checkout.defaultSuccessUrl(), orderId, lookupToken);
    commerce.navigate(target);
  }
}
