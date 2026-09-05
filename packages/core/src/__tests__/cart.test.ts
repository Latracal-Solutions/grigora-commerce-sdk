import { describe, expect, it, vi } from "vitest";
import { MemoryStorageAdapter } from "../storage";
import type { Cart } from "../types";
import { catalogLine, makeCommerce, serverLine, validateResponse, flush, STORE } from "./helpers";

function validateFrom(request: { body: Record<string, unknown> }, prices: Record<string, number>, extra: Record<string, unknown> = {}) {
  const lines = (request.body.line_items as Array<{ product_id: string; quantity: number }>).map((line) =>
    serverLine(line.product_id, prices[line.product_id] ?? 1000, line.quantity)
  );
  return { body: validateResponse(lines, extra) };
}

describe("cart storage compatibility", () => {
  it("reads a cart written by the platform's legacy storefront script", () => {
    const storage = new MemoryStorageAdapter();
    storage.set(
      "grigora-cart-p1",
      JSON.stringify([
        { product_id: "mug", variant_id: "", quantity: 2, title: "Blue Mug", price: 1200, currency: "USD", image: "https://img/mug.jpg", product_url: "/product/mug", in_stock: true },
      ])
    );
    storage.set("grigora-cart-p1-discount", "save10");
    const { commerce } = makeCommerce(() => undefined, { storage });
    const cart = commerce.cart.get();
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ productId: "mug", quantity: 2, unitAmount: 1200, title: "Blue Mug", imageUrl: "https://img/mug.jpg", productUrl: "/product/mug" });
    expect(cart.subtotalAmount).toBe(2400);
    expect(cart.itemCount).toBe(2);
    expect(cart.validated).toBe(false);
    expect(cart.totalIsEstimate).toBe(true);
    expect(commerce.cart.getDiscount()).toBe("SAVE10");
  });

  it("writes back the same array shape the legacy scripts read", async () => {
    const storage = new MemoryStorageAdapter();
    const { commerce } = makeCommerce((req) => (req.path === "/cart/validate" ? validateFrom(req, { mug: 1200 }) : undefined), { storage });
    await commerce.cart.add({ productId: "mug", quantity: 1, title: "Blue Mug", unitAmount: 1200 });
    const stored = JSON.parse(storage.get("grigora-cart-p1") || "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ product_id: "mug", variant_id: "", quantity: 1, price: 1200, title: "Product mug", image: "https://img/mug.jpg", product_url: "https://shop.test/product/mug", slug: "mug", in_stock: true, requires_shipping: false });
  });

  it("drops a cart idle longer than cartMaxAgeMs", () => {
    const storage = new MemoryStorageAdapter();
    storage.set("grigora-cart-p1", JSON.stringify([{ product_id: "old", quantity: 1 }]));
    storage.set("grigora-cart-p1-meta", JSON.stringify({ updated_at: Date.now() - 40 * 24 * 3600 * 1000 }));
    const { commerce } = makeCommerce(() => undefined, { storage });
    expect(commerce.cart.get().lines).toHaveLength(0);
    expect(storage.get("grigora-cart-p1")).toBe("[]");
  });

  it("keeps a legacy cart that has no timestamp", () => {
    const storage = new MemoryStorageAdapter();
    storage.set("grigora-cart-p1", JSON.stringify([{ product_id: "old", quantity: 1 }]));
    const { commerce } = makeCommerce(() => undefined, { storage });
    expect(commerce.cart.get().lines).toHaveLength(1);
  });

  it("ignores malformed entries", () => {
    const storage = new MemoryStorageAdapter();
    storage.set("grigora-cart-p1", JSON.stringify([null, 5, { quantity: 2 }, { product_id: "ok", quantity: "3" }]));
    const { commerce } = makeCommerce(() => undefined, { storage });
    expect(commerce.cart.get().lines).toEqual([expect.objectContaining({ productId: "ok", quantity: 3 })]);
  });
});

