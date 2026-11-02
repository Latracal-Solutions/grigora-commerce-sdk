import { describe, expect, it, vi } from "vitest";
import type { PaymentAdapterContext } from "@grigora/commerce-core";
import { createPaystackAdapter, type PaystackCallbacks, type PaystackPopConstructor } from "./index";

function context(): PaymentAdapterContext & { onComplete: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn>; onError: ReturnType<typeof vi.fn> } {
  return {
    commerce: { projectId: "p1", formatCurrency: (amount: number) => `₦${(amount / 100).toFixed(2)}`, store: { current: () => ({ storeName: "Lagos Beans", checkout: { paystackPublicKey: "pk_test_store" } }) } } as unknown as PaymentAdapterContext["commerce"],
    session: { mode: "embedded", provider: "paystack", orderId: "01habcdefghjklmnopqrstuv", lookupToken: "tok", checkoutUrl: "", cancelUrl: "", reservationExpiresAt: 0, amount: 500000, currency: "NGN", totals: null, order: null, clientData: { access_code: "acc_1", paystack_reference: "grg-01habcdefghjklmnopqrstuv", public_key: "pk_test_store", amount: 500000, currency: "NGN" }, raw: {} },
    container: null,
    billing: { name: "Ada", email: "ada@example.com", phone: "08012345678", line1: "1 St", line2: "", city: "Lagos", state: "LA", postalCode: "100001", country: "NG", taxId: "" },
    shipping: null,
    returnUrl: "https://shop.test/thanks",
    theme: { accent: "#0a0a0a", font: "inherit" },
    onComplete: vi.fn(),
    onCancel: vi.fn(),
    onError: vi.fn(),
  };
}

function popup() {
  const calls: Array<{ accessCode: string; callbacks: PaystackCallbacks }> = [];
  const ctor = vi.fn(function (this: unknown) {
    return { resumeTransaction: (accessCode: string, callbacks: PaystackCallbacks) => calls.push({ accessCode, callbacks }) };
  }) as unknown as PaystackPopConstructor;
  return { calls, ctor };
}

describe("Paystack adapter", () => {
  it("resumes the server transaction and relays its reference", async () => {
    const { calls, ctor } = popup();
    const adapter = createPaystackAdapter({ loader: async () => ctor });
    const ctx = context();
    await adapter.mount(ctx);
    await adapter.submit(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0].accessCode).toBe("acc_1");
    calls[0].callbacks.onSuccess?.({ reference: "grg-01habcdefghjklmnopqrstuv", status: "success" });
    expect(ctx.onComplete).toHaveBeenCalledWith({ paystack_reference: "grg-01habcdefghjklmnopqrstuv", lookup_token: "tok", customer_email: "ada@example.com", customer_name: "Ada" });
    calls[0].callbacks.onCancel?.();
    expect(ctx.onCancel).not.toHaveBeenCalled();
    expect(adapter.submitLabel?.(ctx)).toBe("Pay ₦5000.00");
  });

  it("reports a closed popup as a cancel and a load failure as an error", async () => {
    const { calls, ctor } = popup();
    const adapter = createPaystackAdapter({ loader: async () => ctor });
    const ctx = context();
    await adapter.submit(ctx);
    calls[0].callbacks.onCancel?.();
    expect(ctx.onCancel).toHaveBeenCalledTimes(1);
    calls[0].callbacks.onError?.({ message: "Could not load checkout" });
    expect(ctx.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Could not load checkout" }));
  });

  it("refuses a session without a transaction", async () => {
    const { ctor } = popup();
    const adapter = createPaystackAdapter({ loader: async () => ctor });
    const ctx = context();
    ctx.session = { ...ctx.session, clientData: {} };
    await expect(adapter.submit(ctx)).rejects.toMatchObject({ code: "provider_error" });
  });
});
