import { CartStore } from "./cart";
import { CatalogClient } from "./catalog";
import { ApiClient } from "./client";
import { CheckoutClient } from "./checkout";
import { createCurrencyAPI, normalizeCurrency, type CurrencyAPI } from "./currency";
import { GrigoraError, isGrigoraError, toGrigoraError } from "./errors";
import { Emitter, type Unsubscribe } from "./events";
import { AvailabilityClient, DiscountsClient, OrdersClient } from "./orders";
import { hostedAdapter, listGlobalProviders, ProviderRegistryImpl, registerGlobalProvider } from "./providers";
import { defaultStorage, getOrCreateClientId, DEFAULT_CLIENT_ID_KEY } from "./storage";
import type {
  AvailabilityAPI,
  CartAPI,
  CheckoutAPI,
  DiscountsAPI,
  GrigoraCommerce,
  GrigoraCommerceConfig,
  GrigoraEvents,
  OrdersAPI,
  PaymentProviderAdapter,
  ProductsAPI,
  ProviderRegistry,
  ResolvedConfig,
  StoreAPI,
} from "./types";
import { clean, createLogger, defaultApiBase, isBrowser, trimSlashes, type Logger } from "./util";
import { VERSION } from "./version";

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveConfig(config: GrigoraCommerceConfig): ResolvedConfig {
  const projectId = clean(config.projectId, 256).replace(/^project-/, "");
  if (!projectId) throw new GrigoraError("projectId is required to initialise Grigora Commerce.", { code: "validation_error" });
  let locale = clean(config.locale, 40);
  if (!locale && isBrowser()) {
    try {
      locale = navigator.language || "";
    } catch {
      locale = "";
    }
  }
  return {
    projectId,
    apiBase: trimSlashes(clean(config.apiBase, 2000) || defaultApiBase()),
    currency: normalizeCurrency(config.currency, "USD"),
    locale: locale || "en-US",
    successUrl: clean(config.successUrl, 2000),
    cancelUrl: clean(config.cancelUrl, 2000),
    payment: config.payment === "embedded" || config.payment === "hosted" ? config.payment : "auto",
    storage: config.storage || defaultStorage(),
    fetch: config.fetch,
    debug: config.debug === true,
    cartMaxAgeMs: config.cartMaxAgeMs === undefined ? 30 * DAY_MS : Math.max(0, Number(config.cartMaxAgeMs) || 0),
    cartKeyPrefix: clean(config.cartKeyPrefix, 80) || "grigora-cart-",
    clientIdKey: clean(config.clientIdKey, 120) || DEFAULT_CLIENT_ID_KEY,
    catalogTtlMs: config.catalogTtlMs === undefined ? 60_000 : Math.max(0, Number(config.catalogTtlMs) || 0),
    requestTimeoutMs: config.requestTimeoutMs === undefined ? 20_000 : Math.max(1000, Number(config.requestTimeoutMs) || 20_000),
    navigate: typeof config.navigate === "function" ? config.navigate : undefined,
    ui: config.ui && typeof config.ui === "object" ? { ...config.ui } : {},
  };
}

class GrigoraCommerceInstance implements GrigoraCommerce {
  readonly version = VERSION;
  readonly config: ResolvedConfig;
  readonly projectId: string;
  readonly apiBase: string;
  readonly client: ApiClient;
  readonly cart: CartAPI;
  readonly checkout: CheckoutAPI;
  readonly products: ProductsAPI;
  readonly store: StoreAPI;
  readonly orders: OrdersAPI;
  readonly discounts: DiscountsAPI;
  readonly availability: AvailabilityAPI;
  readonly currency: CurrencyAPI;
  readonly providers: ProviderRegistry;
  ui?: unknown;

  private readonly emitter = new Emitter<GrigoraEvents>();
  private readonly cartStore: CartStore;
  private readonly catalog: CatalogClient;
  private readonly logger: Logger;
  private destroyed = false;

