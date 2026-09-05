import type { ApiClient } from "./client";
import { normalizeCurrency } from "./currency";
import { GrigoraError } from "./errors";
import type {
  AvailabilityAPI,
  AvailabilityItem,
  AvailabilityResult,
  DiscountResult,
  DiscountValidateInput,
  DiscountsAPI,
  Order,
  OrderLookupInput,
  OrderPaymentState,
  OrdersAPI,
} from "./types";
import { clean, toInt } from "./util";

type Raw = Record<string, unknown>;

const PAID_STATUSES = new Set(["paid", "fulfilled", "succeeded", "captured"]);
const PENDING_STATUSES = new Set(["pending", "processing", "authorized", "requires_action"]);
const BLOCKED_STATUSES = new Set([
  "payment_review",
  "inventory_exception",
  "on_hold",
  "cancelled",
  "canceled",
  "refunded",
  "expired",
  "failed",
  "voided",
  "disputed",
  "chargeback",
]);

/** The same reading of order/payment status the platform's thank-you page applies. */
export function orderPaymentState(status: unknown, paymentStatus: unknown): OrderPaymentState {
  const s = clean(status, 40).toLowerCase();
  const p = clean(paymentStatus, 40).toLowerCase();
  if (BLOCKED_STATUSES.has(s) || BLOCKED_STATUSES.has(p)) return "failed";
  if (PAID_STATUSES.has(s) || PAID_STATUSES.has(p)) return "paid";
  if (PENDING_STATUSES.has(s) || PENDING_STATUSES.has(p)) return "pending";
  return "unknown";
}

function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function mapOrder(raw: Raw): Order {
  const lineItems = Array.isArray(raw.line_items) ? (raw.line_items as Raw[]) : [];
  const fulfillments = Array.isArray(raw.fulfillments) ? (raw.fulfillments as Raw[]) : [];
  return {
    orderId: clean(raw.order_id ?? raw.id, 80),
    status: clean(raw.status, 40) || "pending",
    paymentStatus: clean(raw.payment_status, 40) || "pending",
    fulfillmentStatus: clean(raw.fulfillment_status, 40) || "unfulfilled",
    currency: normalizeCurrency(raw.currency, "USD"),
    totalAmount: toInt(raw.total_amount ?? raw.amount, 0),
    lineItems: lineItems.map((item) => ({
      title: clean(item.title, 300),
      quantity: Math.max(1, toInt(item.quantity, 1)),
      unitAmount: toInt(item.unit_amount, 0),
    })),
    fulfillments: fulfillments.map((item) => ({
      status: clean(item.status, 40),
      trackingCompany: clean(item.tracking_company, 120),
      trackingNumber: clean(item.tracking_number, 120),
      shippedAt: nullableInt(item.shipped_at),
      deliveredAt: nullableInt(item.delivered_at),
    })),
    invoiceId: clean(raw.invoice_id, 80),
    invoiceNumber: clean(raw.invoice_number, 80),
    invoiceUrl: clean(raw.invoice_url ?? raw.hosted_invoice_url, 1000),
    invoicePdfUrl: clean(raw.invoice_pdf_url, 1000),
    invoiceIssuedAt: nullableInt(raw.invoice_issued_at),
    createdAt: nullableInt(raw.created_at),
    paymentState: orderPaymentState(raw.status, raw.payment_status),
  };
}

/** Short reference shown to the shopper; cut exactly like the merchant dashboard so support can match it. */
export function orderReference(orderId: string): string {
  return clean(orderId, 80).slice(-10).toUpperCase();
}

export class OrdersClient implements OrdersAPI {
  constructor(private readonly client: ApiClient, private readonly projectId: string) {}

  async lookup(input: OrderLookupInput): Promise<Order> {
    const orderId = clean(input.orderId, 80);
    if (!orderId) throw new GrigoraError("An order id is required.", { code: "validation_error" });
    const email = clean(input.email, 240);
    const lookupToken = clean(input.lookupToken, 200);
    if (!email && !lookupToken) {
      throw new GrigoraError("Order lookup needs the buyer's email or the lookup token from checkout.", { code: "unauthorized" });
    }
    const output = await this.client.post<Raw>(
      "/orders/lookup",
      { project_id: this.projectId, order_id: orderId, email: email || undefined, lookup_token: lookupToken || undefined },
      { context: "order" }
    );
    const order = output.order && typeof output.order === "object" ? mapOrder(output.order as Raw) : null;
    if (!order || !order.orderId) throw new GrigoraError("Order not found.", { code: "not_found", httpStatus: 404 });
    return order;
  }

  async downloadUrl(input: { orderId: string; token: string }): Promise<string> {
    const output = await this.client.get<Raw>("/delivery/download", {
      context: "order",
      retry: false,
      query: { project_id: this.projectId, order_id: input.orderId, token: input.token, format: "json" },
    });
    const url = clean(output.download_url, 4000);
    if (!url) throw new GrigoraError("Download link unavailable.", { code: "unauthorized" });
    return url;
  }

  invoiceUrl(input: { invoiceId: string; token?: string; format?: "html" | "json" | "pdf" }): string {
    const suffix = input.format === "pdf" ? "/pdf" : "";
    return this.client.url(`/invoice/${encodeURIComponent(this.projectId)}/${encodeURIComponent(input.invoiceId)}${suffix}`, {
      token: input.token,
      format: input.format === "json" ? "json" : undefined,
    });
  }
}

export class DiscountsClient implements DiscountsAPI {
  constructor(private readonly client: ApiClient, private readonly projectId: string) {}

  async validate(input: DiscountValidateInput): Promise<DiscountResult> {
    const output = await this.client.get<Raw>("/discounts/validate", {
      context: "discount",
      query: {
        project_id: this.projectId,
        code: clean(input.code, 60),
        product_id: input.productId,
        slug: input.slug,
      },
    });
    return {
      ok: output.ok === true,
      code: clean(output.code, 60),
      type: clean(output.type, 40),
      value: clean(output.value, 40),
      discountAmount: toInt(output.discount_amount, 0),
      currency: clean(output.currency, 3).toUpperCase(),
      originalAmount: toInt(output.original_amount, 0),
      finalAmount: toInt(output.final_amount, 0),
      reason: clean(output.reason, 80),
      message: clean(output.message, 400),
    };
  }
}

export class AvailabilityClient implements AvailabilityAPI {
  constructor(private readonly client: ApiClient, private readonly projectId: string) {}

  async check(items: AvailabilityItem[]): Promise<AvailabilityResult[]> {
    const output = await this.client.post<Raw>(
      "/storefront/availability",
      {
        project_id: this.projectId,
        items: items.map((item) => ({ product_id: clean(item.productId, 80), variant_id: clean(item.variantId, 80) })),
      },
      { context: "product" }
    );
    const rows = Array.isArray(output.availability) ? (output.availability as Raw[]) : [];
    return rows.map((row) => ({
      productId: clean(row.product_id, 80),
      variantId: clean(row.variant_id, 80),
      available: nullableInt(row.available),
      inStock: row.in_stock !== false,
    }));
  }
}