describe("cart mutations", () => {
  it("adds, merges, replaces, updates and removes lines with optimistic events", async () => {
    const { commerce } = makeCommerce((req) => (req.path === "/cart/validate" ? validateFrom(req, { a: 500, b: 700 }) : undefined));
    const changes: Cart[] = [];
    commerce.on("cart:changed", (cart) => changes.push(cart));

    await commerce.cart.add({ productId: "a", quantity: 1, unitAmount: 500, title: "A" });
    expect(changes[0].lines[0].quantity).toBe(1);
    expect(changes[0].validated).toBe(false);
    expect(commerce.cart.get().validated).toBe(true);
    expect(commerce.cart.get().totalAmount).toBe(500);

    await commerce.cart.add({ productId: "a", quantity: 2 });
    expect(commerce.cart.findLine("a")?.quantity).toBe(3);
    await commerce.cart.add({ productId: "a", quantity: 1, replace: true });
    expect(commerce.cart.findLine("a")?.quantity).toBe(1);

    await commerce.cart.add({ productId: "b", quantity: 1 });
    expect(commerce.cart.count()).toBe(2);
    expect(commerce.cart.subtotal()).toBe(1200);

    const lineB = commerce.cart.lineId("b");
    await commerce.cart.update(lineB, { quantity: 4 });
    expect(commerce.cart.findLine("b")?.quantity).toBe(4);
    await commerce.cart.increment(lineB, -1);
    expect(commerce.cart.findLine("b")?.quantity).toBe(3);
    await commerce.cart.update(lineB, { quantity: 0 });
    expect(commerce.cart.findLine("b")).toBeNull();

    const removed: string[] = [];
    commerce.on("cart:line_removed", ({ lineId }) => removed.push(lineId));
    await commerce.cart.remove(commerce.cart.lineId("a"));
    expect(removed).toEqual([commerce.cart.lineId("a")]);
    expect(commerce.cart.isEmpty()).toBe(true);
    expect(commerce.cart.get().totalAmount).toBe(0);
  });

  it("resolves a slug through the catalog and refuses a variant product without a variant", async () => {
    const product = { ...catalogLine("tee"), has_variants: true, options: [{ name: "Size", values: ["S", "M"] }], variants: [
      { variant_id: "s", title: "S", option_values: { Size: "S" }, price_amount: 1500, currency: "USD", in_stock: true, inventory: { tracked: false, available: null } },
    ] };
    const { commerce, calls } = makeCommerce((req) => {
      if (req.path === "/storefront/p1/products/tee") return { body: { product } };
      if (req.path === "/cart/validate") return validateFrom(req, { tee: 1500 });
      return undefined;
    });
    await expect(commerce.cart.add({ productSlug: "tee" })).rejects.toMatchObject({ code: "variant_required" });
    await commerce.cart.add({ productSlug: "tee", variantId: "s" });
    const line = commerce.cart.findLine("tee", "s");
    expect(line?.variantId).toBe("s");
    expect(calls.filter((c) => c.path === "/storefront/p1/products/tee")).toHaveLength(2);
  });

  it("requires a product reference", async () => {
    const { commerce } = makeCommerce(() => undefined);
    await expect(commerce.cart.add({ quantity: 1 })).rejects.toMatchObject({ code: "validation_error" });
  });
});

