import { describe, expect, it, vi } from "vitest";
import type { PaymentAdapterContext } from "@grigora/commerce-core";
import { createRazorpayAdapter, type RazorpayConstructor } from "./index";

function context(): PaymentAdapterContext & { onComplete: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn>; onError: ReturnType<typeof vi.fn> } {
  return {
    commerce: { projectId: "p1", formatCurrency: (amount: number) => `₹${(amount / 100).toFixed(2)}`, store: { current: () => ({ storeName: "Chai Co", checkout: { razorpayKeyId: "rzp_test_store" } }) } } as unknown as PaymentAdapterContext["commerce"],
    session: { mode: "embedded", provider: "razorpay", orderId: "01HABCDEFGHJKLMNOPQRSTUV", lookupToken: "tok", checkoutUrl: "", cancelUrl: "", reservationExpiresAt: 0, amount: 49900, currency: "INR", totals: null, order: null, clientData: { razorpay_order_id: "order_x", key_id: "rzp_test_1", amount: 49900, currency: "INR", store_name: "Chai Co" }, raw: {} },
    container: null,
    billing: { name: "Ada", email: "ada@example.com", phone: "9876543210", line1: "1 St", line2: "", city: "Pune", state: "MH", postalCode: "411001", country: "IN", taxId: "" },
    shipping: null,
    returnUrl: "https://shop.test/thanks",
    theme: { accent: "#0a0a0a", font: "inherit" },
    onComplete: vi.fn(),
    onCancel: vi.fn(),
    onError: vi.fn(),
  };
}

describe("Razorpay adapter", () => {
  it("opens the overlay with the server order and relays the signed result", async () => {
    let captured: Record<string, unknown> = {};
    const open = vi.fn();
    const on = vi.fn();
    const ctor = vi.fn(function (this: unknown, options: Record<string, unknown>) {
      captured = options;
      return { open, on };
    }) as unknown as RazorpayConstructor;
    const adapter = createRazorpayAdapter({ loader: async () => ctor });
    const ctx = context();
    await adapter.mount(ctx);
    await adapter.submit(ctx);
    expect(open).toHaveBeenCalledTimes(1);
    expect(captured).toMatchObject({ key: "rzp_test_1", amount: 49900, currency: "INR", order_id: "order_x", name: "Chai Co", theme: { color: "#0a0a0a" }, notes: { project_id: "p1", order_id: ctx.session.orderId } });
    expect((captured.prefill as { contact: string }).contact).toBe("9876543210");
    expect(captured.description).toBe("Order KLMNOPQRSTUV".slice(0, 6) + "MNOPQRSTUV");
    (captured.handler as (r: unknown) => void)({ razorpay_order_id: "order_x", razorpay_payment_id: "pay_1", razorpay_signature: "sig" });
    expect(ctx.onComplete).toHaveBeenCalledWith({ razorpay_order_id: "order_x", razorpay_payment_id: "pay_1", razorpay_signature: "sig", customer_email: "ada@example.com", customer_name: "Ada" });
    (captured.modal as { ondismiss: () => void }).ondismiss();
    expect(ctx.onCancel).not.toHaveBeenCalled();
    expect(adapter.submitLabel?.(ctx)).toBe("Pay ₹499.00");
  });

  it("reports a dismissed overlay as a cancel and payment.failed as an error", async () => {
    let captured: Record<string, unknown> = {};
    let failHandler: ((r: unknown) => void) | null = null;
    const ctor = vi.fn(function (this: unknown, options: Record<string, unknown>) {
      captured = options;
      return { open: vi.fn(), on: (_event: string, handler: (r: unknown) => void) => { failHandler = handler; } };
    }) as unknown as RazorpayConstructor;
    const adapter = createRazorpayAdapter({ loader: async () => ctor });
    const ctx = context();
    await adapter.submit(ctx);
    (captured.modal as { ondismiss: () => void }).ondismiss();
    expect(ctx.onCancel).toHaveBeenCalledTimes(1);
    failHandler!({ error: { description: "Card declined", code: "BAD_REQUEST_ERROR" } });
    expect(ctx.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Card declined" }));
  });

  it("refuses a session without an order id", async () => {
    const adapter = createRazorpayAdapter({ loader: async () => vi.fn() as unknown as RazorpayConstructor });
    const ctx = context();
    ctx.session = { ...ctx.session, clientData: {} };
    await expect(adapter.submit(ctx)).rejects.toMatchObject({ code: "provider_error" });
  });
});
