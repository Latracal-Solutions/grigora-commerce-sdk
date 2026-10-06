import { mapTotals, type CartStore } from "./cart";
import type { CatalogClient } from "./catalog";
import type { ApiClient } from "./client";
import { normalizeCurrency, toMajor } from "./currency";
import { GrigoraError, isGrigoraError, toGrigoraError } from "./errors";
import type { Emitter } from "./events";
import { mapOrder } from "./orders";
import type {
  Address,
  CheckoutAPI,
  CheckoutInput,
  CheckoutMode,
  CheckoutReturn,
  CheckoutSession,
  CheckoutStartOptions,
  ConfirmInput,
  ConfirmResult,
  GrigoraEvents,
  PaymentPreference,
  RememberedCheckout,
  ResolvedConfig,
  SingleCheckoutInput,
  StoreSettings,
} from "./types";
import { readJson, writeJson } from "./storage";
import { absoluteUrl, clean, currentPageUrl, currentUrl, isBrowser, stableStringify, toInt, uuid, type Logger } from "./util";
import { addressErrorMessage, addressErrors, normalizeAddress, toApiAddress } from "./validation";

type Raw = Record<string, unknown>;

/** How long a remembered hosted checkout stays usable by a return page. */
const REMEMBER_MS = 24 * 60 * 60 * 1000;

/** Paddle Billing transaction ids, as Paddle puts them in `_ptxn`. */
const PROVIDER_TRANSACTION_PATTERN = /^txn_[A-Za-z0-9]{8,64}$/;

export interface CheckoutDeps {
  client: ApiClient;
  projectId: string;
  cart: CartStore;
  catalog: CatalogClient;
  emitter: Emitter<GrigoraEvents>;
  config: ResolvedConfig;
  clientId: () => string;
  log: Logger;
}

interface Attempt {
  key: string;
  fingerprint: string;
}

/**
 * Cart and single-product checkout against the Grigora API.
 *
 * Every checkout POST carries an Idempotency-Key and the persistent client id.
 * The key is reused while the request is byte-for-byte the same checkout
 * (same lines, addresses, rate, discount, mode), so a retried click or a
 * flaky network replays the pending order instead of creating a second one;
 * any change to the inputs mints a new key.
 */
export class CheckoutClient implements CheckoutAPI {
  private readonly deps: CheckoutDeps;
  private attempt: Attempt | null = null;
  private session: CheckoutSession | null = null;

  constructor(deps: CheckoutDeps) {
    this.deps = deps;
  }

  current(): CheckoutSession | null {
    return this.session;
  }

  reset(): void {
    this.attempt = null;
    this.session = null;
  }

  defaultSuccessUrl(): string {
    const configured = clean(this.deps.config.successUrl, 2000);
    return configured ? absoluteUrl(configured) : currentPageUrl();
  }

  defaultCancelUrl(): string {
    const configured = clean(this.deps.config.cancelUrl, 2000);
    return configured ? absoluteUrl(configured) : currentUrl();
  }

  resolveMode(store: StoreSettings, preference: PaymentPreference = this.deps.config.payment): CheckoutMode {
    const checkout = store.checkout;
    if (preference === "embedded") return checkout.embeddedSupported ? "embedded" : checkout.hostedSupported ? "hosted" : "unavailable";
    if (preference === "hosted") return checkout.hostedSupported ? "hosted" : checkout.embeddedSupported ? "embedded" : "unavailable";
    return checkout.mode;
  }

  quote(input: Partial<CheckoutInput>) {
    const billing = input.billingAddress ? normalizeAddress(input.billingAddress) : null;
    const shipping = input.sameAsBilling === false && input.shippingAddress ? normalizeAddress(input.shippingAddress) : billing;
    return this.deps.cart.validate({
      billingAddress: billing,
      shippingAddress: shipping,
      shippingRateId: input.shippingRateId,
      discountCode: input.discountCode === undefined ? undefined : input.discountCode,
    });
  }

  async start(input: CheckoutInput, options: CheckoutStartOptions = {}): Promise<CheckoutSession> {
    const store = await this.deps.catalog.loadStore();
    const mode = this.resolveMode(store, options.payment);
    if (mode === "unavailable") {
      throw new GrigoraError(store.checkout.message || "This store is not taking payments right now.", {
        code: "checkout_unavailable",
        details: store.checkout,
      });
    }
    return mode === "embedded" ? this.startEmbedded(input) : this.startHosted(input);
  }

  startHosted(input: CheckoutInput): Promise<CheckoutSession> {
    return this.startCart(input, false);
  }

  startEmbedded(input: CheckoutInput): Promise<CheckoutSession> {
    return this.startCart(input, true);
  }

