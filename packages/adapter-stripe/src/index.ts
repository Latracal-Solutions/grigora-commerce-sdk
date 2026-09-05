import { GrigoraError, loadExternalScript, type PaymentAdapterContext, type PaymentProviderAdapter } from "@grigora/commerce-core";

/*
  Stripe Payment Element adapter.

  The Grigora API creates a PaymentIntent for the cart (/checkout/embedded)
  and returns its client_secret plus the store's publishable key. This adapter
  mounts the Payment Element against that secret, confirms on submit with
  `redirect: "if_required"` (so cards stay on the page while redirect-based
  methods come back to `returnUrl`), and hands the PaymentIntent id to the SDK,
  which posts it to /checkout/embedded/confirm for server-side verification.
*/

export interface StripeElement {
  mount(target: HTMLElement | string): void;
  destroy(): void;
  on?(event: string, handler: (event?: unknown) => void): void;
}

export interface StripeElements {
  create(type: "payment", options?: Record<string, unknown>): StripeElement;
}

export interface StripeConfirmResult {
  error?: { message?: string; type?: string; code?: string };
  paymentIntent?: { id: string; status?: string };
}

export interface StripeInstance {
  elements(options: Record<string, unknown>): StripeElements;
  confirmPayment(options: Record<string, unknown>): Promise<StripeConfirmResult>;
}

export type StripeConstructor = (publishableKey: string, options?: Record<string, unknown>) => StripeInstance;

declare global {
  interface Window {
    Stripe?: StripeConstructor;
  }
}

export interface StripeAdapterOptions {
  /** Default https://js.stripe.com/v3/ */
  scriptSrc?: string;
  /** Merged into the Elements `appearance` option. */
  appearance?: Record<string, unknown>;
  layout?: "tabs" | "accordion" | "auto";
  /** Test seam: supply the Stripe constructor instead of loading the script. */
  loader?: () => Promise<StripeConstructor>;
}

export const STRIPE_SCRIPT = "https://js.stripe.com/v3/";

export function createStripeAdapter(options: StripeAdapterOptions = {}): PaymentProviderAdapter {
  let stripe: StripeInstance | null = null;
  let elements: StripeElements | null = null;
  let element: StripeElement | null = null;

  const resolveStripe = async (): Promise<StripeConstructor> => {
    if (options.loader) return options.loader();
    if (typeof window === "undefined") throw new GrigoraError("Stripe needs a browser.", { code: "provider_error" });
    if (!window.Stripe) await loadExternalScript(options.scriptSrc || STRIPE_SCRIPT);
    if (!window.Stripe) throw new GrigoraError("Stripe.js did not load.", { code: "provider_error" });
    return window.Stripe;
  };

  return {
    id: "stripe",
    supportsEmbedded: true,

    async loadScript() {
      await resolveStripe();
    },

    async mount(context: PaymentAdapterContext) {
      const data = context.session.clientData;
      const publishableKey = String(data.publishable_key || context.commerce.store.current()?.checkout.stripePublishableKey || "");
      const clientSecret = String(data.client_secret || "");
      if (!publishableKey || !clientSecret) {
        throw new GrigoraError("Stripe session is missing its client secret or publishable key.", { code: "provider_error" });
      }
      if (!context.container) throw new GrigoraError("Stripe needs a container to mount into.", { code: "provider_error" });
      const Stripe = await resolveStripe();
      stripe = Stripe(publishableKey);
      const variables: Record<string, unknown> = { colorPrimary: context.theme.accent, borderRadius: "8px" };
      if (context.theme.font && context.theme.font !== "inherit") variables.fontFamily = context.theme.font;
      elements = stripe.elements({
        clientSecret,
        appearance: { theme: "stripe", variables, ...(options.appearance || {}) },
      });
      const billing = context.billing;
      element = elements.create("payment", {
        layout: options.layout || "tabs",
        defaultValues: {
          billingDetails: {
            name: billing.name,
            email: billing.email,
            phone: billing.phone,
            address: {
              line1: billing.line1,
              line2: billing.line2,
              city: billing.city,
              state: billing.state,
              postal_code: billing.postalCode,
              country: billing.country,
            },
          },
        },
      });
      element.on?.("ready", () => context.onReady?.());
      element.on?.("loaderror", (event) => {
        const message = (event as { error?: { message?: string } })?.error?.message || "Stripe could not load the payment form.";
        context.onError(new GrigoraError(message, { code: "provider_error" }));
      });
      element.mount(context.container);
    },

    async submit(context: PaymentAdapterContext) {
      if (!stripe || !elements) throw new GrigoraError("Stripe is not mounted.", { code: "provider_error" });
      const billing = context.billing;
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: context.returnUrl,
          payment_method_data: {
            billing_details: {
              name: billing.name,
              email: billing.email,
              phone: billing.phone,
              address: {
                line1: billing.line1,
                line2: billing.line2,
                city: billing.city,
                state: billing.state,
                postal_code: billing.postalCode,
                country: billing.country,
              },
            },
          },
        },
        redirect: "if_required",
      });
      if (result.error) {
        const message = result.error.message || "Payment failed.";
        if (result.error.type === "validation_error") {
          // Stripe already shows the inline message; treat as a cancelled attempt.
          context.onCancel();
          return;
        }
        context.onError(new GrigoraError(message, { code: "payment_failed", details: result.error }));
        return;
      }
      const intent = result.paymentIntent;
      if (!intent?.id) {
        // A redirect-based method is navigating away; nothing more to do here.
        return;
      }
      context.onComplete({ payment_intent_id: intent.id });
    },

    destroy() {
      try {
        element?.destroy();
      } catch {
        // already gone
      }
      element = null;
      elements = null;
      stripe = null;
    },

    submitLabel(context) {
      return `Pay ${context.commerce.formatCurrency(context.session.amount, context.session.currency)}`;
    },
  };
}

/** Ready-made adapter with defaults. */
export const stripeAdapter: PaymentProviderAdapter = createStripeAdapter();
