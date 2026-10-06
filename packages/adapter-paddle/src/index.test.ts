import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaymentAdapterContext } from "@grigora/commerce-core";
import { createPaddleAdapter, paddleHostedCheckoutUrl, paddleSessionConfig, resetPaddle, type PaddleCheckoutEvent, type PaddleGlobal } from "./index";

const TXN = "txn_01habcdefghjkmnpqrstvwxyz";
const HOSTED = `https://sandbox-pay.paddle.io/hsc_01abc_def?transaction_id=${TXN}`;

function fakePaddle() {
  let callback: ((event: PaddleCheckoutEvent) => void) | undefined;
  const paddle = {
    Environment: { set: vi.fn() },
    Initialize: vi.fn((options: { token: string; eventCallback?: (event: PaddleCheckoutEvent) => void }) => {
      callback = options.eventCallback;
    }),
    Checkout: { open: vi.fn(), close: vi.fn() },
  };
  return { paddle: paddle as unknown as PaddleGlobal & typeof paddle, emit: (name: string) => callback?.({ name }) };
}

function context(clientData: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return {
    commerce: {
      projectId: "p1",
      formatCurrency: (amount: number) => `$${(amount / 100).toFixed(2)}`,
      checkout: { awaitReturn: vi.fn() },
      navigate: vi.fn(),
    } as unknown as PaymentAdapterContext["commerce"] & { checkout: { awaitReturn: ReturnType<typeof vi.fn> }; navigate: ReturnType<typeof vi.fn> },
    session: {
      mode: "hosted" as const,
      provider: "paddle",
      orderId: "01HABCDEFGHJKLMNOPQRSTUV",
      lookupToken: "tok_".padEnd(24, "t"),
      checkoutUrl: `https://shop.test/thanks?order_id=01HABCDEFGHJKLMNOPQRSTUV&_ptxn=${TXN}`,
      cancelUrl: "",
      reservationExpiresAt: 0,
      amount: 2500,
      currency: "USD",
      totals: null,
      order: null,
      clientData: { provider: "paddle", checkout_id: TXN, client_token: "test_abc", environment: "sandbox", paddle_display_mode: "overlay", paddle_hosted_url: "", ...clientData },
      raw: {},
    },
    container,
    billing: { name: "Ada", email: "ada@example.com", phone: "", line1: "1 St", line2: "", city: "SF", state: "CA", postalCode: "94105", country: "US", taxId: "" },
    shipping: null,
    returnUrl: "https://shop.test/thanks",
    theme: { accent: "#0a0a0a", font: "inherit" },
    onComplete: vi.fn(),
    onCancel: vi.fn(),
    onError: vi.fn(),
    onReady: vi.fn(),
  };
}