  constructor(config: GrigoraCommerceConfig) {
    this.config = resolveConfig(config);
    this.projectId = this.config.projectId;
    this.apiBase = this.config.apiBase;
    this.logger = createLogger(this.config.debug);
    this.emitter.onError = (error, event) => this.logger(`listener for ${String(event)} threw`, error);

    this.client = new ApiClient({
      apiBase: this.apiBase,
      fetch: this.config.fetch,
      timeoutMs: this.config.requestTimeoutMs,
      log: this.logger,
    });
    this.currency = createCurrencyAPI(() => ({
      currency: this.catalog?.storeApi.current()?.currency || this.config.currency,
      locale: this.config.locale,
    }));
    this.catalog = new CatalogClient({
      client: this.client,
      projectId: this.projectId,
      emitter: this.emitter,
      ttlMs: this.config.catalogTtlMs,
      log: this.logger,
      locale: () => this.config.locale,
    });
    this.products = this.catalog;
    this.store = this.catalog.storeApi;
    this.cartStore = new CartStore({
      projectId: this.projectId,
      storage: this.config.storage,
      client: this.client,
      emitter: this.emitter,
      defaultCurrency: () => this.currency.code(),
      log: this.logger,
      maxAgeMs: this.config.cartMaxAgeMs,
      keyPrefix: this.config.cartKeyPrefix,
      resolveProduct: async ({ productId, productSlug }) => {
        const key = productId || productSlug || "";
        if (!key) return null;
        return this.catalog.find(key) || (await this.catalog.get(key));
      },
    });
    this.cart = this.cartStore;
    this.checkout = new CheckoutClient({
      client: this.client,
      projectId: this.projectId,
      cart: this.cartStore,
      catalog: this.catalog,
      emitter: this.emitter,
      config: this.config,
      clientId: () => this.clientId(),
      log: this.logger,
    });
    this.orders = new OrdersClient(this.client, this.projectId);
    this.discounts = new DiscountsClient(this.client, this.projectId);
    this.availability = new AvailabilityClient(this.client, this.projectId);
    this.providers = new ProviderRegistryImpl([hostedAdapter, ...listGlobalProviders()]);
  }

  on<E extends keyof GrigoraEvents>(event: E, listener: (payload: GrigoraEvents[E]) => void): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  once<E extends keyof GrigoraEvents>(event: E, listener: (payload: GrigoraEvents[E]) => void): Unsubscribe {
    return this.emitter.once(event, listener);
  }

  off<E extends keyof GrigoraEvents>(event: E, listener: (payload: GrigoraEvents[E]) => void): void {
    this.emitter.off(event, listener);
  }

  emit<E extends keyof GrigoraEvents>(event: E, payload: GrigoraEvents[E]): void {
    this.emitter.emit(event, payload);
    if (event !== "error" && isGrigoraError(payload) && (event === "cart:error" || event === "checkout:failed")) {
      this.emitter.emit("error", payload);
    }
  }

  formatCurrency(minorUnits: number, currency?: string): string {
    return this.currency.format(minorUnits, currency);
  }

  getStorefrontLang(): string {
    return this.config.locale.split("-")[0] || "en";
  }

  clientId(): string {
    return getOrCreateClientId(this.config.storage, this.config.clientIdKey);
  }

  navigate(url: string): void {
    const target = clean(url, 4000);
    if (!target) return;
    if (this.config.navigate) {
      this.config.navigate(target);
      return;
    }
    if (!isBrowser()) throw new GrigoraError("Navigation needs a browser.", { code: "checkout_failed" });
    window.location.assign(target);
  }

  ready(): Promise<GrigoraCommerce> {
    return Promise.resolve(this);
  }

  log(...args: unknown[]): void {
    this.logger(...args);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cartStore.destroy();
    this.emitter.clear();
    if (defaultInstance === this) defaultInstance = null;
  }
}

let defaultInstance: GrigoraCommerce | null = null;
const readyCallbacks: Array<(commerce: GrigoraCommerce) => void> = [];

/** Create an instance without touching the shared default. */
export function createCommerce(config: GrigoraCommerceConfig): GrigoraCommerce {
  const instance = new GrigoraCommerceInstance(config);
  // Errors raised inside cart/checkout are also mirrored on the generic channel.
  instance.on("cart:error", (error) => instance.emit("error", error));
  instance.on("checkout:failed", (error) => instance.emit("error", error));
  return instance;
}

/** Create (or replace) the shared default instance and flush `onReady` callbacks. */
export function init(config: GrigoraCommerceConfig): GrigoraCommerce {
  if (defaultInstance && defaultInstance.projectId === clean(config.projectId, 256).replace(/^project-/, "")) {
    return defaultInstance;
  }
  if (defaultInstance) defaultInstance.destroy();
  const instance = createCommerce(config);
  defaultInstance = instance;
  const callbacks = readyCallbacks.splice(0, readyCallbacks.length);
  for (const callback of callbacks) {
    try {
      callback(instance);
    } catch (error) {
      instance.log("onReady callback threw", error);
    }
  }
  instance.emit("ready", instance);
  return instance;
}

export function getInstance(): GrigoraCommerce | null {
  return defaultInstance;
}

/** Run `callback` once the default instance exists; immediately if it already does. */
export function onReady(callback: (commerce: GrigoraCommerce) => void): void {
  if (defaultInstance) {
    callback(defaultInstance);
    return;
  }
  readyCallbacks.push(callback);
}

/** Register a payment adapter for the default instance and every instance created afterwards. */
export function registerProvider(adapter: PaymentProviderAdapter): void {
  registerGlobalProvider(adapter);
  defaultInstance?.providers.register(adapter);
}

/** Test seam. */
export function resetDefaultInstance(): void {
  defaultInstance?.destroy();
  defaultInstance = null;
  readyCallbacks.length = 0;
}

export { toGrigoraError };
