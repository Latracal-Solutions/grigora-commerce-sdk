import { describe, expect, it, vi } from "vitest";
import { MemoryStorageAdapter } from "../storage";
import type { CheckoutSession } from "../types";
import { catalogLine, makeCommerce, serverLine, validateResponse, STORE, type FakeRequest } from "./helpers";

const BILLING = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "4155552671",
  line1: "1 Market St",
  city: "San Francisco",
  state: "CA",
  postalCode: "94105",
  country: "US",
};

function seeded(storage: MemoryStorageAdapter) {
  storage.set("grigora-cart-p1", JSON.stringify([{ product_id: "a", quantity: 2, price: 1000, currency: "USD" }]));
}

function checkoutOutput(checkout: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    checkout,
    order_id: checkout.order_id,
    requires_shipping: false,
    subtotal_amount: 2000,
    discount_code: "",
    discount_amount: 0,
    subtotal_after_discount_amount: 2000,
    shipping_amount: 0,
    shipping_quote: { required: false, eligible: true },
    tax_mode: "none",
    tax_amount: 0,
    tax_breakdown: [],
    prices_include_tax: false,
    tax_calculation_status: "none",
    total_is_estimate: false,
    total_amount: 2000,
    currency: "USD",
    ...extra,
  };
}

function api(overrides: Partial<Record<string, (req: FakeRequest) => { status?: number; body?: unknown }>> = {}) {
  return (req: FakeRequest) => {
    const custom = overrides[req.path];
    if (custom) return custom(req);
    if (req.path === "/storefront/p1/settings") return { body: { store: STORE } };
    if (req.path === "/cart/validate") return { body: validateResponse([serverLine("a", 1000, 2)]) };
    if (req.path === "/checkout/session") {
      return { body: checkoutOutput({ provider: "stripe", mode: "hosted", checkout_url: "https://checkout.stripe.com/s/1", checkout_id: "cs_1", order_id: "ord_1", lookup_token: "tok_".padEnd(24, "x"), cancel_url: "https://api.test/cancel", reservation_expires_at: 123 }) };
    }
    if (req.path === "/checkout/embedded") {
      return { body: checkoutOutput({ provider: "stripe", mode: "embedded", order_id: "ord_2", payment_intent_id: "pi_1", client_secret: "pi_1_secret", publishable_key: "pk_test_1", amount: 2000, currency: "USD", lookup_token: "tok_".padEnd(24, "y") }) };
    }
    if (req.path === "/checkout/embedded/confirm") return { body: { ok: true, order_id: req.body.order_id, order: { order_id: req.body.order_id, status: "paid", payment_status: "paid", total_amount: 2000, currency: "USD" } } };
    if (req.path === "/checkout/cancel") return { body: { ok: true, cancelled: true } };
    return undefined;
  };
}