  private async startCart(input: CheckoutInput, embedded: boolean): Promise<CheckoutSession> {
    const cart = this.deps.cart;
    if (cart.isEmpty()) throw new GrigoraError("Your cart is empty.", { code: "cart_empty" });

    const billing = normalizeAddress(input.billingAddress);
    const shipping = input.sameAsBilling === false && input.shippingAddress ? normalizeAddress(input.shippingAddress) : billing;
    const billingProblems = addressErrors(billing);
    if (billingProblems.length) {
      throw new GrigoraError(addressErrorMessage("Billing address", billingProblems), {
        code: "invalid_address",
        details: { field: billingProblems[0], scope: "billing", fields: billingProblems },
      });
    }
    if (cart.get().requiresShipping) {
      const shippingProblems = addressErrors(shipping);
      if (shippingProblems.length) {
        throw new GrigoraError(addressErrorMessage("Shipping address", shippingProblems), {
          code: "invalid_address",
          details: { field: shippingProblems[0], scope: "shipping", fields: shippingProblems },
        });
      }
    }

    const discount = input.discountCode === undefined ? cart.getDiscount() : clean(input.discountCode, 60).toUpperCase();
    const body: Raw = {
      project_id: this.deps.projectId,
      line_items: cart.toLineItems(),
      billing_address: toApiAddress(billing),
      shipping_address: toApiAddress(shipping),
      customer_email: billing.email,
      customer_name: billing.name,
      success_url: clean(input.successUrl, 2000) ? absoluteUrl(clean(input.successUrl, 2000)) : this.defaultSuccessUrl(),
      cancel_url: clean(input.cancelUrl, 2000) ? absoluteUrl(clean(input.cancelUrl, 2000)) : this.defaultCancelUrl(),
    };
    if (input.shippingRateId) body.shipping_rate_id = clean(input.shippingRateId, 80);
    if (discount) body.discount_code = discount;

    const attempt = this.attemptFor(stableStringify({ ...body, embedded }));
    body.checkout_client_id = this.deps.clientId();
    body.idempotency_key = attempt.key;

    try {
      const output = await this.deps.client.post<Raw>(embedded ? "/checkout/embedded" : "/checkout/session", body, {
        context: "checkout",
        idempotency: { key: attempt.key, clientId: body.checkout_client_id as string },
      });
      const session = toSession(output, embedded ? "embedded" : "hosted", this.deps.config.currency);
      this.session = session;
      this.remember(session);
      this.deps.emitter.emit("checkout:started", session);
      if (session.mode === "free") {
        this.attempt = null;
        this.deps.emitter.emit("checkout:completed", { orderId: session.orderId, lookupToken: session.lookupToken, order: session.order });
      }
      return session;
    } catch (raw) {
      const error = toGrigoraError(raw, { code: "checkout_failed" });
      // A replay collision means the same key is still being processed; keep it
      // so the next click replays. Anything else must mint a fresh key.
      if (error.code !== "checkout_in_progress") this.attempt = null;
      this.deps.emitter.emit("checkout:failed", error);
      throw error;
    }
  }

  async startSingle(input: SingleCheckoutInput): Promise<CheckoutSession> {
    const email = clean(input.customerEmail, 240).toLowerCase();
    if (!email) throw new GrigoraError("An email address is required to start checkout.", { code: "validation_error" });
    const productId = clean(input.productId, 80);
    const slug = clean(input.slug, 200);
    if (!productId && !slug) throw new GrigoraError("A product id or slug is required.", { code: "validation_error" });

    const body: Raw = {
      project_id: this.deps.projectId,
      customer_email: email,
      success_url: clean(input.successUrl, 2000) ? absoluteUrl(clean(input.successUrl, 2000)) : this.defaultSuccessUrl(),
      cancel_url: clean(input.cancelUrl, 2000) ? absoluteUrl(clean(input.cancelUrl, 2000)) : this.defaultCancelUrl(),
    };
    if (productId) body.product_id = productId;
    else body.slug = slug;
    if (input.variantId) body.variant_id = clean(input.variantId, 80);
    if (input.customerName) body.customer_name = clean(input.customerName, 160);
    if (input.discountCode) body.discount_code = clean(input.discountCode, 60).toUpperCase();
    if (input.provider) body.provider = clean(input.provider, 40);
    // The API reads pay-what-you-want amounts in major units and multiplies by 100.
    if (input.amount !== undefined && input.amount !== null) body.custom_amount = toMajor(toInt(input.amount, 0)).toFixed(2);

    const attempt = this.attemptFor(stableStringify({ ...body, single: true }));
    body.checkout_client_id = this.deps.clientId();
    body.idempotency_key = attempt.key;

    try {
      const output = await this.deps.client.post<Raw>("/checkout/create", body, {
        context: "checkout",
        idempotency: { key: attempt.key, clientId: body.checkout_client_id as string },
      });
      const session = toSession(output, "hosted", this.deps.config.currency);
      this.session = session;
      this.remember(session);
      this.deps.emitter.emit("checkout:started", session);
      if (session.mode === "free") {
        this.attempt = null;
        this.deps.emitter.emit("checkout:completed", { orderId: session.orderId, lookupToken: session.lookupToken, order: session.order });
      }
      return session;
    } catch (raw) {
      const error = toGrigoraError(raw, { code: "checkout_failed" });
      if (error.code !== "checkout_in_progress") this.attempt = null;
      this.deps.emitter.emit("checkout:failed", error);
      throw error;
    }
  }