describe("cart validation", () => {
  it("syncs server prices, titles, images and stock into lines and totals", async () => {
    const { commerce } = makeCommerce((req) =>
      req.path === "/cart/validate"
        ? {
            body: validateResponse([serverLine("a", 999, 2, { title: "Real A", in_stock: false, available: 0, requires_shipping: true })], {
              discount_code: "SAVE",
              discount_amount: 100,
              subtotal_after_discount_amount: 1898,
              shipping_amount: 500,
              shipping_quote: { required: true, eligible: true, code: "shipping_rate_selected", rate_id: "r1", rate_name: "Standard", amount: 500, available_rates: [{ rate_id: "r1", rate_name: "Standard", amount: 500, currency: "USD" }] },
              tax_amount: 50,
              total_is_estimate: true,
              total_amount: 2448,
            }),
          }
        : undefined
    );
    const validated = vi.fn();
    commerce.on("cart:validated", validated);
    await commerce.cart.add({ productId: "a", quantity: 2, unitAmount: 1 });
    const cart = commerce.cart.get();
    expect(cart.lines[0]).toMatchObject({ unitAmount: 999, title: "Real A", inStock: false, available: 0, requiresShipping: true, totalAmount: 1998 });
    expect(cart).toMatchObject({ subtotalAmount: 1998, discountCode: "SAVE", discountAmount: 100, shippingAmount: 500, taxAmount: 50, totalAmount: 2448, totalIsEstimate: true, allInStock: false, requiresShipping: true, validated: true });
    expect(cart.shippingQuote?.availableRates[0]).toMatchObject({ rateId: "r1", rateName: "Standard", amount: 500 });
    expect(validated).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale response when a newer validation is in flight", async () => {
    let resolveFirst: ((value: { body: unknown }) => void) | null = null;
    let callCount = 0;
    const { commerce } = makeCommerce((req) => {
      if (req.path !== "/cart/validate") return undefined;
      callCount += 1;
      if (callCount === 1) {
        return new Promise<{ body: unknown }>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return validateFrom(req, { a: 200 });
    });
    const first = commerce.cart.add({ productId: "a", quantity: 1, unitAmount: 100 });
    await flush();
    const second = commerce.cart.update(commerce.cart.lineId("a"), { quantity: 5 });
    await second;
    expect(commerce.cart.get().totalAmount).toBe(1000);
    (resolveFirst as ((value: { body: unknown }) => void) | null)?.({ body: validateResponse([serverLine("a", 100, 1)]) });
    await first;
    expect(commerce.cart.get().totalAmount).toBe(1000);
    expect(commerce.cart.get().lines[0].quantity).toBe(5);
  });

  it("drops a discount the server rejects during a background validation, but throws from setDiscount", async () => {
    const { commerce } = makeCommerce((req) => {
      if (req.path !== "/cart/validate") return undefined;
      if (req.body.discount_code === "BAD") return { status: 400, body: { message: "This discount code is invalid." } };
      return validateFrom(req, { a: 1000 }, req.body.discount_code ? { discount_code: req.body.discount_code, discount_amount: 100 } : {});
    });
    await commerce.cart.add({ productId: "a", quantity: 1, unitAmount: 1000 });
    await expect(commerce.cart.setDiscount("bad")).rejects.toMatchObject({ code: "invalid_discount" });
    expect(commerce.cart.getDiscount()).toBe("");

    await commerce.cart.setDiscount("good");
    expect(commerce.cart.getDiscount()).toBe("GOOD");
    expect(commerce.cart.get().discountAmount).toBe(100);

    // The code is later disabled by the merchant: the next background validation clears it quietly.
    const removed = vi.fn();
    commerce.on("cart:discount_removed", removed);
    (commerce.cart as unknown as { discount: string }).discount = "BAD";
    await commerce.cart.validate();
    expect(removed).toHaveBeenCalledWith(expect.objectContaining({ code: "BAD" }));
    expect(commerce.cart.getDiscount()).toBe("");
    expect(commerce.cart.get().validated).toBe(true);
  });

  it("isolates and removes the product that is no longer sold", async () => {
    const { commerce } = makeCommerce((req) => {
      if (req.path !== "/cart/validate") return undefined;
      const ids = (req.body.line_items as Array<{ product_id: string }>).map((l) => l.product_id);
      if (ids.includes("gone")) return { status: 400, body: { message: "A product in your cart is no longer available.", code: "product_unavailable" } };
      return validateFrom(req, { keep: 300 });
    });
    const storage = (commerce.config.storage as MemoryStorageAdapter);
    storage.set("grigora-cart-p1", JSON.stringify([{ product_id: "keep", quantity: 1 }, { product_id: "gone", quantity: 1 }]));
    (commerce.cart as unknown as { load: () => void }).load();
    const cart = await commerce.cart.validate();
    expect(cart.lines.map((l) => l.productId)).toEqual(["keep"]);
    expect(cart.validated).toBe(true);
    expect(cart.error).toBeNull();
  });

  it("rejects an add whose product does not exist", async () => {
    const { commerce } = makeCommerce((req) =>
      req.path === "/cart/validate" ? { status: 400, body: { message: "A product in your cart is no longer available.", code: "product_unavailable" } } : undefined
    );
    await expect(commerce.cart.add({ productId: "ghost" })).rejects.toMatchObject({ code: "product_unavailable" });
    expect(commerce.cart.isEmpty()).toBe(true);
  });

  it("records other failures on cart.error without throwing", async () => {
    const { commerce } = makeCommerce((req) => (req.path === "/cart/validate" ? { status: 500, body: { message: "db down" } } : undefined));
    const errors = vi.fn();
    commerce.on("cart:error", errors);
    (commerce.config.storage as MemoryStorageAdapter).set("grigora-cart-p1", JSON.stringify([{ product_id: "a", quantity: 1, price: 100 }]));
    (commerce.cart as unknown as { load: () => void }).load();
    const cart = await commerce.cart.validate();
    expect(cart.error?.code).toBe("network_error");
    expect(cart.validated).toBe(false);
    expect(cart.totalAmount).toBe(100);
    expect(errors).toHaveBeenCalledTimes(1);
    await expect(commerce.cart.validate({ throwOnError: true })).rejects.toMatchObject({ code: "network_error" });
  }, 15_000);

  it("passes addresses, rate and discount through to /cart/validate", async () => {
    const { commerce, calls } = makeCommerce((req) => (req.path === "/cart/validate" ? validateFrom(req, { a: 100 }) : undefined));
    await commerce.cart.add({ productId: "a", unitAmount: 100 });
    await commerce.cart.validate({
      billingAddress: { name: "A", email: "a@b.co", country: "us", postalCode: "94105" },
      shippingRateId: "r1",
      discountCode: "TEN",
    });
    const last = calls[calls.length - 1];
    expect(last.body.billing_address).toMatchObject({ name: "A", email: "a@b.co", country: "US", postal_code: "94105" });
    expect(last.body.shipping_rate_id).toBe("r1");
    expect(last.body.discount_code).toBe("TEN");
    expect(last.body.line_items).toEqual([{ product_id: "a", variant_id: "", quantity: 1 }]);
  });

  it("reloads when another tab changes the cart", async () => {
    const storage = new MemoryStorageAdapter();
    const { commerce } = makeCommerce(() => undefined, { storage });
    const changed = vi.fn();
    commerce.on("cart:changed", changed);
    storage.set("grigora-cart-p1", JSON.stringify([{ product_id: "x", quantity: 2, price: 50 }]));
    window.dispatchEvent(new StorageEvent("storage", { key: "grigora-cart-p1" }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(commerce.cart.get().lines[0]).toMatchObject({ productId: "x", quantity: 2 });
  });

  it("clear() empties lines and the discount", async () => {
    const { commerce } = makeCommerce((req) => (req.path === "/cart/validate" ? validateFrom(req, { a: 100 }) : undefined));
    await commerce.cart.add({ productId: "a", unitAmount: 100 });
    const cart = commerce.cart.clear();
    expect(cart.lines).toHaveLength(0);
    expect(commerce.cart.getDiscount()).toBe("");
    expect(commerce.cart.get().validated).toBe(false);
  });
});

describe("store settings and currency", () => {
  it("formats with the store currency once loaded", async () => {
    const { commerce } = makeCommerce((req) => (req.path === "/storefront/p1/settings" ? { body: { store: { ...STORE, currency: "INR" } } } : undefined));
    expect(commerce.formatCurrency(123456)).toBe("$1,234.56");
    const loaded = vi.fn();
    commerce.on("store:loaded", loaded);
    const store = await commerce.store.get();
    expect(store.currency).toBe("INR");
    expect(store.checkout.mode).toBe("embedded");
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(commerce.formatCurrency(123456)).toBe("₹1,234.56");
    expect(commerce.currency.toMinor(29.99)).toBe(2999);
    expect(commerce.currency.toMajor(2999)).toBe(29.99);
    expect(commerce.currency.symbol("USD")).toBe("$");
  });
});
