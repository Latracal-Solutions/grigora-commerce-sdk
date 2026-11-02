import { GrigoraError, loadExternalScript, type PaymentAdapterContext, type PaymentProviderAdapter } from "@grigora/commerce-core";

/*
  Paystack Popup adapter.

  The Grigora API initializes a Paystack transaction for the cart
  (/checkout/embedded) and returns its access_code and reference. Paystack's
  inline.js resumes that transaction as a popup, so `mount` has nothing to
  draw; `submit` opens the popup and its success callback returns the
  reference, which the SDK posts to /checkout/embedded/confirm. The API then
  asks Paystack whether the transaction was paid: nothing the popup reports is
  trusted on its own.
*/

export interface PaystackTransaction {
  reference?: string;
  trxref?: string;
  status?: string;
  message?: string;
}

export interface PaystackCallbacks {
  onSuccess?: (transaction: PaystackTransaction) => void;
  onCancel?: () => void;
  onLoad?: (response: unknown) => void;
  onError?: (error: { message?: string }) => void;
}

export interface PaystackPopInstance {
  resumeTransaction(accessCode: string, callbacks?: PaystackCallbacks): unknown;
}

export type PaystackPopConstructor = new () => PaystackPopInstance;

declare global {
  interface Window {
    PaystackPop?: PaystackPopConstructor;
  }
}

export interface PaystackAdapterOptions {
  /** Default https://js.paystack.co/v2/inline.js */
  scriptSrc?: string;
  /** Test seam: supply the constructor instead of loading the script. */
  loader?: () => Promise<PaystackPopConstructor>;
}

export const PAYSTACK_SCRIPT = "https://js.paystack.co/v2/inline.js";

export function createPaystackAdapter(options: PaystackAdapterOptions = {}): PaymentProviderAdapter {
  const resolvePaystack = async (): Promise<PaystackPopConstructor> => {
    if (options.loader) return options.loader();
    if (typeof window === "undefined") throw new GrigoraError("Paystack needs a browser.", { code: "provider_error" });
    if (!window.PaystackPop) await loadExternalScript(options.scriptSrc || PAYSTACK_SCRIPT);
    if (!window.PaystackPop) throw new GrigoraError("Paystack checkout did not load.", { code: "provider_error" });
    return window.PaystackPop;
  };

  return {
    id: "paystack",
    supportsEmbedded: true,

    async loadScript() {
      await resolvePaystack();
    },

    async mount() {
      // Popup checkout: nothing to render in the page.
    },

    async submit(context: PaymentAdapterContext) {
      const data = context.session.clientData;
      const accessCode = String(data.access_code || "");
      const reference = String(data.paystack_reference || "");
      if (!accessCode || !reference) throw new GrigoraError("Paystack session is missing its transaction.", { code: "provider_error" });
      const PaystackPop = await resolvePaystack();
      const billing = context.billing;
      let settled = false;
      new PaystackPop().resumeTransaction(accessCode, {
        onSuccess: (transaction) => {
          settled = true;
          context.onComplete({
            // The server binds the order to its own stored reference; this is
            // only echoed back so a mismatch can be refused.
            paystack_reference: String(transaction?.reference || transaction?.trxref || reference),
            // The reference is derived from the order id, so the API asks for
            // the buyer's lookup token before answering for the order.
            lookup_token: context.session.lookupToken,
            customer_email: billing.email,
            customer_name: billing.name,
          });
        },
        onCancel: () => {
          if (!settled) context.onCancel();
        },
        onError: (error) => {
          context.onError(new GrigoraError(error?.message || "Payment failed.", { code: "payment_failed", details: error }));
        },
      });
    },

    destroy() {
      // Paystack closes its own popup.
    },

    submitLabel(context) {
      return `Pay ${context.commerce.formatCurrency(context.session.amount, context.session.currency)}`;
    },
  };
}

export const paystackAdapter: PaymentProviderAdapter = createPaystackAdapter();