describe("checkout", () => {
  it("starts a hosted checkout with the full payload and idempotency headers", async () => {
    const storage = new MemoryStorageAdapter();
    seeded(storage);
    const { commerce, calls } = makeCommerce(api(), { storage, successUrl: "/thanks" });
    const started = vi.fn();
    commerce.on("checkout:started", started);
    const session = await commerce.checkout.startHosted({ billingAddress: BILLING });
    expect(session.mode).toBe("hosted");
    expect(session.checkoutUrl).toBe("https://checkout.stripe.com/s/1");
    expect(session.orderId).toBe("ord_1");
    expect(session.lookupToken).toMatch(/^tok_/);
    expect(session.totals?.totalAmount).toBe(2000);
    expect(started).toHaveBeenCalledTimes(1);
    const req = calls.find((c) => c.path === "/checkout/session")!;
    expect(req.headers["idempotency-key"]).toBeTruthy();
    expect(req.headers["x-grigora-checkout-client"]).toBe(commerce.clientId());
    expect(req.body).toMatchObject({
      project_id: "p1",
      line_items: [{ product_id: "a", variant_id: "", quantity: 2 }],
      customer_email: "ada@example.com",
      customer_name: "Ada Lovelace",
      billing_address: { postal_code: "94105", country: "US", phone: "4155552671" },
      shipping_address: { postal_code: "94105" },
      success_url: `${window.location.origin}/thanks`,
      idempotency_key: req.headers["idempotency-key"],
      checkout_client_id: commerce.clientId(),
    });
    expect(commerce.checkout.current()?.orderId).toBe("ord_1");
  });

  it("reuses the idempotency key for an identical retry and mints a new one when the input changes", async () => {
    const storage = new MemoryStorageAdapter();
    seeded(storage);
    let fail = true;
    const { commerce, calls } = makeCommerce(
      api({
        "/checkout/session": () => {
          if (fail) {
            fail = false;
            return { status: 400, body: { code: "checkout_in_progress", message: "still creating" } };
          }
          return api()({ path: "/checkout/session" } as FakeRequest)!;
        },
      }),
      { storage }
    );
    await expect(commerce.checkout.startHosted({ billingAddress: BILLING })).rejects.toMatchObject({ code: "checkout_in_progress" });
    await commerce.checkout.startHosted({ billingAddress: BILLING });
    const keys = calls.filter((c) => c.path === "/checkout/session").map((c) => c.headers["idempotency-key"]);
    expect(keys[0]).toBe(keys[1]);
    await commerce.checkout.startHosted({ billingAddress: { ...BILLING, line1: "2 Other St" } });
    const third = calls.filter((c) => c.path === "/checkout/session")[2].headers["idempotency-key"];
    expect(third).not.toBe(keys[0]);
  });

  it("drops the key after a hard failure so the next attempt is fresh", async () => {
    const storage = new MemoryStorageAdapter();
    seeded(storage);
    let first = true;
    const { commerce, calls } = makeCommerce(
      api({
        "/checkout/session": (req) => {
          if (first) {
            first = false;
            return { status: 409, body: { message: "Some items are out of stock.", out_of_stock: [{ product_id: "a" }] } };
          }
          return api()(req)!;
        },
      }),
      { storage }
    );
    const failed = vi.fn();
    commerce.on("checkout:failed", failed);
    await expect(commerce.checkout.startHosted({ billingAddress: BILLING })).rejects.toMatchObject({ code: "out_of_stock" });
    await commerce.checkout.startHosted({ billingAddress: BILLING });
    const keys = calls.filter((c) => c.path === "/checkout/session").map((c) => c.headers["idempotency-key"]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("validates addresses locally before calling the API", async () => {
    const storage = new MemoryStorageAdapter();
    seeded(storage);
    const { commerce, calls } = makeCommerce(api(), { storage });
    await expect(commerce.checkout.startHosted({ billingAddress: { ...BILLING, email: "nope" } })).rejects.toMatchObject({
      code: "invalid_address",
      details: { scope: "billing", field: "email" },
    });
    expect(calls.filter((c) => c.path === "/checkout/session")).toHaveLength(0);
  });

  it("refuses an empty cart", async () => {
    const { commerce } = makeCommerce(api());
    await expect(commerce.checkout.start({ billingAddress: BILLING })).rejects.toMatchObject({ code: "cart_empty" });
  });

  it("picks embedded or hosted from the store settings and the payment preference", async () => {
    const storage = new MemoryStorageAdapter();
    seeded(storage);
    const { commerce, calls } = makeCommerce(api(), { storage });
    const session = await commerce.checkout.start({ billingAddress: BILLING });
    expect(session.mode).toBe("embedded");
    expect(session.clientData.client_secret).toBe("pi_1_secret");
    expect(session.amount).toBe(2000);
    const hosted = await commerce.checkout.start({ billingAddress: BILLING }, { payment: "hosted" });
    expect(hosted.mode).toBe("hosted");
    expect(calls.filter((c) => c.path === "/checkout/embedded")).toHaveLength(1);
    expect(calls.filter((c) => c.path === "/checkout/session")).toHaveLength(1);

    const store = await commerce.store.get();
    expect(commerce.checkout.resolveMode(store)).toBe("embedded");
    expect(commerce.checkout.resolveMode(store, "hosted")).toBe("hosted");
    expect(commerce.checkout.resolveMode({ ...store, checkout: { ...store.checkout, embeddedSupported: false } }, "embedded")).toBe("hosted");
  });

  it("surfaces an unavailable store with the merchant-facing reason", async () => {
    const storage = new MemoryStorageAdapter();
    seeded(storage);
    const { commerce } = makeCommerce(
      api({ "/storefront/p1/settings": () => ({ body: { store: { ...STORE, checkout: { ...STORE.checkout, mode: "unavailable", embedded_supported: false, hosted_supported: false, message: "Stripe is selected but not fully configured." } } } }) }),
      { storage }
    );
    await expect(commerce.checkout.start({ billingAddress: BILLING })).rejects.toMatchObject({ code: "checkout_unavailable", message: "Stripe is selected but not fully configured." });
  });

  it("treats a free cart as completed immediately", async () => {
    const storage = new MemoryStorageAdapter();
    seeded(storage);
    const { commerce } = makeCommerce(
      api({
        "/checkout/session": () => ({
          body: checkoutOutput(
            { provider: "manual", mode: "free", checkout_url: "https://shop.test/thank-you?order_id=ord_f&lookup_token=tok", order_id: "ord_f", lookup_token: "tok_".padEnd(24, "z") },
            { order: { order_id: "ord_f", status: "paid", payment_status: "paid", total_amount: 0 }, total_amount: 0 }
          ),
        }),
      }),
      { storage }
    );
    const completed = vi.fn();
    commerce.on("checkout:completed", completed);
    const session = await commerce.checkout.startHosted({ billingAddress: BILLING });
    expect(session.mode).toBe("free");
    expect(session.order?.paymentState).toBe("paid");
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ orderId: "ord_f" }));
  });

  it("confirms an embedded payment and emits completion", async () => {
    const storage = new MemoryStorageAdapter();
    seeded(storage);
    const { commerce, calls } = makeCommerce(api(), { storage });
    const completed = vi.fn();
    const paid = vi.fn();
    commerce.on("checkout:completed", completed);
    commerce.on("order:paid", paid);
    const session = await commerce.checkout.startEmbedded({ billingAddress: BILLING });
    const result = await commerce.checkout.confirm({ provider: "stripe", orderId: session.orderId, payload: { payment_intent_id: "pi_1" } });
    expect(result.ok).toBe(true);
    expect(result.order?.paymentState).toBe("paid");
    const req = calls.find((c) => c.path === "/checkout/embedded/confirm")!;
    expect(req.body).toMatchObject({ project_id: "p1", provider: "stripe", order_id: "ord_2", payment_intent_id: "pi_1" });
    expect(req.headers["idempotency-key"]).toBeUndefined();
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ orderId: "ord_2", lookupToken: session.lookupToken }));
    expect(paid).toHaveBeenCalledTimes(1);
  });

  it("cancels a prepared checkout with its token and never throws", async () => {
    const storage = new MemoryStorageAdapter();
    seeded(storage);
    const { commerce, calls } = makeCommerce(api({ "/checkout/cancel": () => ({ status: 400, body: { message: "gone" } }) }), { storage });
    const cancelled = vi.fn();
    commerce.on("checkout:cancelled", cancelled);
    const session = await commerce.checkout.startEmbedded({ billingAddress: BILLING });
    await commerce.checkout.cancel(session);
    const req = calls.find((c) => c.path === "/checkout/cancel")!;
    expect(req.body).toEqual({ project_id: "p1", order_id: "ord_2", token: session.lookupToken });
    expect(commerce.checkout.current()).toBeNull();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("starts a single-product checkout with pay-what-you-want amounts in major units", async () => {
    const { commerce, calls } = makeCommerce(
      api({ "/checkout/create": () => ({ body: { checkout: { provider: "stripe", mode: "hosted", checkout_url: "https://pay/1", order_id: "ord_s", lookup_token: "tok_".padEnd(24, "s") } } }) })
    );
    const session = await commerce.checkout.startSingle({ slug: "tip-jar", customerEmail: "Ada@Example.com", amount: 1550 });
    expect(session.checkoutUrl).toBe("https://pay/1");
    const req = calls.find((c) => c.path === "/checkout/create")!;
    expect(req.body).toMatchObject({ slug: "tip-jar", customer_email: "ada@example.com", custom_amount: "15.50" });
    expect(req.headers["idempotency-key"]).toBeTruthy();
    await expect(commerce.checkout.startSingle({ customerEmail: "a@b.co" })).rejects.toMatchObject({ code: "validation_error" });
  });

  it("parses and handles a return URL, confirming a Stripe redirect payment", async () => {
    const { commerce, calls } = makeCommerce(api());
    expect(commerce.checkout.parseReturn("https://shop.test/thanks")).toBeNull();
    expect(commerce.checkout.parseReturn("https://shop.test/thanks?order_id=ord_1&lookup_token=short")).toBeNull();
    const token = "tok_".padEnd(24, "q");
    const plain = await commerce.checkout.handleReturn(`https://shop.test/thanks?order_id=ord_1&lookup_token=${token}`);
    expect(plain).toMatchObject({ orderId: "ord_1", lookupToken: token, confirmed: null });
    const stripe = await commerce.checkout.handleReturn(`https://shop.test/checkout?order_id=ord_1&lookup_token=${token}&payment_intent=pi_9&redirect_status=succeeded`);
    expect(stripe).toMatchObject({ orderId: "ord_1", confirmed: true });
    expect(calls.find((c) => c.path === "/checkout/embedded/confirm")?.body).toMatchObject({ payment_intent_id: "pi_9", order_id: "ord_1" });
  });

  it("quotes with addresses through the cart", async () => {
    const storage = new MemoryStorageAdapter();
    seeded(storage);
    const { commerce, calls } = makeCommerce(api(), { storage });
    await commerce.checkout.quote({ billingAddress: BILLING, shippingRateId: "r1" });
    const req = calls.find((c) => c.path === "/cart/validate")!;
    expect(req.body.billing_address).toMatchObject({ country: "US" });
    expect(req.body.shipping_address).toMatchObject({ country: "US" });
    expect(req.body.shipping_rate_id).toBe("r1");
  });
});

