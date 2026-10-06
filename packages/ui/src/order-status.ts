import { normalizeAddress, orderReference, providerLabel, type GrigoraCommerce, type Order, type PaymentAdapterContext, type PaymentProviderAdapter } from "@grigora/commerce-core";
import { resolveAccent } from "./accent";
import { getContext, requireContext, whenContext, type UIContext } from "./context";
import { h, icon, replaceChildren, safeHref } from "./dom";
import { getReturn } from "./return";

type State = "checking" | "paid" | "pending" | "payment" | "failed" | "error" | "missing";

const POLL_MS = 4000;
const MAX_POLLS = 8;
/** Paddle's paid webhook usually lands seconds after its checkout completes. */
const MAX_POLLS_AFTER_PAYMENT = 10;

/**
 * <g-order-status order-id lookup-token>: the thank-you view. Verifies the
 * order through the public lookup (never trusts the URL alone), keeps polling
 * while payment is pending, clears the cart only once the order is paid.
 */
export class GOrderStatus extends HTMLElement {
  commerce?: GrigoraCommerce;
  private ctx: UIContext | null = null;
  private state: State = "checking";
  private order: Order | null = null;
  private errorText = "";
  private orderId = "";
  private lookupToken = "";
  private polls = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private unwait: (() => void) | null = null;
  // Paying an unpaid order from this page (Paddle's `_ptxn` order page).
  private providerTransactionId = "";
  private autoPay = false;
  private paymentSubmitted = false;
  private payAdapter: PaymentProviderAdapter | null = null;
  private payMount: HTMLElement | null = null;

  connectedCallback(): void {
    this.ctx = getContext();
    if (!this.ctx && !this.commerce) {
      this.unwait = whenContext(() => {
        this.unwait = null;
        if (this.isConnected) this.connectedCallback();
      });
      return;
    }
    this.setAttribute("data-g-ui", "");
    this.classList.add("g-order");
    this.setAttribute("aria-live", "polite");
    void this.start();
  }

  disconnectedCallback(): void {
    this.unwait?.();
    this.unwait = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.closePayment();
  }

  private commerceOrThrow(): GrigoraCommerce {
    // The instance this element connected with; the global only as a last resort.
    return this.commerce || this.ctx?.commerce || requireContext().commerce;
  }

  private t(key: Parameters<UIContext["t"]>[0], vars?: Record<string, string | number>): string {
    return (this.ctx || requireContext()).t(key, vars);
  }

  private async start(): Promise<void> {
    const commerce = this.commerceOrThrow();
    this.orderId = (this.getAttribute("order-id") || "").trim();
    this.lookupToken = (this.getAttribute("lookup-token") || "").trim();
    const returned = await getReturn(commerce);
    if (returned && (!this.orderId || !this.lookupToken)) {
      this.orderId = returned.orderId;
      this.lookupToken = returned.lookupToken;
    }
    if (returned && returned.orderId === this.orderId && returned.providerTransactionId) {
      this.providerTransactionId = returned.providerTransactionId;
      // Sent here to pay (Paddle's `_ptxn`): open payment once. Back from a
      // hosted checkout: payment was submitted, so wait for the webhook.
      if (returned.recovered) this.paymentSubmitted = true;
      else this.autoPay = true;
    }
    if (!this.orderId || !this.lookupToken) {
      this.state = "missing";
      this.render();
      return;
    }
    await this.verify();
  }

  async verify(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.closePayment();
    this.state = "checking";
    this.render();
    const commerce = this.commerceOrThrow();
    try {
      const order = await commerce.orders.lookup({ orderId: this.orderId, lookupToken: this.lookupToken });
      if (order.orderId !== this.orderId) throw new Error(this.t("orderErrorDetail"));
      this.order = order;
      if (order.paymentState === "paid") {
        this.state = "paid";
        this.providerTransactionId = "";
        if (commerce.checkout.remembered(this.orderId)) commerce.checkout.forget();
        commerce.cart.clear();
        commerce.emit("order:paid", order);
      } else if ((order.paymentState === "pending" || order.paymentState === "unknown") && !this.paymentSubmitted && this.paymentAdapter()) {
        this.state = "payment";
      } else if (order.paymentState === "pending" || order.paymentState === "unknown") {
        this.state = "pending";
        const maxPolls = this.paymentSubmitted ? MAX_POLLS_AFTER_PAYMENT : MAX_POLLS;
        if (this.polls < maxPolls && this.getAttribute("poll") !== "off") {
          this.polls += 1;
          this.timer = setTimeout(() => void this.verify(), POLL_MS);
        }
      } else {
        this.state = "failed";
      }
    } catch (error) {
      this.state = "error";
      this.errorText = (error as Error).message || this.t("orderErrorDetail");
    } finally {
      this.inFlight = false;
      this.render();
    }
    if (this.state === "payment" && this.autoPay) {
      this.autoPay = false;
      void this.pay();
    }
  }

  /**
   * The adapter that can collect payment for this order here: only when the
   * URL named the provider transaction and this browser started the checkout
   * (its provider data is remembered; nothing else is trusted to open it).
   */
  private paymentAdapter(): PaymentProviderAdapter | null {
    if (!this.providerTransactionId) return null;
    const commerce = this.commerceOrThrow();
    const remembered = commerce.checkout.remembered(this.orderId);
    if (!remembered) return null;
    const adapter = commerce.providers.get(remembered.provider);
    return adapter && typeof adapter.resume === "function" ? adapter : null;
  }

