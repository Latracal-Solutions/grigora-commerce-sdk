import { GrigoraError, loadExternalScript, type CheckoutSession, type PaymentAdapterContext, type PaymentProviderAdapter } from "@grigora/commerce-core";

/*
  Paddle Billing adapter.

  The Grigora API only offers Paddle as a hosted checkout: /checkout/session
  (and /checkout/create) creates a Paddle transaction and returns its id
  (`checkout_id`), the store's client-side token, the environment and the
  display mode the merchant picked. A Paddle transaction has no payment page
  of its own: its checkout URL is the page the shopper came from with
  `?_ptxn=` added, and that page has to open Paddle.js. So this adapter opens
  Paddle on the checkout page itself:

  - overlay: `submit` opens Paddle's overlay over the page;
  - inline:  `mount` embeds Paddle's form in the payment container;
  - hosted:  not handled here. The SDK follows the transaction's checkout URL
             (an order page), and `resume` there forwards to the
             Paddle-hosted checkout the merchant created.

  `resume` also covers a shopper who reaches an order page with an unpaid
  Paddle transaction (single-product checkout, Paddle.js blocked on the
  checkout page, or coming back to finish paying).

  Paddle's `checkout.completed` is only a hint: the signed webhook settles the
  order, which is why `settlesByWebhook` is set and nothing is confirmed
  from the browser.
*/

export interface PaddleCheckoutEvent {
  name?: string;
  data?: Record<string, unknown>;
}

export interface PaddleGlobal {
  Environment: { set(environment: string): void };
  Initialize(options: { token: string; eventCallback?: (event: PaddleCheckoutEvent) => void }): void;
  Checkout: { open(options: Record<string, unknown>): void; close(): void };
}

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

export interface PaddleAdapterOptions {
  /** Default https://cdn.paddle.com/paddle/v2/paddle.js */
  scriptSrc?: string;
  /** Merged into Paddle Checkout `settings` last (e.g. `theme`, `locale`). */
  settings?: Record<string, unknown>;
  /** Initial height of the inline frame in px. Default 450. */
  inlineHeight?: number;
  /** Test seam: supply the Paddle global instead of loading the script. */
  loader?: () => Promise<PaddleGlobal>;
}

export const PADDLE_SCRIPT = "https://cdn.paddle.com/paddle/v2/paddle.js";

const TRANSACTION_PATTERN = /^txn_[A-Za-z0-9]{8,64}$/;
const MODES = ["overlay", "inline", "hosted"] as const;
type PaddleMode = (typeof MODES)[number];

interface PaddleSessionConfig {
  mode: PaddleMode;
  token: string;
  environment: "sandbox" | "production";
  transactionId: string;
  hostedUrl: string;
}

/** Read what the API returned for a Paddle checkout. Mirrors the API's paddleCheckoutResponse. */
export function paddleSessionConfig(session: Pick<CheckoutSession, "provider" | "clientData">): PaddleSessionConfig | null {
  if (String(session.provider) !== "paddle") return null;
  const data = session.clientData || {};
  const rawMode = String(data.paddle_display_mode || "").trim().toLowerCase();
  const mode: PaddleMode = (MODES as readonly string[]).includes(rawMode) ? (rawMode as PaddleMode) : "overlay";
  const transactionId = String(data.checkout_id || "").trim();
  if (!TRANSACTION_PATTERN.test(transactionId)) return null;
  return {
    mode,
    token: String(data.client_token || "").trim(),
    environment: String(data.environment || "") === "sandbox" ? "sandbox" : "production",
    transactionId,
    hostedUrl: paddleHostedCheckoutUrl(String(data.paddle_hosted_url || "")),
  };
}

/**
 * Only a Paddle-hosted checkout link (https://[sandbox-]pay.paddle.io/hsc_…
 * carrying the transaction) is followed, so tampered session data cannot turn
 * checkout into an open redirect. Mirrors the API's normalizePaddleHostedCheckoutUrl.
 */
export function paddleHostedCheckoutUrl(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== "https:" ||
      !(host === "paddle.io" || host.endsWith(".paddle.io")) ||
      !/^\/(?:checkout\/)?hsc_[A-Za-z0-9_]+\/?$/.test(parsed.pathname) ||
      !TRANSACTION_PATTERN.test(parsed.searchParams.get("transaction_id") || "")
    ) {
      return "";
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

// Paddle.js can only be initialised once per page, with one event callback.
// Every adapter instance shares it and points the callback at whichever
// checkout is currently open.
let initializedWith = "";
let activeHandler: ((event: PaddleCheckoutEvent) => void) | null = null;

/** Test seam: forget the page-level Paddle.js initialisation. */
export function resetPaddle(): void {
  initializedWith = "";
  activeHandler = null;
}

/**
 * Paddle.js opens any `_ptxn` it finds in the address bar as soon as it is
 * initialised. The SDK decides when to open checkout (only while the order is
 * unpaid), so the parameter is renamed to `paddle_txn` first. The core reads both.
 */
function renameTransactionParam(): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    const txn = url.searchParams.get("_ptxn");
    if (!txn) return;
    url.searchParams.delete("_ptxn");
    if (!url.searchParams.get("paddle_txn")) url.searchParams.set("paddle_txn", txn);
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // leave the address bar alone
  }
}

