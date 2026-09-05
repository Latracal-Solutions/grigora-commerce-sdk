import type { GrigoraError } from "./errors";
import type { StorageAdapter } from "./storage";
import type { Unsubscribe } from "./events";
import type { CurrencyAPI } from "./currency";
import type { ApiClient } from "./client";

export type { Unsubscribe } from "./events";
export type { StorageAdapter } from "./storage";
export type { CurrencyAPI, FormatOptions } from "./currency";

export type PricingType = "one_time" | "pay_what_you_want" | "subscription" | (string & {});
export type ProductType = "physical" | "digital" | "download" | "course" | "template" | "membership" | "service" | (string & {});
export type ProviderId = "stripe" | "razorpay" | "paypal" | "paddle" | "manual" | "hosted" | (string & {});
/** How the shopper should pay: let the store decide, force the in-page form, or always redirect. */
export type PaymentPreference = "auto" | "embedded" | "hosted";
export type CheckoutMode = "embedded" | "hosted" | "unavailable";

export interface GrigoraCommerceConfig {
  /** The Grigora project (site) id. `project-` prefix optional. */
  projectId: string;
  /** API origin. Defaults to https://api.grigora.co (http://localhost:2706 on localhost). */
  apiBase?: string;
  /** Fallback currency before the store settings load. Default "USD". */
  currency?: string;
  /** BCP-47 locale for formatting. Default: navigator.language, else "en-US". */
  locale?: string;
  /** Where the shopper lands after paying. Default: the current page (the SDK reads order_id/lookup_token there). */
  successUrl?: string;
  /** Where a cancelled hosted checkout returns. Default: the current URL. */
  cancelUrl?: string;
  /** Default "auto": embedded when the store supports it, hosted otherwise. */
  payment?: PaymentPreference;
  storage?: StorageAdapter;
  fetch?: typeof fetch;
  debug?: boolean;
  /** Carts idle longer than this are dropped on load. Default 30 days. */
  cartMaxAgeMs?: number;
  /** localStorage key prefix. Default "grigora-cart-" (shared with the platform's own storefront). */
  cartKeyPrefix?: string;
  clientIdKey?: string;
  /** How long catalog/store responses are reused. Default 60s. */
  catalogTtlMs?: number;
  requestTimeoutMs?: number;
  /** Override how the SDK navigates (hosted checkout redirect, success page). Default: window.location.assign. Useful for SPA routers and tests. */
  navigate?: (url: string) => void;
  /** Options consumed by @grigora/commerce-ui when it is installed. */
  ui?: Record<string, unknown>;
}

export interface ResolvedConfig {
  projectId: string;
  apiBase: string;
  currency: string;
  locale: string;
  successUrl: string;
  cancelUrl: string;
  payment: PaymentPreference;
  storage: StorageAdapter;
  fetch?: typeof fetch;
  debug: boolean;
  cartMaxAgeMs: number;
  cartKeyPrefix: string;
  clientIdKey: string;
  catalogTtlMs: number;
  requestTimeoutMs: number;
  navigate?: (url: string) => void;
  ui: Record<string, unknown>;
}

export interface Address {
  name: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  taxId: string;
}

/** The wire shape the Grigora API reads. */
export interface ApiAddress {
  name: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  tax_id: string;
}

export interface ProductOption {
  name: string;
  values: string[];
}

export interface ProductVariant {
  id: string;
  sku: string;
  title: string;
  optionValues: Record<string, string>;
  priceAmount: number;
  priceFormatted: string;
  compareAtAmount: number;
  currency: string;
  imageUrl: string;
  requiresShipping: boolean;
  inStock: boolean;
  /** Units left when inventory is tracked, otherwise null. */
  available: number | null;
  inventoryTracked: boolean;
}

export interface GalleryItem {
  url: string;
  type: "image" | "video";
  alt: string;
}

export interface ProductFaq {
  question: string;
  answer: string;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  editionLabel: string;
  description: string;
  productType: ProductType;
  pricingType: PricingType;
  /** Integer minor units (2999 = 29.99). */
  priceAmount: number;
  priceFormatted: string;
  compareAtAmount: number;
  compareAtFormatted: string;
  currency: string;
  imageUrl: string;
  imageAlt: string;
  images: string[];
  gallery: GalleryItem[];
  highlights: string[];
  faqs: ProductFaq[];
  shippingNote: string;
  sampleUrl: string;
  sku: string;
  requiresShipping: boolean;
  digital: boolean;
  inStock: boolean;
  available: number | null;
  inventoryTracked: boolean;
  options: ProductOption[];
  hasVariants: boolean;
  variants: ProductVariant[];
  /** Slugs of the collections this product belongs to. */
  collections: string[];
  productUrl: string;
  seo: { title: string; description: string };
  createdAt: number | null;
  updatedAt: number | null;
}