describe("catalog", () => {
  it("loads the catalog once and answers get()/find() from it", async () => {
    const { commerce, calls } = makeCommerce((req) => {
      if (req.path === "/storefront/p1/catalog") return { body: { store: STORE, products: [catalogLine("a"), catalogLine("b")], collections: [{ id: "c", slug: "all", title: "All", product_ids: ["a", "b"] }] } };
      return undefined;
    });
    const catalog = await commerce.products.catalog();
    expect(catalog.products).toHaveLength(2);
    expect(catalog.products[0].priceFormatted).toBe("$12.00");
    expect(catalog.collections[0].productCount).toBe(2);
    expect(commerce.products.find("b")?.id).toBe("b");
    const product = await commerce.products.get("a");
    expect(product.slug).toBe("a");
    expect(commerce.store.current()?.storeName).toBe("Test Store");
    expect(calls).toHaveLength(1);
    expect((await commerce.products.collections())[0].slug).toBe("all");
    expect(calls).toHaveLength(1);
  });

  it("lists with query params and maps pagination", async () => {
    const { commerce, calls } = makeCommerce((req) => {
      if (req.path === "/storefront/p1/products") return { body: { products: [catalogLine("z")], total: 7, limit: 1, next_cursor: "Mg" } };
      return undefined;
    });
    const list = await commerce.products.list({ collection: "all", limit: 1, inStock: true, sort: "price_asc", ids: ["z", "y"] });
    expect(list.products[0].id).toBe("z");
    expect(list.total).toBe(7);
    expect(list.nextCursor).toBe("Mg");
    expect(calls[0].url.searchParams.get("collection")).toBe("all");
    expect(calls[0].url.searchParams.get("in_stock")).toBe("1");
    expect(calls[0].url.searchParams.get("ids")).toBe("z,y");
  });

  it("maps a missing product to not_found", async () => {
    const { commerce } = makeCommerce((req) => (req.path.startsWith("/storefront/p1/products/") ? { status: 404, body: { code: "not_found", message: "Product not found." } } : undefined));
    await expect(commerce.products.get("nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("orders, discounts, availability", () => {
  it("looks up an order and derives its payment state", async () => {
    const { commerce, calls } = makeCommerce((req) =>
      req.path === "/orders/lookup"
        ? { body: { order: { order_id: "ord_1", status: "paid", payment_status: "paid", total_amount: 2000, currency: "USD", line_items: [{ title: "A", quantity: 2, unit_amount: 1000 }], invoice_url: "https://inv/1" } } }
        : undefined
    );
    const order = await commerce.orders.lookup({ orderId: "ord_1", lookupToken: "tok_".padEnd(24, "a") });
    expect(order.paymentState).toBe("paid");
    expect(order.lineItems[0]).toEqual({ title: "A", quantity: 2, unitAmount: 1000 });
    expect(calls[0].body).toEqual({ project_id: "p1", order_id: "ord_1", lookup_token: "tok_".padEnd(24, "a") });
    await expect(commerce.orders.lookup({ orderId: "ord_1" })).rejects.toMatchObject({ code: "unauthorized" });
    expect(commerce.orders.invoiceUrl({ invoiceId: "inv_1", token: "t", format: "pdf" })).toBe("https://api.test/general/commerce/invoice/p1/inv_1/pdf?token=t");
  });

  it("validates a product discount and checks availability", async () => {
    const { commerce, calls } = makeCommerce((req) => {
      if (req.path === "/discounts/validate") return { body: { ok: true, code: "TEN", type: "percent", value: "10", discount_amount: 120, currency: "USD", original_amount: 1200, final_amount: 1080 } };
      if (req.path === "/storefront/availability") return { body: { availability: [{ product_id: "a", variant_id: "", available: 3, in_stock: true }] } };
      return undefined;
    });
    const discount = await commerce.discounts.validate({ code: "ten", productId: "a" });
    expect(discount).toMatchObject({ ok: true, code: "TEN", discountAmount: 120, finalAmount: 1080 });
    expect(calls[0].url.searchParams.get("product_id")).toBe("a");
    const availability = await commerce.availability.check([{ productId: "a" }]);
    expect(availability[0]).toEqual({ productId: "a", variantId: "", available: 3, inStock: true });
  });

  it("returns a signed download url", async () => {
    const { commerce, calls } = makeCommerce((req) => (req.path === "/delivery/download" ? { body: { download_url: "https://s3/file?sig=1" } } : undefined));
    expect(await commerce.orders.downloadUrl({ orderId: "ord_1", token: "dl" })).toBe("https://s3/file?sig=1");
    expect(calls[0].url.searchParams.get("format")).toBe("json");
  });
});

describe("instance lifecycle", () => {
  it("exposes a version and destroys cleanly", () => {
    const { commerce } = makeCommerce(() => undefined);
    expect(commerce.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(commerce.getStorefrontLang()).toBe("en");
    const session: CheckoutSession | null = commerce.checkout.current();
    expect(session).toBeNull();
    commerce.destroy();
    expect(() => commerce.destroy()).not.toThrow();
  });
});