afterEach(() => {
  resetPaddle();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("Paddle adapter", () => {
  it("reads the API's Paddle session and only takes in-page modes with a token", () => {
    const adapter = createPaddleAdapter({ loader: async () => fakePaddle().paddle });
    const ctx = context();
    expect(paddleSessionConfig(ctx.session)).toMatchObject({ mode: "overlay", token: "test_abc", environment: "sandbox", transactionId: TXN });
    expect(adapter.handlesHostedSession?.(ctx.session)).toBe(true);
    expect(adapter.handlesHostedSession?.({ ...ctx.session, clientData: { ...ctx.session.clientData, paddle_display_mode: "hosted" } })).toBe(false);
    expect(adapter.handlesHostedSession?.({ ...ctx.session, clientData: { ...ctx.session.clientData, client_token: "" } })).toBe(false);
    expect(adapter.handlesHostedSession?.({ ...ctx.session, provider: "stripe" })).toBe(false);
    expect(adapter.handlesHostedSession?.({ ...ctx.session, clientData: { ...ctx.session.clientData, checkout_id: "cs_1" } })).toBe(false);
    expect(adapter.settlesByWebhook).toBe(true);
    expect(adapter.supportsEmbedded).toBe(false);
  });

  it("opens the overlay for the transaction and reports completion without confirming", async () => {
    window.history.replaceState({}, "", `/checkout?_ptxn=${TXN}`);
    const { paddle, emit } = fakePaddle();
    const adapter = createPaddleAdapter({ loader: async () => paddle });
    const ctx = context();
    await adapter.mount(ctx);
    expect(paddle.Checkout.open).not.toHaveBeenCalled();
    // Paddle.js would open `_ptxn` by itself on Initialize; it is renamed first.
    expect(new URL(window.location.href).searchParams.get("_ptxn")).toBeNull();
    expect(new URL(window.location.href).searchParams.get("paddle_txn")).toBe(TXN);
    await adapter.submit(ctx);
    expect(paddle.Environment.set).toHaveBeenCalledWith("sandbox");
    expect(paddle.Initialize).toHaveBeenCalledTimes(1);
    expect(paddle.Initialize.mock.calls[0][0]).toMatchObject({ token: "test_abc" });
    expect(paddle.Checkout.open).toHaveBeenCalledWith({
      transactionId: TXN,
      settings: { displayMode: "overlay", variant: "one-page", allowLogout: false, showAddDiscounts: false },
      customer: { email: "ada@example.com", address: { countryCode: "US", postalCode: "94105" } },
    });
    expect(adapter.submitLabel?.(ctx)).toBe("Pay $25.00");
    emit("checkout.completed");
    expect(ctx.onComplete).toHaveBeenCalledWith({ paddle_transaction_id: TXN });
    emit("checkout.closed");
    expect(ctx.onCancel).not.toHaveBeenCalled();
  });

  it("reports a closed overlay as a cancel and a checkout error as an error", async () => {
    const { paddle, emit } = fakePaddle();
    const adapter = createPaddleAdapter({ loader: async () => paddle });
    const ctx = context({ environment: "production", client_token: "live_abc" });
    await adapter.submit(ctx);
    expect(paddle.Environment.set).not.toHaveBeenCalled();
    emit("checkout.payment.failed");
    expect(ctx.onError).not.toHaveBeenCalled();
    emit("checkout.closed");
    expect(ctx.onCancel).toHaveBeenCalledTimes(1);
    await adapter.submit(ctx);
    emit("checkout.error");
    expect(ctx.onError).toHaveBeenCalledWith(expect.objectContaining({ code: "provider_error" }));
    expect(paddle.Initialize).toHaveBeenCalledTimes(1);
  });

  it("embeds the inline form in the payment container on mount", async () => {
    const { paddle, emit } = fakePaddle();
    const adapter = createPaddleAdapter({ loader: async () => paddle, inlineHeight: 520 });
    const ctx = context({ paddle_display_mode: "inline" });
    await adapter.mount(ctx);
    const frame = ctx.container.querySelector<HTMLElement>(".g-paddle-frame")!;
    expect(frame).not.toBeNull();
    const settings = paddle.Checkout.open.mock.calls[0][0].settings as Record<string, unknown>;
    expect(settings).toMatchObject({ displayMode: "inline", frameInitialHeight: 520 });
    expect(frame.classList.contains(String(settings.frameTarget))).toBe(true);
    expect(adapter.submitLabel?.(ctx)).toBe("Complete payment above");
    await expect(adapter.submit(ctx)).rejects.toMatchObject({ code: "validation_error" });
    emit("checkout.loaded");
    expect(ctx.onReady).toHaveBeenCalled();
    adapter.destroy();
    expect(ctx.container.querySelector(".g-paddle-frame")).toBeNull();
    expect(paddle.Checkout.close).toHaveBeenCalled();
  });

  it("refuses a second store's token on the same page", async () => {
    const { paddle } = fakePaddle();
    const adapter = createPaddleAdapter({ loader: async () => paddle });
    await adapter.submit(context());
    await expect(adapter.submit(context({ client_token: "test_other" }))).rejects.toMatchObject({ code: "provider_error" });
  });

  it("forwards hosted mode to the Paddle-hosted checkout and marks the return", async () => {
    const { paddle } = fakePaddle();
    const adapter = createPaddleAdapter({ loader: async () => paddle });
    const ctx = context({ paddle_display_mode: "hosted", client_token: "", paddle_hosted_url: HOSTED });
    await adapter.resume!(ctx);
    expect(ctx.commerce.checkout.awaitReturn).toHaveBeenCalledWith(ctx.session.orderId);
    expect(ctx.commerce.navigate).toHaveBeenCalledWith(HOSTED);
    expect(paddle.Initialize).not.toHaveBeenCalled();

    const tampered = context({ paddle_display_mode: "hosted", paddle_hosted_url: `https://evil.test/hsc_1?transaction_id=${TXN}` });
    await expect(adapter.resume!(tampered)).rejects.toMatchObject({ code: "provider_error" });
    expect(tampered.commerce.navigate).not.toHaveBeenCalled();
  });

  it("resumes overlay payment for an order page", async () => {
    const { paddle } = fakePaddle();
    const adapter = createPaddleAdapter({ loader: async () => paddle });
    const ctx = context();
    await adapter.resume!(ctx);
    expect(paddle.Checkout.open).toHaveBeenCalledWith(expect.objectContaining({ transactionId: TXN }));
  });

  it("only follows Paddle-hosted checkout links", () => {
    expect(paddleHostedCheckoutUrl(HOSTED)).toBe(HOSTED);
    expect(paddleHostedCheckoutUrl(`https://pay.paddle.io/checkout/hsc_01abc?transaction_id=${TXN}`)).toContain("pay.paddle.io");
    expect(paddleHostedCheckoutUrl("https://pay.paddle.io/hsc_01abc")).toBe("");
    expect(paddleHostedCheckoutUrl(`http://pay.paddle.io/hsc_01abc?transaction_id=${TXN}`)).toBe("");
    expect(paddleHostedCheckoutUrl(`https://paddle.io.evil.test/hsc_01abc?transaction_id=${TXN}`)).toBe("");
    expect(paddleHostedCheckoutUrl(`https://pay.paddle.io/other?transaction_id=${TXN}`)).toBe("");
  });
});