export interface Collection {
  id: string;
  slug: string;
  title: string;
  description: string;
  imageUrl: string;
  productIds: string[];
  productCount: number;
  sort: number;
  seo: { title: string; description: string };
}

export type ProductSort = "newest" | "oldest" | "price_asc" | "price_desc" | "title";

export interface ProductListParams {
  collection?: string;
  q?: string;
  ids?: string[];
  inStock?: boolean;
  sort?: ProductSort;
  limit?: number;
  cursor?: string;
}

export interface ProductList {
  products: Product[];
  total: number;
  limit: number;
  nextCursor: string;
}

export interface StoreCheckout {
  provider: ProviderId;
  mode: CheckoutMode;
  embeddedSupported: boolean;
  hostedSupported: boolean;
  testMode: boolean;
  /** Why checkout is unavailable, when it is. */
  code: string;
  message: string;
  stripePublishableKey: string;
  razorpayKeyId: string;
}

export interface StoreSettings {
  projectId: string;
  storeName: string;
  currency: string;
  supportEmail: string;
  storefrontBaseUrl: string;
  /** Origins the API will redirect back to after payment. */
  storefrontOrigins: string[];
  checkout: StoreCheckout;
  shipping: { configured: boolean; allowedCountries: string[] };
  tax: { mode: string; pricesIncludeTax: boolean };
  appearance: {
    themePreset: string;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
    buttonStyle: string;
  };
  newsletterOptin: boolean;
}

export interface Catalog {
  products: Product[];
  collections: Collection[];
  store: StoreSettings;
}

export interface AddCartItem {
  productId?: string;
  /** Resolved to a product id through the catalog when productId is absent. */
  productSlug?: string;
  variantId?: string;
  quantity?: number;
  /** Set the line to `quantity` instead of adding to it. */
  replace?: boolean;
  /** Optional display data for an instant render; the server's values win on validation. */
  title?: string;
  unitAmount?: number;
  currency?: string;
  imageUrl?: string;
  productUrl?: string;
  requiresShipping?: boolean;
  pricingType?: PricingType;
}

export interface CartLine {
  lineId: string;
  productId: string;
  variantId: string;
  quantity: number;
  title: string;
  unitAmount: number;
  totalAmount: number;
  currency: string;
  imageUrl: string;
  productUrl: string;
  productSlug: string;
  sku: string;
  inStock: boolean;
  available: number | null;
  requiresShipping: boolean;
  pricingType: PricingType;
}

export interface ShippingRate {
  rateId: string;
  rateName: string;
  zoneId: string;
  zoneName: string;
  amount: number;
  currency: string;
}

export interface ShippingQuote {
  required: boolean;
  eligible: boolean;
  code: string;
  message: string;
  country: string;
  amount: number;
  originalAmount: number;
  rateId: string;
  rateName: string;
  zoneId: string;
  zoneName: string;
  currency: string;
  freeShipping: boolean;
  availableRates: ShippingRate[];
}

export type TaxLine = Record<string, unknown>;

export interface CartTotals {
  subtotalAmount: number;
  discountCode: string;
  discountAmount: number;
  subtotalAfterDiscountAmount: number;
  shippingAmount: number;
  shippingQuote: ShippingQuote | null;
  taxMode: string;
  taxAmount: number;
  taxBreakdown: TaxLine[];
  pricesIncludeTax: boolean;
  taxCalculationStatus: string;
  /** True until an address lets the server price shipping and tax exactly. */
  totalIsEstimate: boolean;
  totalAmount: number;
  currency: string;
  allInStock: boolean;
  requiresShipping: boolean;
  itemCount: number;
}

export interface Cart extends CartTotals {
  projectId: string;
  lines: CartLine[];
  /** True when the totals came from the server for the current lines. */
  validated: boolean;
  validating: boolean;
  error: GrigoraError | null;
  updatedAt: number;
}

export interface CartValidateOptions {
  billingAddress?: Partial<Address> | null;
  shippingAddress?: Partial<Address> | null;
  shippingRateId?: string;
  /** Overrides the stored discount for this validation only. */
  discountCode?: string | null;
  /** Reject instead of recording the failure on `cart.error`. */
  throwOnError?: boolean;
}

