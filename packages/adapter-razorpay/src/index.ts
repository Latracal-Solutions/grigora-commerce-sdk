import { GrigoraError, loadExternalScript, orderReference, type PaymentAdapterContext, type PaymentProviderAdapter } from "@grigora/commerce-core";

/*
  Razorpay Checkout adapter.

  The Grigora API creates a Razorpay Order for the cart (/checkout/embedded)
  and returns razorpay_order_id, the public key id and the amount. Razorpay's
  checkout.js opens as an overlay, so `mount` has nothing to draw; `submit`
  opens the overlay and its handler returns payment id + signature, which the
  SDK posts to /checkout/embedded/confirm where the signature is verified.
*/

export interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayInstance {
  open(): void;
  on?(event: "payment.failed", handler: (response: { error?: { description?: string; code?: string } }) => void): void;
}

export type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

export interface RazorpayAdapterOptions {
  /** Default https://checkout.razorpay.com/v1/checkout.js */
  scriptSrc?: string;
  /** Extra Razorpay options merged last (e.g. `image`, `config`). */
  options?: Record<string, unknown>;
  /** Test seam: supply the constructor instead of loading the script. */
  loader?: () => Promise<RazorpayConstructor>;
}

export const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

export function createRazorpayAdapter(options: RazorpayAdapterOptions = {}): PaymentProviderAdapter {
  const resolveRazorpay = async (): Promise<RazorpayConstructor> => {
    if (options.loader) return options.loader();
    if (typeof window === "undefined") throw new GrigoraError("Razorpay needs a browser.", { code: "provider_error" });
    if (!window.Razorpay) await loadExternalScript(options.scriptSrc || RAZORPAY_SCRIPT);
    if (!window.Razorpay) throw new GrigoraError("Razorpay checkout did not load.", { code: "provider_error" });
    return window.Razorpay;
  };

  return {
    id: "razorpay",
    supportsEmbedded: true,

    async loadScript() {
      await resolveRazorpay();
    },

    async mount() {
      // Overlay checkout: nothing to render in the page.
    },

    async submit(context: PaymentAdapterContext) {
      const data = context.session.clientData;
      const keyId = String(data.key_id || context.commerce.store.current()?.checkout.razorpayKeyId || "");
      const razorpayOrderId = String(data.razorpay_order_id || "");
      if (!keyId || !razorpayOrderId) throw new GrigoraError("Razorpay session is missing its order id or key.", { code: "provider_error" });
      const Razorpay = await resolveRazorpay();
      const billing = context.billing;
      const store = context.commerce.store.current();
      let settled = false;
      const instance = new Razorpay({
        key: keyId,
        amount: Number(data.amount) || context.session.amount,
        currency: String(data.currency || context.session.currency),
        order_id: razorpayOrderId,
        name: String(data.store_name || store?.storeName || "Store"),
        description: `Order ${orderReference(context.session.orderId)}`,
        prefill: { name: billing.name, email: billing.email, contact: billing.phone },
        notes: { project_id: context.commerce.projectId, order_id: context.session.orderId },
        theme: { color: context.theme.accent },
        retry: { enabled: true, max_count: 2 },
        handler: (response: RazorpaySuccess) => {
          settled = true;
          context.onComplete({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            customer_email: billing.email,
            customer_name: billing.name,
          });
        },
        modal: {
          ondismiss: () => {
            if (!settled) context.onCancel();
          },
          escape: true,
          confirm_close: false,
        },
        ...(options.options || {}),
      });
      instance.on?.("payment.failed", (response) => {
        const message = response?.error?.description || "Payment failed.";
        context.onError(new GrigoraError(message, { code: "payment_failed", details: response?.error }));
      });
      instance.open();
    },

    destroy() {
      // Razorpay closes its own overlay.
    },

    submitLabel(context) {
      return `Pay ${context.commerce.formatCurrency(context.session.amount, context.session.currency)}`;
    },
  };
}

export const razorpayAdapter: PaymentProviderAdapter = createRazorpayAdapter();
