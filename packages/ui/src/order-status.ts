import { orderReference, type GrigoraCommerce, type Order } from "@grigora/commerce-core";
import { getContext, requireContext, type UIContext } from "./context";
import { h, icon, replaceChildren, safeHref } from "./dom";
import { getReturn } from "./return";

type State = "checking" | "paid" | "pending" | "failed" | "error" | "missing";

const POLL_MS = 4000;
const MAX_POLLS = 8;

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

  connectedCallback(): void {
    this.ctx = getContext();
    if (!this.ctx && !this.commerce) return;
    this.setAttribute("data-g-ui", "");
    this.classList.add("g-order");
    this.setAttribute("aria-live", "polite");
    void this.start();
  }

  disconnectedCallback(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private commerceOrThrow(): GrigoraCommerce {
    return this.commerce || requireContext().commerce;
  }

  private t(key: Parameters<UIContext["t"]>[0], vars?: Record<string, string | number>): string {
    return (this.ctx || requireContext()).t(key, vars);
  }

  private async start(): Promise<void> {
    const commerce = this.commerceOrThrow();
    this.orderId = (this.getAttribute("order-id") || "").trim();
    this.lookupToken = (this.getAttribute("lookup-token") || "").trim();
    if (!this.orderId || !this.lookupToken) {
      const returned = await getReturn(commerce);
      if (returned) {
        this.orderId = returned.orderId;
        this.lookupToken = returned.lookupToken;
      }
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
    this.state = "checking";
    this.render();
    const commerce = this.commerceOrThrow();
    try {
      const order = await commerce.orders.lookup({ orderId: this.orderId, lookupToken: this.lookupToken });
      if (order.orderId !== this.orderId) throw new Error(this.t("orderErrorDetail"));
      this.order = order;
      if (order.paymentState === "paid") {
        this.state = "paid";
        commerce.cart.clear();
        commerce.emit("order:paid", order);
      } else if (order.paymentState === "pending" || order.paymentState === "unknown") {
        this.state = "pending";
        if (this.polls < MAX_POLLS && this.getAttribute("poll") !== "off") {
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
  }

  render(): void {
    const commerce = this.commerceOrThrow();
    const ctx = this.ctx || requireContext();
    this.setAttribute("data-state", this.state);
    const titles: Record<State, [string, string, string]> = {
      checking: [this.t("checkingOrder"), this.t("checkingOrderDetail"), "shield"],
      paid: [this.order && this.order.totalAmount === 0 ? this.t("freeOrderConfirmed") : this.t("orderConfirmed"), this.t("orderConfirmedDetail"), "check"],
      pending: [this.t("orderPending"), this.t("orderPendingDetail"), "package"],
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
    const actions: Node[] = [];
    if (this.state === "pending" || this.state === "error") {
      actions.push(h("button", { type: "button", class: "g-btn g-btn-primary", disabled: this.inFlight, onClick: () => void this.verify() }, this.t("checkAgain")));
    }
    if (this.order?.invoiceUrl && this.state === "paid") {
      actions.push(h("a", { class: "g-btn g-btn-secondary", href: safeHref(this.order.invoiceUrl), target: "_blank", rel: "noopener" }, icon("external", 14), this.t("viewInvoice")));
    }
    actions.push(h("a", { class: `g-btn ${this.state === "paid" ? "g-btn-primary" : "g-btn-secondary"}`, href: safeHref(this.getAttribute("continue-url") || ctx.options.continueShoppingUrl) }, this.t("continueShopping")));
    children.push(h("div", { class: "g-order-actions" }, ...actions));
    replaceChildren(this, ...children);
  }
}
