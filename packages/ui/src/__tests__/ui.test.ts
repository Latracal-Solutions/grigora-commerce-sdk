import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorageAdapter, type GrigoraCommerce, type PaymentAdapterContext, type PaymentProviderAdapter } from "@grigora/commerce-core";
import { installUI, type UIHandle } from "../install";
import type { GCartDrawer } from "../drawer";
import type { GBuyBox } from "../buy-box";
import type { GCheckout } from "../checkout";
import type { GOrderStatus } from "../order-status";
import { resetReturn } from "../return";
import { catalogLine, fakeFetch, serverLine, validateResponse, STORE, type FakeRequest } from "../../../core/src/__tests__/helpers";
import { createCommerce } from "../../../core/src/commerce";

const TEE = {
  ...catalogLine("tee"),
  title: "Tee",
  price_amount: 1500,
  compare_at_amount: 2000,
  has_variants: true,
  options: [{ name: "Size", values: ["S", "M"] }],
  variants: [
    { variant_id: "s", title: "S", option_values: { Size: "S" }, price_amount: 1500, currency: "USD", in_stock: true, inventory: { tracked: true, available: 3 } },
    { variant_id: "m", title: "M", option_values: { Size: "M" }, price_amount: 1700, currency: "USD", in_stock: false, inventory: { tracked: true, available: 0 } },
  ],
};

const PRICES: Record<string, number> = { a: 500, b: 700, tee: 1500 };

function api(overrides: Partial<Record<string, (req: FakeRequest) => { status?: number; body?: unknown } | undefined>> = {}) {
  return (req: FakeRequest) => {
    const custom = overrides[req.path];
    if (custom) return custom(req);
    if (req.path === "/storefront/p1/settings") return { body: { store: STORE } };
    if (req.path === "/storefront/p1/catalog") return { body: { store: STORE, products: [catalogLine("a"), catalogLine("b"), TEE], collections: [] } };
    if (req.path === "/storefront/p1/products/tee") return { body: { product: TEE } };
    if (req.path === "/storefront/p1/products/a") return { body: { product: catalogLine("a") } };
    if (req.path === "/cart/validate") {
      const lines = (req.body.line_items as Array<{ product_id: string; variant_id: string; quantity: number }>).map((line) =>
        serverLine(line.product_id, PRICES[line.product_id] ?? 1000, line.quantity, { variant_id: line.variant_id || "", requires_shipping: line.product_id === "b" })
      );
      const requiresShipping = lines.some((l) => l.requires_shipping);
      const address = req.body.shipping_address as { country?: string } | undefined;
      return {
        body: validateResponse(lines, {
          requires_shipping: requiresShipping,
          shipping_amount: requiresShipping && address?.country ? 500 : 0,
          total_amount: lines.reduce((sum, l) => sum + l.unit_amount * l.quantity, 0) + (requiresShipping && address?.country ? 500 : 0),
          shipping_quote: requiresShipping
            ? address?.country
              ? { required: true, eligible: true, code: "shipping_rate_selected", rate_id: "std", rate_name: "Standard", amount: 500, country: address.country, available_rates: [{ rate_id: "std", rate_name: "Standard", amount: 500, currency: "USD" }, { rate_id: "exp", rate_name: "Express", amount: 1500, currency: "USD" }] }
              : { required: true, eligible: false, code: "shipping_address_required", message: "Enter a shipping country to see available delivery rates.", available_rates: [] }
            : { required: false, eligible: true, code: "not_required", available_rates: [] },
        }),
      };
    }
    if (req.path === "/checkout/session") {
      return { body: { checkout: { provider: "stripe", mode: "hosted", checkout_url: "https://checkout.stripe.com/s/1", order_id: "ord_h", lookup_token: "tok_".padEnd(24, "h") }, order_id: "ord_h", subtotal_amount: 500, total_amount: 500, currency: "USD" } };
    }
    if (req.path === "/checkout/embedded") {
      return { body: { checkout: { provider: "stripe", mode: "embedded", order_id: "ord_e", client_secret: "pi_secret", publishable_key: "pk_test_1", amount: 500, currency: "USD", lookup_token: "tok_".padEnd(24, "e") }, order_id: "ord_e", subtotal_amount: 500, total_amount: 500, currency: "USD" } };
    }
    if (req.path === "/checkout/embedded/confirm") return { body: { ok: true, order_id: req.body.order_id, order: { order_id: req.body.order_id, status: "paid", payment_status: "paid", total_amount: 500, currency: "USD" } } };
    if (req.path === "/checkout/cancel") return { body: { ok: true } };
    if (req.path === "/orders/lookup") {
      const id = String(req.body.order_id);
      if (id === "ord_pending") return { body: { order: { order_id: id, status: "pending", payment_status: "pending", total_amount: 500, currency: "USD" } } };
      if (id === "ord_bad") return { status: 404, body: { message: "Order not found." } };
      return { body: { order: { order_id: id, status: "paid", payment_status: "paid", total_amount: 500, currency: "USD", line_items: [{ title: "Product a", quantity: 1, unit_amount: 500 }], invoice_url: "https://inv/1" } } };
    }
    return undefined;
  };
}