  async confirm(input: ConfirmInput): Promise<ConfirmResult> {
    const orderId = clean(input.orderId, 80);
    if (!orderId) throw new GrigoraError("An order id is required to confirm payment.", { code: "validation_error" });
    try {
      const output = await this.deps.client.post<Raw>(
        "/checkout/embedded/confirm",
        { project_id: this.deps.projectId, provider: clean(input.provider, 40), order_id: orderId, ...input.payload },
        { context: "confirm" }
      );
      const order = output.order && typeof output.order === "object" ? mapOrder(output.order as Raw) : null;
      const result: ConfirmResult = { ok: output.ok !== false, orderId: clean(output.order_id, 80) || orderId, order };
      if (result.ok) {
        const lookupToken = this.session?.orderId === orderId ? this.session.lookupToken : "";
        this.attempt = null;
        this.deps.emitter.emit("checkout:completed", { orderId: result.orderId, lookupToken, order });
        if (order?.paymentState === "paid") this.deps.emitter.emit("order:paid", order);
      }
      return result;
    } catch (raw) {
      const error = toGrigoraError(raw, { code: "payment_failed" });
      this.deps.emitter.emit("checkout:failed", error);
      throw error;
    }
  }

  async cancel(target?: CheckoutSession | { orderId: string; lookupToken: string }): Promise<void> {
    const session = target || this.session;
    if (!session) return;
    const orderId = clean(session.orderId, 80);
    const token = clean(session.lookupToken, 200);
    if (this.session && this.session.orderId === orderId) this.session = null;
    this.attempt = null;
    if (!orderId || !token) return;
    try {
      await this.deps.client.post("/checkout/cancel", { project_id: this.deps.projectId, order_id: orderId, token }, { context: "checkout" });
      this.deps.emitter.emit("checkout:cancelled", { orderId });
    } catch (error) {
      // A reservation that cannot be released now expires on its own; never
      // block the shopper on this.
      this.deps.log("checkout cancel failed", error);
    }
  }