  /** Open the provider's payment for this unpaid order (the "Pay with {provider}" button). */
  async pay(): Promise<void> {
    const commerce = this.commerceOrThrow();
    const adapter = this.paymentAdapter();
    const remembered = commerce.checkout.remembered(this.orderId);
    if (!adapter || !remembered || this.inFlight) return;
    this.closePayment();
    this.payMount = h("div", { class: "g-order-payment" });
    this.render();
    const context: PaymentAdapterContext = {
      commerce,
      session: {
        mode: "hosted",
        provider: remembered.provider,
        orderId: this.orderId,
        lookupToken: this.lookupToken,
        checkoutUrl: "",
        cancelUrl: "",
        reservationExpiresAt: 0,
        amount: this.order?.totalAmount || 0,
        currency: this.order?.currency || "",
        totals: null,
        order: this.order,
        clientData: remembered.clientData,
        raw: {},
      },
      container: this.payMount,
      billing: normalizeAddress({}),
      shipping: null,
      returnUrl: typeof window !== "undefined" ? window.location.href : "",
      theme: { accent: resolveAccent(this), font: getComputedStyle(this).fontFamily || "inherit" },
      onComplete: () => {
        this.paymentSubmitted = true;
        this.polls = 0;
        void this.verify();
      },
      onCancel: () => this.render(),
      onError: (error) => {
        this.closePayment();
        this.state = "error";
        this.errorText = error.message || this.t("paymentFailed");
        this.render();
      },
    };
    this.payAdapter = adapter;
    try {
      if (adapter.loadScript) await adapter.loadScript();
      await adapter.resume?.(context);
    } catch (error) {
      context.onError(error as Error);
    }
  }

  private closePayment(): void {
    this.payAdapter?.destroy();
    this.payAdapter = null;
    this.payMount = null;
  }

  render(): void {
    const commerce = this.commerceOrThrow();
    const ctx = this.ctx || requireContext();
    this.setAttribute("data-state", this.state);
    const invoiceByEmail = this.order?.invoiceDeliveryMethod === "email";
    const paidDetail = invoiceByEmail
      ? this.t(this.order?.invoiceEmailStatus === "sent" ? "invoiceEmailSent" : this.order?.invoiceEmailStatus === "failed" ? "invoiceEmailDelayed" : "invoiceEmailPending")
      : this.t("orderConfirmedDetail");
    const titles: Record<State, [string, string, string]> = {
      checking: [this.t("checkingOrder"), this.t("checkingOrderDetail"), "shield"],
      paid: [this.order && this.order.totalAmount === 0 ? this.t("freeOrderConfirmed") : this.t("orderConfirmed"), paidDetail, "check"],
      pending: [this.t("orderPending"), this.t("orderPendingDetail"), "package"],
      payment: [this.t("orderPaymentDue"), this.t("orderPaymentDueDetail"), "package"],
      failed: [this.t("orderFailed"), this.t("orderFailedDetail"), "alert"],
      error: [this.t("orderError"), this.errorText || this.t("orderErrorDetail"), "alert"],
      missing: [this.t("orderMissing"), this.t("orderMissingDetail"), "shield"],
    };
    const [title, detail, iconName] = titles[this.state];
    const children: Node[] = [
      h("div", { class: "g-order-icon" }, this.state === "checking" ? h("span", { class: "g-spinner" }) : icon(iconName, 30)),
      h("h2", null, title),
      h("p", null, detail),
    ];
    if (this.order && this.state !== "error") {
      children.push(h("span", { class: "g-order-ref" }, this.t("order", { ref: orderReference(this.order.orderId) })));
    }
    if (this.order && this.state === "paid" && this.order.lineItems.length) {
      const rows = this.order.lineItems.map((item) =>
        h("div", { class: "g-row" }, h("span", null, `${item.quantity} × ${item.title}`), h("strong", null, commerce.formatCurrency(item.unitAmount * item.quantity, this.order?.currency)))
      );
      rows.push(h("div", { class: "g-row g-row-total" }, h("span", null, this.t("total")), h("span", null, commerce.formatCurrency(this.order.totalAmount, this.order.currency))));
      children.push(h("div", { class: "g-order-lines g-rows" }, ...rows));
    }
    if (this.state === "payment" && this.payMount) children.push(this.payMount);
    const actions: Node[] = [];
    if (this.state === "payment") {
      actions.push(h("button", { type: "button", class: "g-btn g-btn-primary", onClick: () => void this.pay() }, icon("lock", 16), this.t("payWith", { provider: providerLabel(this.commerceOrThrow().checkout.remembered(this.orderId)?.provider || "") })));
      actions.push(h("button", { type: "button", class: "g-btn g-btn-secondary", disabled: this.inFlight, onClick: () => void this.verify() }, this.t("checkAgain")));
    }
    if (this.state === "pending" || this.state === "error") {
      actions.push(h("button", { type: "button", class: "g-btn g-btn-primary", disabled: this.inFlight, onClick: () => void this.verify() }, this.t("checkAgain")));
    }
    if (!invoiceByEmail && this.order?.invoiceUrl && this.state === "paid") {
      actions.push(h("a", { class: "g-btn g-btn-secondary", href: safeHref(this.order.invoiceUrl), target: "_blank", rel: "noopener" }, icon("external", 14), this.t("viewInvoice")));
    }
    actions.push(h("a", { class: `g-btn ${this.state === "paid" ? "g-btn-primary" : "g-btn-secondary"}`, href: safeHref(this.getAttribute("continue-url") || ctx.options.continueShoppingUrl) }, this.t("continueShopping")));
    children.push(h("div", { class: "g-order-actions" }, ...actions));
    replaceChildren(this, ...children);
  }
}