const BILLING = { name: "Ada Lovelace", email: "ada@example.com", phone: "4155552671", line1: "1 Market St", city: "San Francisco", state: "CA", postalCode: "94105", country: "US" };

let commerce: GrigoraCommerce;
let handle: UIHandle | null = null;
let calls: FakeRequest[];
let navigate: ReturnType<typeof vi.fn>;

function setup(handler = api(), storage = new MemoryStorageAdapter(), uiOptions = {}) {
  const fake = fakeFetch(handler);
  calls = fake.calls;
  navigate = vi.fn();
  commerce = createCommerce({ projectId: "p1", apiBase: "https://api.test", fetch: fake.fetchImpl, storage, locale: "en-US", navigate: navigate as unknown as (url: string) => void });
  handle = installUI(commerce, { continueShoppingUrl: "/shop", ...uiOptions });
  return commerce;
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) await tick(5);
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  commerce?.destroy();
  document.body.innerHTML = "";
  document.documentElement.style.overflow = "";
});

describe("installUI", () => {
  it("injects styles once, creates the drawer and exposes a handle on the instance", () => {
    setup();
    expect(document.getElementById("grigora-commerce-ui")).not.toBeNull();
    expect(document.querySelector("g-cart-drawer")).not.toBeNull();
    expect(commerce.ui).toBe(handle);
    expect(customElements.get("g-checkout")).toBeTruthy();
  });

  it("applies the store accent colour once settings load", async () => {
    setup(api({ "/storefront/p1/settings": () => ({ body: { store: { ...STORE, appearance: { accent_color: "#ff0055" } } } }) }));
    await settle();
    expect(document.getElementById("grigora-commerce-theme")?.textContent).toContain("--g-accent:#ff0055");
  });
});