  parseReturn(url?: string): CheckoutReturn | null {
    const href = url || (isBrowser() ? window.location.href : "");
    if (!href) return null;
    let params: URLSearchParams;
    try {
      params = new URL(href, "https://grigora.co").searchParams;
    } catch {
      return null;
    }
    let orderId = clean(params.get("order_id"), 80);
    let lookupToken = clean(params.get("lookup_token"), 200);
    const paymentIntentId = clean(params.get("payment_intent"), 200);
    // Paddle puts the transaction to pay in `_ptxn`; the Paddle adapter
    // renames it to `paddle_txn` so Paddle.js does not open it on its own.
    let providerTransactionId = clean(params.get("_ptxn") || params.get("paddle_txn"), 80);
    if (!PROVIDER_TRANSACTION_PATTERN.test(providerTransactionId)) providerTransactionId = "";
    let recovered = false;
    if (!orderId && !lookupToken) {
      // A provider page that returns to one fixed address (Paddle-hosted
      // checkout) brings no order reference; use the checkout this browser
      // saved right before leaving for it.
      const remembered = this.remembered();
      if (!remembered || !remembered.awaitingReturn) return null;
      orderId = remembered.orderId;
      lookupToken = remembered.lookupToken;
      providerTransactionId = providerTransactionId || clean(remembered.clientData.checkout_id, 80);
      if (!PROVIDER_TRANSACTION_PATTERN.test(providerTransactionId)) providerTransactionId = "";
      recovered = true;
    }
    if (!orderId || !lookupToken) return null;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(orderId) || !/^[A-Za-z0-9_-]{20,200}$/.test(lookupToken)) return null;
    return { orderId, lookupToken, paymentIntentId, providerTransactionId, recovered, confirmed: null, error: null };
  }

  async handleReturn(url?: string): Promise<CheckoutReturn | null> {
    const parsed = this.parseReturn(url);
    if (!parsed) return null;
    // A recovered return is used once, so a later visit shows checkout again.
    if (parsed.recovered) this.updateRemembered({ awaitingReturn: false });
    if (!parsed.paymentIntentId) return parsed;
    try {
      const result = await this.confirm({
        provider: "stripe",
        orderId: parsed.orderId,
        payload: { payment_intent_id: parsed.paymentIntentId },
      });
      return { ...parsed, confirmed: result.ok, error: null };
    } catch (error) {
      // The webhook settles the order regardless; the status view keeps polling.
      return { ...parsed, confirmed: false, error: isGrigoraError(error) ? error : toGrigoraError(error) };
    }
  }

  remembered(orderId?: string): RememberedCheckout | null {
    const saved = readJson<Partial<RememberedCheckout> | null>(this.deps.config.storage, this.rememberKey(), null);
    if (!saved || typeof saved !== "object") return null;
    const entry: RememberedCheckout = {
      orderId: clean(saved.orderId, 80),
      lookupToken: clean(saved.lookupToken, 200),
      provider: clean(saved.provider, 40),
      clientData: saved.clientData && typeof saved.clientData === "object" ? (saved.clientData as Raw) : {},
      awaitingReturn: saved.awaitingReturn === true,
      at: toInt(saved.at, 0),
    };
    if (!entry.orderId || !entry.lookupToken || Date.now() - entry.at > REMEMBER_MS || entry.at > Date.now() + 60_000) return null;
    if (orderId !== undefined && clean(orderId, 80) !== entry.orderId) return null;
    return entry;
  }

  awaitReturn(orderId: string): void {
    if (!this.remembered(orderId)) return;
    this.updateRemembered({ awaitingReturn: true, at: Date.now() });
  }

  forget(): void {
    this.deps.config.storage.remove(this.rememberKey());
  }

  private rememberKey(): string {
    return `grigora-commerce-checkout-${this.deps.projectId}`;
  }

  /** Keep a hosted session's public data so the page it returns to can finish it. */
  private remember(session: CheckoutSession): void {
    if (session.mode !== "hosted" || !session.orderId || !session.lookupToken) return;
    writeJson(this.deps.config.storage, this.rememberKey(), {
      orderId: session.orderId,
      lookupToken: session.lookupToken,
      provider: session.provider,
      clientData: session.clientData,
      awaitingReturn: false,
      at: Date.now(),
    } satisfies RememberedCheckout);
  }

  private updateRemembered(patch: Partial<RememberedCheckout>): void {
    const current = this.remembered();
    if (!current) return;
    writeJson(this.deps.config.storage, this.rememberKey(), { ...current, ...patch } satisfies RememberedCheckout);
  }

  private attemptFor(fingerprint: string): Attempt {
    if (this.attempt && this.attempt.fingerprint === fingerprint) return this.attempt;
    this.attempt = { key: uuid(), fingerprint };
    return this.attempt;
  }
}

export function toSession(output: Raw, fallbackMode: "hosted" | "embedded", fallbackCurrency: string): CheckoutSession {
  const checkout = output.checkout && typeof output.checkout === "object" ? (output.checkout as Raw) : {};
  const rawMode = clean(checkout.mode, 20);
  const mode: CheckoutSession["mode"] = rawMode === "free" ? "free" : rawMode === "embedded" ? "embedded" : rawMode === "hosted" ? "hosted" : fallbackMode;
  const orderId = clean(checkout.order_id, 80) || clean(output.order_id, 80);
  if (!orderId && mode !== "hosted") throw new GrigoraError("Checkout did not return an order.", { code: "checkout_failed" });
  const totals = output.subtotal_amount !== undefined || output.total_amount !== undefined ? mapTotals(output, fallbackCurrency) : null;
  const currency = normalizeCurrency(checkout.currency ?? output.currency, totals?.currency || fallbackCurrency);
  return {
    mode,
    provider: clean(checkout.provider, 40) || (mode === "free" ? "manual" : "hosted"),
    orderId,
    lookupToken: clean(checkout.lookup_token, 200),
    checkoutUrl: clean(checkout.checkout_url, 4000),
    cancelUrl: clean(checkout.cancel_url, 4000),
    reservationExpiresAt: toInt(checkout.reservation_expires_at, 0),
    amount: toInt(checkout.amount, totals ? totals.totalAmount : 0),
    currency,
    totals,
    order: output.order && typeof output.order === "object" ? mapOrder(output.order as Raw) : null,
    clientData: checkout,
    raw: output,
  };
}

export type { Address };