export interface CartAPI {
  get(): Cart;
  count(): number;
  subtotal(): number;
  isEmpty(): boolean;
  add(item: AddCartItem): Promise<Cart>;
  update(lineId: string, changes: { quantity: number }): Promise<Cart>;
  increment(lineId: string, by?: number): Promise<Cart>;
  remove(lineId: string): Promise<Cart>;
  clear(): Cart;
  setDiscount(code: string | null): Promise<Cart>;
  getDiscount(): string;
  validate(options?: CartValidateOptions): Promise<Cart>;
  lineId(productId: string, variantId?: string): string;
  findLine(productId: string, variantId?: string): CartLine | null;
  subscribe(listener: (cart: Cart) => void): Unsubscribe;
  toLineItems(): Array<{ product_id: string; variant_id: string; quantity: number }>;
}

export interface CheckoutInput {
  billingAddress: Partial<Address>;
  shippingAddress?: Partial<Address> | null;
  /** Default true: ship to the billing address. */
  sameAsBilling?: boolean;
  shippingRateId?: string;
  /** Default: the cart's stored discount code. */
  discountCode?: string | null;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutStartOptions {
  payment?: PaymentPreference;
}

export interface SingleCheckoutInput {
  productId?: string;
  slug?: string;
  variantId?: string;
  /** Pay-what-you-want amount in minor units. */
  amount?: number;
  customerEmail: string;
  customerName?: string;
  discountCode?: string;
  provider?: ProviderId;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutSession {
  mode: "hosted" | "embedded" | "free";
  provider: ProviderId;
  orderId: string;
  /** Capability token: authorises order lookup and cancellation for this order. */
  lookupToken: string;
  checkoutUrl: string;
  cancelUrl: string;
  reservationExpiresAt: number;
  amount: number;
  currency: string;
  totals: CartTotals | null;
  order: Order | null;
  /** Provider data for the adapter: client_secret, publishable_key, razorpay_order_id, key_id... */
  clientData: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface ConfirmInput {
  provider: ProviderId;
  orderId: string;
  /** Provider result, e.g. { payment_intent_id } or { razorpay_payment_id, ... }. */
  payload: Record<string, unknown>;
}

export interface ConfirmResult {
  ok: boolean;
  orderId: string;
  order: Order | null;
}

export interface CheckoutReturn {
  orderId: string;
  lookupToken: string;
  paymentIntentId: string;
  /** null when no confirmation was needed, true/false when one was attempted. */
  confirmed: boolean | null;
  error: GrigoraError | null;
}

export interface CheckoutAPI {
  quote(input: Partial<CheckoutInput>): Promise<Cart>;
  start(input: CheckoutInput, options?: CheckoutStartOptions): Promise<CheckoutSession>;
  startHosted(input: CheckoutInput): Promise<CheckoutSession>;
  startEmbedded(input: CheckoutInput): Promise<CheckoutSession>;
  startSingle(input: SingleCheckoutInput): Promise<CheckoutSession>;
  confirm(input: ConfirmInput): Promise<ConfirmResult>;
  cancel(session?: CheckoutSession | { orderId: string; lookupToken: string }): Promise<void>;
  current(): CheckoutSession | null;
  reset(): void;
  resolveMode(store: StoreSettings, preference?: PaymentPreference): CheckoutMode;
  parseReturn(url?: string): CheckoutReturn | null;
  handleReturn(url?: string): Promise<CheckoutReturn | null>;
  defaultSuccessUrl(): string;
  defaultCancelUrl(): string;
}

export interface OrderLineItem {
  title: string;
  quantity: number;
  unitAmount: number;
}

export interface Fulfillment {
  status: string;
  trackingCompany: string;
  trackingNumber: string;
  shippedAt: number | null;
  deliveredAt: number | null;
}

export type OrderPaymentState = "paid" | "pending" | "failed" | "unknown";

export interface Order {
  orderId: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  currency: string;
  totalAmount: number;
  lineItems: OrderLineItem[];
  fulfillments: Fulfillment[];
  invoiceId: string;
  invoiceNumber: string;
  invoiceUrl: string;
  invoicePdfUrl: string;
  invoiceIssuedAt: number | null;
  createdAt: number | null;
  paymentState: OrderPaymentState;
}

export interface OrderLookupInput {
  orderId: string;
  email?: string;
  lookupToken?: string;
}

export interface OrdersAPI {
  lookup(input: OrderLookupInput): Promise<Order>;
  /** Signed, short-lived download link for a digital order. `token` is the download token from the delivery email. */
  downloadUrl(input: { orderId: string; token: string }): Promise<string>;
  invoiceUrl(input: { invoiceId: string; token?: string; format?: "html" | "json" | "pdf" }): string;
}

export interface DiscountValidateInput {
  code: string;
  productId?: string;
  slug?: string;
}

export interface DiscountResult {
  ok: boolean;
  code: string;
  type: string;
  value: string;
  discountAmount: number;
  currency: string;
  originalAmount: number;
  finalAmount: number;
  reason: string;
  message: string;
}

export interface DiscountsAPI {
  /** Product-level check. For a whole cart use `cart.setDiscount`. */
  validate(input: DiscountValidateInput): Promise<DiscountResult>;
}

export interface AvailabilityItem {
  productId: string;
  variantId?: string;
}

export interface AvailabilityResult {
  productId: string;
  variantId: string;
  available: number | null;
  inStock: boolean;
}

export interface AvailabilityAPI {
  check(items: AvailabilityItem[]): Promise<AvailabilityResult[]>;
}

export interface ProductsAPI {
  list(params?: ProductListParams): Promise<ProductList>;
  get(idOrSlug: string): Promise<Product>;
  getBySlug(slug: string): Promise<Product>;
  collections(): Promise<Collection[]>;
  catalog(options?: { force?: boolean }): Promise<Catalog>;
  /** Synchronous lookup in the already-loaded catalog. */
  find(idOrSlug: string): Product | null;
  invalidate(): void;
}

export interface StoreAPI {
  get(options?: { force?: boolean }): Promise<StoreSettings>;
  current(): StoreSettings | null;
}

export interface PaymentAdapterTheme {
  accent: string;
  font: string;
}

export interface PaymentAdapterContext {
  commerce: GrigoraCommerce;
  session: CheckoutSession;
  /** Where an embedded form renders. null for hosted redirects. */
  container: HTMLElement | null;
  billing: Address;
  shipping: Address | null;
  /** Where a provider redirect (3DS, wallets) should come back to. */
  returnUrl: string;
  theme: PaymentAdapterTheme;
  /** Provider result to send to /checkout/embedded/confirm. */
  onComplete(payload: Record<string, unknown>): void;
  onCancel(): void;
  onError(error: Error): void;
  onReady?(): void;
}

export interface PaymentProviderAdapter {
  readonly id: ProviderId;
  readonly supportsEmbedded: boolean;
  /** Inject the provider's script once. Idempotent. */
  loadScript?(): Promise<void>;
  /** Render the payment UI (embedded) or prepare the redirect (hosted). */
  mount(context: PaymentAdapterContext): Promise<void>;
  /** The shopper pressed Pay. */
  submit(context: PaymentAdapterContext): Promise<void>;
  destroy(): void;
  /** Label for the pay button, e.g. "Pay $29.00" or "Continue to PayPal". */
  submitLabel?(context: PaymentAdapterContext): string;
}

export interface ProviderRegistry {
  register(adapter: PaymentProviderAdapter): void;
  get(id: ProviderId): PaymentProviderAdapter | null;
  has(id: ProviderId): boolean;
  list(): PaymentProviderAdapter[];
}

export type GrigoraEvents = {
  ready: GrigoraCommerce;
  "cart:changed": Cart;
  "cart:validated": Cart;
  "cart:error": GrigoraError;
  "cart:line_added": { line: CartLine; cart: Cart };
  "cart:line_removed": { lineId: string; cart: Cart };
  "cart:discount_removed": { code: string; error: GrigoraError };
  "cart:opened": Cart;
  "cart:closed": Cart;
  "store:loaded": StoreSettings;
  "checkout:started": CheckoutSession;
  "checkout:completed": { orderId: string; lookupToken: string; order: Order | null };
  "checkout:failed": GrigoraError;
  "checkout:cancelled": { orderId: string };
  "order:paid": Order;
  error: GrigoraError;
};

export interface GrigoraCommerce {
  readonly version: string;
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
  /** Set by @grigora/commerce-ui when installed. */
  ui?: unknown;
  on<E extends keyof GrigoraEvents>(event: E, listener: (payload: GrigoraEvents[E]) => void): Unsubscribe;
  once<E extends keyof GrigoraEvents>(event: E, listener: (payload: GrigoraEvents[E]) => void): Unsubscribe;
  off<E extends keyof GrigoraEvents>(event: E, listener: (payload: GrigoraEvents[E]) => void): void;
  emit<E extends keyof GrigoraEvents>(event: E, payload: GrigoraEvents[E]): void;
  formatCurrency(minorUnits: number, currency?: string): string;
  getStorefrontLang(): string;
  clientId(): string;
  /** Go to a URL through the configured navigator (window.location.assign by default). */
  navigate(url: string): void;
  ready(): Promise<GrigoraCommerce>;
  destroy(): void;
  log(...args: unknown[]): void;
}
