import { describe, expect, it, vi } from "vitest";
import type { PaymentAdapterContext } from "@grigora/commerce-core";
import { createStripeAdapter, type StripeConstructor } from "./index";

function context(overrides: Partial<PaymentAdapterContext> = {}): PaymentAdapterContext {
  return {
    commerce: { formatCurrency: (amount: number) => `$${(amount / 100).toFixed(2)}`, store: { current: () => null } } as unknown as PaymentAdapterContext["commerce"],
    session: { mode: "embedded", provider: "stripe", orderId: "ord_1", lookupToken: "tok", checkoutUrl: "", cancelUrl: "", reservationExpiresAt: 0, amount: 2000, currency: "USD", totals: null, order: null, clientData: { client_secret: "pi_secret", publishable_key: "pk_test" }, raw: {} },
    container: document.createElement("div"),
    billing: { name: "Ada", email: "ada@example.com", phone: "1", line1: "1 St", line2: "", city: "SF", state: "CA", postalCode: "94105", country: "US", taxId: "" },
    shipping: null,
    returnUrl: "https://shop.test/thanks?order_id=ord_1",
    theme: { accent: "#123456", font: "Inter" },
    onComplete: vi.fn(),
    onCancel: vi.fn(),
    onError: vi.fn(),
    onReady: vi.fn(),
    ...overrides,
  };
}

function fakeStripe(confirm: () => Promise<{ error?: { message?: string; type?: string }; paymentIntent?: { id: string } }>) {
  const mount = vi.fn();
  const destroy = vi.fn();
  const create = vi.fn(() => ({ mount, destroy, on: vi.fn() }));
  const elements = vi.fn(() => ({ create }));
  const confirmPayment = vi.fn(confirm);
  const ctor: StripeConstructor = vi.fn(() => ({ elements, confirmPayment })) as unknown as StripeConstructor;
  return { ctor, mount, destroy, create, elements, confirmPayment };
}

describe("Stripe adapter", () => {
  it("mounts a Payment Element with the session secret and the theme, then confirms and reports the intent", async () => {
    const stripe = fakeStripe(async () => ({ paymentIntent: { id: "pi_ok" } }));
    const adapter = createStripeAdapter({ loader: async () => stripe.ctor });
    const ctx = context();
    await adapter.mount(ctx);
    expect(stripe.ctor).toHaveBeenCalledWith("pk_test");
    const elementsOptions = (stripe.elements as ReturnType<typeof vi.fn>).mock.calls[0][0] as { clientSecret: string; appearance: { variables: Record<string, string> } };
    expect(elementsOptions.clientSecret).toBe("pi_secret");
    expect(elementsOptions.appearance.variables.colorPrimary).toBe("#123456");
    expect(elementsOptions.appearance.variables.fontFamily).toBe("Inter");
    expect(stripe.mount).toHaveBeenCalledWith(ctx.container);
    expect(adapter.submitLabel?.(ctx)).toBe("Pay $20.00");

    await adapter.submit(ctx);
    const confirmArgs = (stripe.confirmPayment.mock.calls as unknown as unknown[][])[0][0] as { confirmParams: { return_url: string; payment_method_data: { billing_details: { email: string } } }; redirect: string };
    expect(confirmArgs.redirect).toBe("if_required");
    expect(confirmArgs.confirmParams.return_url).toBe(ctx.returnUrl);
    expect(confirmArgs.confirmParams.payment_method_data.billing_details.email).toBe("ada@example.com");
    expect(ctx.onComplete).toHaveBeenCalledWith({ payment_intent_id: "pi_ok" });
    adapter.destroy();
    expect(stripe.destroy).toHaveBeenCalled();
  });

  it("reports card errors through onError and validation errors as a cancel", async () => {
    const failing = fakeStripe(async () => ({ error: { message: "Your card was declined.", type: "card_error" } }));
    const adapter = createStripeAdapter({ loader: async () => failing.ctor });
    const ctx = context();
    await adapter.mount(ctx);
    await adapter.submit(ctx);
    expect(ctx.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Your card was declined.", code: "payment_failed" }));
    expect(ctx.onComplete).not.toHaveBeenCalled();

    const incomplete = fakeStripe(async () => ({ error: { message: "Incomplete", type: "validation_error" } }));
    const adapter2 = createStripeAdapter({ loader: async () => incomplete.ctor });
    const ctx2 = context();
    await adapter2.mount(ctx2);
    await adapter2.submit(ctx2);
    expect(ctx2.onCancel).toHaveBeenCalledTimes(1);
  });

  it("refuses to mount without a client secret and to submit before mounting", async () => {
    const stripe = fakeStripe(async () => ({}));
    const adapter = createStripeAdapter({ loader: async () => stripe.ctor });
    await expect(adapter.mount(context({ session: { ...context().session, clientData: {} } }))).rejects.toMatchObject({ code: "provider_error" });
    await expect(adapter.submit(context())).rejects.toMatchObject({ code: "provider_error" });
  });
});