describe("cart drawer", () => {
  it("opens with dialog semantics, renders lines, and closes on Escape restoring focus", async () => {
    setup();
    const opener = document.body.appendChild(document.createElement("button"));
    opener.setAttribute("data-cart-open", "");
    opener.textContent = "Cart";
    await commerce.cart.add({ productId: "a", quantity: 2, title: "A", unitAmount: 500 });
    opener.focus();
    opener.click();
    await settle();
    const drawer = document.querySelector("g-cart-drawer") as GCartDrawer;
    const panel = drawer.querySelector(".g-cart-drawer")!;
    expect(drawer.open).toBe(true);
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(panel.getAttribute("aria-hidden")).toBe("false");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close cart");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(panel.textContent).toContain("Product a");
    expect(panel.querySelector(".g-cart-line-price")?.textContent).toContain("$10.00");
    expect(panel.querySelector(".g-row-total")?.textContent).toContain("$10.00");
    expect(panel.querySelector("[data-cart-checkout]")?.hasAttribute("disabled")).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(drawer.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("changes quantities and removes lines from the drawer", async () => {
    setup();
    await commerce.cart.add({ productId: "a", quantity: 1, unitAmount: 500 });
    handle!.openCart();
    await settle();
    const drawer = document.querySelector("g-cart-drawer")!;
    const inc = drawer.querySelector('[data-focus-key="inc:a::"]') as HTMLButtonElement;
    inc.focus();
    inc.click();
    await settle();
    expect(commerce.cart.findLine("a")?.quantity).toBe(2);
    expect(document.activeElement?.getAttribute("data-focus-key")).toBe("inc:a::");
    (drawer.querySelector('[data-focus-key="rm:a::"]') as HTMLButtonElement).click();
    await settle();
    expect(commerce.cart.isEmpty()).toBe(true);
    expect(drawer.textContent).toContain("Your cart is empty.");
    expect(drawer.querySelector(".g-cart-empty a")?.getAttribute("href")).toBe("/shop");
  });

  it("applies and rejects discount codes inline", async () => {
    setup(
      api({
        "/cart/validate": (req) => {
          const code = req.body.discount_code as string | undefined;
          if (code === "BAD") return { status: 400, body: { message: "This discount code is invalid." } };
          const lines = [serverLine("a", 500, 1)];
          return { body: validateResponse(lines, code ? { discount_code: code, discount_amount: 50, total_amount: 450 } : {}) };
        },
      })
    );
    await commerce.cart.add({ productId: "a", unitAmount: 500 });
    handle!.openCart();
    await settle();
    const drawer = document.querySelector("g-cart-drawer")!;
    const input = drawer.querySelector<HTMLInputElement>('[data-focus-key="discount-input"]')!;
    input.value = "bad";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(drawer.textContent).toContain("This discount code is invalid.");
    const again = drawer.querySelector<HTMLInputElement>('[data-focus-key="discount-input"]')!;
    again.value = "good";
    again.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(drawer.querySelector(".g-discount-applied")?.textContent).toContain("GOOD");
    expect(drawer.querySelector(".g-row-total")?.textContent).toContain("$4.50");
  });
});

describe("data attributes", () => {
  it("adds from a button, shows feedback, updates counters and opens the cart", async () => {
    setup();
    document.body.innerHTML = `
      <button id="add" data-grigora-add data-product-id="a" data-price="500" data-title="A">Add</button>
      <a href="/cart" data-cart-open>Cart (<span data-cart-count>0</span>)</a>
      <span data-cart-subtotal></span>`;
    const button = document.getElementById("add") as HTMLButtonElement;
    button.click();
    expect(button.textContent).toBe("Adding…");
    await settle();
    expect(button.textContent).toBe("Added");
    expect(commerce.cart.count()).toBe(1);
    expect(document.querySelector("[data-cart-count]")?.textContent).toBe("1");
    expect(document.querySelector("[data-cart-subtotal]")?.textContent).toBe("$5.00");
    expect((document.querySelector("g-cart-drawer") as GCartDrawer).open).toBe(true);
  });

  it("upgrades mount points added later and reports missing ids", async () => {
    setup();
    const holder = document.createElement("div");
    holder.setAttribute("data-grigora-buy-box", "");
    holder.setAttribute("data-product-slug", "tee");
    document.body.appendChild(holder);
    await settle();
    expect(holder.querySelector("g-buy-box")?.getAttribute("product")).toBe("tee");
    const bad = document.createElement("button");
    bad.setAttribute("data-grigora-add", "");
    document.body.appendChild(bad);
    bad.click();
    await settle();
    expect(document.querySelector(".g-toast")?.textContent).toContain("data-product-id");
  });
});

describe("buy box", () => {
  it("renders options, blocks sold-out variants and adds the chosen one", async () => {
    setup();
    const box = document.createElement("g-buy-box") as GBuyBox;
    box.setAttribute("product", "tee");
    box.setAttribute("buy-now", "off");
    document.body.appendChild(box);
    await settle();
    expect(box.querySelector(".g-price-now")?.textContent).toBe("$15.00");
    expect(box.querySelector(".g-price-was")?.textContent).toBe("$20.00");
    const chips = Array.from(box.querySelectorAll<HTMLButtonElement>(".g-chip"));
    expect(chips.map((c) => c.textContent)).toEqual(["S", "M"]);
    expect(chips[1].hasAttribute("data-unavailable")).toBe(true);
    const add = box.querySelector<HTMLButtonElement>("[data-buybox-add]")!;
    expect(add.disabled).toBe(true);
    chips[0].click();
    await settle();
    expect(box.querySelector(".g-stock")?.textContent).toBe("Only 3 left");
    const addNow = box.querySelector<HTMLButtonElement>("[data-buybox-add]")!;
    expect(addNow.disabled).toBe(false);
    addNow.click();
    await settle();
    expect(commerce.cart.findLine("tee", "s")?.quantity).toBe(1);
    expect(box.textContent).toContain("1 in cart");
  });

  it("buy now adds and opens the checkout dialog", async () => {
    setup();
    const box = document.createElement("g-buy-box") as GBuyBox;
    box.setAttribute("product", "a");
    document.body.appendChild(box);
    await settle();
    box.querySelector<HTMLButtonElement>("[data-buybox-buy]")!.click();
    await settle();
    expect(commerce.cart.findLine("a")).not.toBeNull();
    expect(document.querySelector(".g-dialog-root g-checkout")).not.toBeNull();
  });
});

function fill(root: Element, scope: "billing" | "shipping", values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    const control = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${scope}.${key}"]`)!;
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

describe("checkout", () => {
  it("validates the address, quotes shipping and redirects for a hosted store", async () => {
    setup(api({ "/storefront/p1/settings": () => ({ body: { store: { ...STORE, checkout: { ...STORE.checkout, mode: "hosted", embedded_supported: false } } } }) }));
    await commerce.cart.add({ productId: "b", unitAmount: 700 });
    const checkout = document.createElement("g-checkout") as GCheckout;
    document.body.appendChild(checkout);
    await settle(10);
    const pay = checkout.querySelector<HTMLButtonElement>("[data-pay]")!;
    expect(pay.textContent).toContain("Continue to Stripe");
    expect(checkout.querySelector(".g-summary-title")?.textContent).toBe("Product b");
    pay.click();
    await settle();
    expect(checkout.querySelector(".g-alert")?.textContent).toContain("Contact");
    expect(checkout.querySelector('[name="billing.email"]')?.getAttribute("aria-invalid")).toBe("true");
    expect(calls.filter((c) => c.path === "/checkout/session")).toHaveLength(0);

    fill(checkout, "billing", BILLING);
    await settle(30);
    const rates = checkout.querySelectorAll<HTMLInputElement>('input[name="g-shipping-rate"]');
    expect(rates).toHaveLength(2);
    expect(checkout.querySelector(".g-checkout-summary")?.textContent).toContain("$5.00");
    rates[1].click();
    rates[1].dispatchEvent(new Event("change", { bubbles: true }));
    await settle(30);
    const lastQuote = calls.filter((c) => c.path === "/cart/validate").pop()!;
    expect(lastQuote.body.shipping_rate_id).toBe("exp");
    expect(lastQuote.body.billing_address).toMatchObject({ country: "US", postal_code: "94105" });

    checkout.querySelector<HTMLButtonElement>("[data-pay]")!.click();
    await settle(10);
    const session = calls.find((c) => c.path === "/checkout/session")!;
    expect(session.headers["idempotency-key"]).toBeTruthy();
    expect(session.body).toMatchObject({ shipping_rate_id: "exp", customer_email: "ada@example.com" });
    expect(navigate).toHaveBeenCalledWith("https://checkout.stripe.com/s/1");
  });

  it("mounts an embedded adapter, pays, confirms and lands on the success page", async () => {
    setup();
    const mounted = vi.fn(async (ctx: PaymentAdapterContext) => {
      ctx.container!.appendChild(document.createElement("iframe"));
      ctx.onReady?.();
    });
    const fakeStripe: PaymentProviderAdapter = {
      id: "stripe",
      supportsEmbedded: true,
      mount: mounted,
      submit: async (ctx) => ctx.onComplete({ payment_intent_id: "pi_done" }),
      destroy: vi.fn(),
    };
    commerce.providers.register(fakeStripe);
    await commerce.cart.add({ productId: "a", unitAmount: 500 });
    const checkout = document.createElement("g-checkout") as GCheckout;
    document.body.appendChild(checkout);
    await settle(10);
    fill(checkout, "billing", BILLING);
    await settle(30);
    const pay = checkout.querySelector<HTMLButtonElement>("[data-pay]")!;
    expect(pay.textContent).toContain("Continue to payment");
    pay.click();
    await settle(10);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(checkout.querySelector("[data-payment-mount] iframe")).not.toBeNull();
    expect(checkout.querySelector("[data-pay]")?.textContent).toContain("Pay $5.00");
    expect(checkout.querySelector(".g-step[data-active]")?.textContent).toContain("Payment");

    checkout.querySelector<HTMLButtonElement>("[data-pay]")!.click();
    await settle(10);
    const confirm = calls.find((c) => c.path === "/checkout/embedded/confirm")!;
    expect(confirm.body).toMatchObject({ provider: "stripe", order_id: "ord_e", payment_intent_id: "pi_done" });
    expect(navigate).toHaveBeenCalledTimes(1);
    const target = new URL(navigate.mock.calls[0][0] as string);
    expect(target.searchParams.get("order_id")).toBe("ord_e");
    expect(target.searchParams.get("lookup_token")).toBe("tok_".padEnd(24, "e"));
  });

  it("cancels a prepared payment when the shopper edits the order", async () => {
    setup();
    commerce.providers.register({ id: "stripe", supportsEmbedded: true, mount: async () => {}, submit: async () => {}, destroy: () => {} });
    await commerce.cart.add({ productId: "a", unitAmount: 500 });
    const checkout = document.createElement("g-checkout") as GCheckout;
    document.body.appendChild(checkout);
    await settle(10);
    fill(checkout, "billing", BILLING);
    await settle(30);
    checkout.querySelector<HTMLButtonElement>("[data-pay]")!.click();
    await settle(10);
    expect(commerce.checkout.current()?.orderId).toBe("ord_e");
    fill(checkout, "billing", { line1: "2 Other St" });
    await settle(10);
    const cancel = calls.find((c) => c.path === "/checkout/cancel")!;
    expect(cancel.body).toMatchObject({ order_id: "ord_e", token: "tok_".padEnd(24, "e") });
    expect(checkout.querySelector("[data-pay]")?.textContent).toContain("Continue to payment");
    expect(checkout.querySelector(".g-alert")?.textContent).toContain("Your order changed");
  });

  it("falls back to hosted when the embedded adapter cannot load", async () => {
    setup();
    commerce.providers.register({
      id: "stripe",
      supportsEmbedded: true,
      loadScript: async () => {
        throw new Error("blocked");
      },
      mount: async () => {},
      submit: async () => {},
      destroy: () => {},
    });
    await commerce.cart.add({ productId: "a", unitAmount: 500 });
    const checkout = document.createElement("g-checkout") as GCheckout;
    document.body.appendChild(checkout);
    await settle(10);
    fill(checkout, "billing", BILLING);
    await settle(30);
    checkout.querySelector<HTMLButtonElement>("[data-pay]")!.click();
    await settle(10);
    expect(calls.some((c) => c.path === "/checkout/embedded")).toBe(true);
    expect(calls.some((c) => c.path === "/checkout/cancel")).toBe(true);
    expect(calls.some((c) => c.path === "/checkout/session")).toBe(true);
    expect(navigate).toHaveBeenCalledWith("https://checkout.stripe.com/s/1");
  });

  it("shows the order status instead of the form when returning from payment", async () => {
    window.history.replaceState({}, "", `/checkout?order_id=ord_1&lookup_token=${"tok_".padEnd(24, "r")}`);
    setup();
    resetReturn(commerce);
    const checkout = document.createElement("g-checkout") as GCheckout;
    document.body.appendChild(checkout);
    await settle(10);
    const status = checkout.querySelector("g-order-status");
    expect(status).not.toBeNull();
    expect(status?.getAttribute("data-state")).toBe("paid");
  });
});

describe("order status", () => {
  it("verifies a paid order, clears the cart and shows the summary", async () => {
    setup();
    await commerce.cart.add({ productId: "a", unitAmount: 500 });
    const paid = vi.fn();
    commerce.on("order:paid", paid);
    const status = document.createElement("g-order-status") as GOrderStatus;
    status.setAttribute("order-id", "ord_1");
    status.setAttribute("lookup-token", "tok_".padEnd(24, "p"));
    document.body.appendChild(status);
    await settle(10);
    expect(status.getAttribute("data-state")).toBe("paid");
    expect(status.textContent).toContain("ORD_1");
    expect(status.textContent).toContain("1 × Product a");
    expect(status.querySelector('a[href="https://inv/1"]')).not.toBeNull();
    expect(commerce.cart.isEmpty()).toBe(true);
    expect(paid).toHaveBeenCalledTimes(1);
  });

  it("keeps the cart while pending and offers to check again; reports a bad link", async () => {
    setup();
    await commerce.cart.add({ productId: "a", unitAmount: 500 });
    const status = document.createElement("g-order-status") as GOrderStatus;
    status.setAttribute("order-id", "ord_pending");
    status.setAttribute("lookup-token", "tok_".padEnd(24, "p"));
    status.setAttribute("poll", "off");
    document.body.appendChild(status);
    await settle(10);
    expect(status.getAttribute("data-state")).toBe("pending");
    expect(status.textContent).toContain("Check again");
    expect(commerce.cart.isEmpty()).toBe(false);

    const bad = document.createElement("g-order-status") as GOrderStatus;
    bad.setAttribute("order-id", "ord_bad");
    bad.setAttribute("lookup-token", "tok_".padEnd(24, "b"));
    document.body.appendChild(bad);
    await settle(10);
    expect(bad.getAttribute("data-state")).toBe("error");
  });

  it("opens a status dialog on any page that carries return parameters", async () => {
    window.history.replaceState({}, "", `/shop?order_id=ord_1&lookup_token=${"tok_".padEnd(24, "d")}`);
    setup();
    await settle(10);
    expect(document.querySelector(".g-dialog-root g-order-status")?.getAttribute("data-state")).toBe("paid");
  });
});

describe("elements that exist before the SDK loads", () => {
  it("render once installUI runs, instead of keeping their placeholder", async () => {
    // The real page: <g-checkout> and <g-buy-box> are parsed (and, the tag
    // being already defined from earlier tests, upgraded) before installUI.
    document.body.innerHTML = `
      <g-checkout><p id="placeholder">Loading checkout…</p></g-checkout>
      <g-buy-box product="a"><p>Loading…</p></g-buy-box>
      <g-cart-badge show-zero></g-cart-badge>`;
    const checkout = document.querySelector("g-checkout") as GCheckout;
    expect(checkout.querySelector("#placeholder")).not.toBeNull();
    setup();
    await settle(10);
    expect(checkout.querySelector("#placeholder")).toBeNull();
    expect(checkout.querySelector("[data-pay]")).not.toBeNull();
    expect(document.querySelector("g-buy-box [data-buybox-add]")).not.toBeNull();
    expect(document.querySelector("g-cart-badge")?.textContent).toBe("0");
  });
});