export function createPaddleAdapter(options: PaddleAdapterOptions = {}): PaymentProviderAdapter {
  let open = false;
  let completed = false;
  let frame: HTMLElement | null = null;
  let paddle: PaddleGlobal | null = null;

  const resolvePaddle = async (): Promise<PaddleGlobal> => {
    if (options.loader) return options.loader();
    if (typeof window === "undefined") throw new GrigoraError("Paddle needs a browser.", { code: "provider_error" });
    if (!window.Paddle?.Checkout) await loadExternalScript(options.scriptSrc || PADDLE_SCRIPT);
    if (!window.Paddle?.Checkout) throw new GrigoraError("Paddle checkout did not load.", { code: "provider_error" });
    return window.Paddle;
  };

  const initialize = async (config: PaddleSessionConfig): Promise<PaddleGlobal> => {
    if (!config.token) throw new GrigoraError("Paddle session is missing its client-side token.", { code: "provider_error" });
    const Paddle = await resolvePaddle();
    paddle = Paddle;
    const key = `${config.environment}:${config.token}`;
    if (!initializedWith) {
      renameTransactionParam();
      if (config.environment === "sandbox") Paddle.Environment.set("sandbox");
      Paddle.Initialize({ token: config.token, eventCallback: (event) => activeHandler?.(event) });
      initializedWith = key;
    } else if (initializedWith !== key) {
      throw new GrigoraError("Paddle is already set up on this page for another store. Reload the page to pay.", { code: "provider_error" });
    }
    return Paddle;
  };

  const removeFrame = () => {
    frame?.remove();
    frame = null;
  };

  const openCheckout = async (context: PaymentAdapterContext, config: PaddleSessionConfig, inline: boolean): Promise<void> => {
    const Paddle = await initialize(config);
    completed = false;
    const settings: Record<string, unknown> = {
      displayMode: inline ? "inline" : "overlay",
      variant: "one-page",
      allowLogout: false,
      showAddDiscounts: false,
    };
    if (inline) {
      if (!context.container) throw new GrigoraError("Paddle inline checkout needs a container to mount into.", { code: "provider_error" });
      removeFrame();
      // Paddle finds its inline frame target by class name.
      const target = `g-paddle-frame-${Math.random().toString(36).slice(2, 10)}`;
      frame = document.createElement("div");
      frame.className = `g-paddle-frame ${target}`;
      context.container.appendChild(frame);
      Object.assign(settings, {
        frameTarget: target,
        frameInitialHeight: options.inlineHeight || 450,
        frameStyle: "width:100%;min-width:312px;background-color:transparent;border:none;",
      });
    }
    Object.assign(settings, options.settings || {});
    const checkoutOptions: Record<string, unknown> = { transactionId: config.transactionId, settings };
    const email = String(context.billing?.email || "").trim();
    if (email) {
      const customer: Record<string, unknown> = { email };
      if (context.billing.country) customer.address = { countryCode: context.billing.country, postalCode: context.billing.postalCode || undefined };
      checkoutOptions.customer = customer;
    }
    activeHandler = (event) => {
      switch (event?.name) {
        case "checkout.loaded":
          context.onReady?.();
          return;
        case "checkout.completed":
          completed = true;
          open = false;
          try {
            Paddle.Checkout.close();
          } catch {
            // already closed
          }
          context.onComplete({ paddle_transaction_id: config.transactionId });
          return;
        case "checkout.closed":
          open = false;
          if (!completed) context.onCancel();
          return;
        case "checkout.error":
          context.onError(new GrigoraError("Paddle could not open checkout. Try again or use another payment method.", { code: "provider_error", details: event.data }));
          return;
        default:
          // checkout.payment.failed: Paddle shows the error in its own form and lets the shopper retry.
          return;
      }
    };
    open = true;
    Paddle.Checkout.open(checkoutOptions);
  };

  const sessionConfig = (context: PaymentAdapterContext): PaddleSessionConfig => {
    const config = paddleSessionConfig(context.session);
    if (!config) throw new GrigoraError("Paddle session is missing its transaction.", { code: "provider_error" });
    return config;
  };

  return {
    id: "paddle",
    // The API never offers Paddle on /checkout/embedded; it is a hosted
    // session that this adapter opens on the page (see handlesHostedSession).
    supportsEmbedded: false,
    settlesByWebhook: true,

    handlesHostedSession(session: CheckoutSession) {
      const config = paddleSessionConfig(session);
      return Boolean(config && config.mode !== "hosted" && config.token);
    },

    async loadScript() {
      await resolvePaddle();
    },

    async mount(context: PaymentAdapterContext) {
      const config = sessionConfig(context);
      // Overlay opens on submit; inline is the form itself, so it opens now.
      if (config.mode === "inline") await openCheckout(context, config, true);
      else await initialize(config);
    },

    async submit(context: PaymentAdapterContext) {
      const config = sessionConfig(context);
      if (config.mode === "inline") {
        throw new GrigoraError("Enter your payment details in the Paddle form above to pay.", { code: "validation_error" });
      }
      await openCheckout(context, config, false);
    },

    async resume(context: PaymentAdapterContext) {
      const config = sessionConfig(context);
      if (config.mode === "hosted") {
        if (!config.hostedUrl) throw new GrigoraError("Paddle-hosted checkout link is missing.", { code: "provider_error" });
        // Paddle returns from a hosted checkout to one fixed address without
        // an order reference; the core finds this order again from that mark.
        context.commerce.checkout.awaitReturn(context.session.orderId);
        context.commerce.navigate(config.hostedUrl);
        return;
      }
      await openCheckout(context, config, config.mode === "inline" && Boolean(context.container));
    },

    destroy() {
      activeHandler = null;
      if (open) {
        open = false;
        try {
          paddle?.Checkout.close();
        } catch {
          // already closed
        }
      }
      removeFrame();
    },

    submitLabel(context) {
      if (paddleSessionConfig(context.session)?.mode === "inline") return "Complete payment above";
      return `Pay ${context.commerce.formatCurrency(context.session.amount, context.session.currency)}`;
    },
  };
}

/** Ready-made adapter with defaults. */
export const paddleAdapter: PaymentProviderAdapter = createPaddleAdapter();
