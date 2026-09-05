import type { ApiClient } from "./client";
import { normalizeCurrency } from "./currency";
import { GrigoraError, isGrigoraError, toGrigoraError } from "./errors";
import type { Emitter, Unsubscribe } from "./events";
import { readJson, writeJson, type StorageAdapter } from "./storage";
import type {
  AddCartItem,
  Cart,
  CartAPI,
  CartLine,
  CartTotals,
  CartValidateOptions,
  GrigoraEvents,
  Product,
  ShippingQuote,
} from "./types";
import { clean, isBrowser, nowMs, toInt, type Logger } from "./util";
import { toApiAddress } from "./validation";

/*
  Cart state, persisted in the same key and shape as the platform's own
  storefront scripts ("grigora-cart-<projectId>", an array of line objects).
  That is a deliberate compatibility decision: a shopper who adds an item on a
  page rendered by the platform and opens the drawer on a page using this SDK
  (or the reverse, including the platform's /checkout page) sees one cart.
  Every field the SDK adds is ignored by the older scripts.
*/

export interface StoredCartItem {
  product_id: string;
  variant_id?: string;
  quantity: number;
  title?: string;
  /** Unit price in minor units. Stale until the next validation. */
  price?: number;
  currency?: string;
  image?: string;
  product_url?: string;
  slug?: string;
  sku?: string;
  in_stock?: boolean;
  requires_shipping?: boolean;
  pricing_type?: string;
  available?: number | null;
}

interface StoredMeta {
  updated_at: number;
}

export interface CartStoreDeps {
  projectId: string;
  storage: StorageAdapter;
  client: ApiClient;
  emitter: Emitter<GrigoraEvents>;
  defaultCurrency: () => string;
  log: Logger;
  maxAgeMs: number;
  keyPrefix: string;
  resolveProduct?: (ref: { productId?: string; productSlug?: string }) => Promise<Product | null>;
}

export function lineIdFor(productId: string, variantId = ""): string {
  return `${productId}::${variantId || ""}`;
}

/** Map a /cart/validate (or checkout) Output to SDK totals. */
export function mapTotals(output: Record<string, unknown>, fallbackCurrency: string): CartTotals {
  const quote = output.shipping_quote as Record<string, unknown> | undefined;
  return {
    subtotalAmount: toInt(output.subtotal_amount, 0),
    discountCode: clean(output.discount_code, 60),
    discountAmount: toInt(output.discount_amount, 0),
    subtotalAfterDiscountAmount: toInt(
      output.subtotal_after_discount_amount,
      Math.max(0, toInt(output.subtotal_amount, 0) - toInt(output.discount_amount, 0))
    ),
    shippingAmount: toInt(output.shipping_amount, 0),
    shippingQuote: quote ? mapShippingQuote(quote) : null,
    taxMode: clean(output.tax_mode, 40),
    taxAmount: toInt(output.tax_amount, 0),
    taxBreakdown: Array.isArray(output.tax_breakdown) ? (output.tax_breakdown as Record<string, unknown>[]) : [],
    pricesIncludeTax: output.prices_include_tax === true,
    taxCalculationStatus: clean(output.tax_calculation_status, 40),
    totalIsEstimate: output.total_is_estimate === true,
    totalAmount: toInt(output.total_amount, 0),
    currency: normalizeCurrency(output.currency, fallbackCurrency),
    allInStock: output.all_in_stock !== false,
    requiresShipping: output.requires_shipping === true,
    itemCount: toInt(output.item_count, 0),
  };
}

export function mapShippingQuote(quote: Record<string, unknown>): ShippingQuote {
  return {
    required: quote.required === true,
    eligible: quote.eligible !== false,
    code: clean(quote.code, 80),
    message: clean(quote.message, 400),
    country: clean(quote.country, 2),
    amount: toInt(quote.amount, 0),
    originalAmount: toInt(quote.original_amount, toInt(quote.amount, 0)),
    rateId: clean(quote.rate_id, 80),
    rateName: clean(quote.rate_name, 80),
    zoneId: clean(quote.zone_id, 80),
    zoneName: clean(quote.zone_name, 80),
    currency: clean(quote.currency, 3).toUpperCase(),
    freeShipping: quote.free_shipping === true,
    availableRates: (Array.isArray(quote.available_rates) ? (quote.available_rates as Record<string, unknown>[]) : []).map(
      (rate) => ({
        rateId: clean(rate.rate_id, 80),
        rateName: clean(rate.rate_name, 80) || "Shipping",
        zoneId: clean(rate.zone_id, 80),
        zoneName: clean(rate.zone_name, 80),
        amount: toInt(rate.amount, 0),
        currency: clean(rate.currency, 3).toUpperCase(),
      })
    ),
  };
}

export class CartStore implements CartAPI {
  readonly key: string;
  readonly discountKey: string;
  readonly metaKey: string;

  private items: StoredCartItem[] = [];
  private discount = "";
  private totals: CartTotals | null = null;
  private validating = false;
  private error: GrigoraError | null = null;
  private updatedAt = nowMs();
  private snapshot: Cart | null = null;
  private seq = 0;
  private lastValidateOptions: CartValidateOptions = {};
  private storageListener: ((event: StorageEvent) => void) | null = null;
  private readonly deps: CartStoreDeps;

  constructor(deps: CartStoreDeps) {
    this.deps = deps;
    this.key = `${deps.keyPrefix}${deps.projectId}`;
    this.discountKey = `${this.key}-discount`;
    this.metaKey = `${this.key}-meta`;
    this.load();
    this.expireIfStale();
    this.listenToOtherTabs();
  }

  // ---------------------------------------------------------------- state

  private load(): void {
    const items = readJson<unknown>(this.deps.storage, this.key, []);
    this.items = Array.isArray(items) ? items.filter(isStoredItem).map(normalizeStoredItem) : [];
    this.discount = clean(this.deps.storage.get(this.discountKey), 60).toUpperCase();
    const meta = readJson<StoredMeta | null>(this.deps.storage, this.metaKey, null);
    this.updatedAt = meta && Number.isFinite(meta.updated_at) ? meta.updated_at : nowMs();
    this.snapshot = null;
  }

  private persist(): void {
    this.updatedAt = nowMs();
    writeJson(this.deps.storage, this.key, this.items);
    writeJson(this.deps.storage, this.metaKey, { updated_at: this.updatedAt });
    if (this.discount) this.deps.storage.set(this.discountKey, this.discount);
    else this.deps.storage.remove(this.discountKey);
    this.snapshot = null;
  }

  private expireIfStale(): void {
    if (!this.items.length || this.deps.maxAgeMs <= 0) return;
    if (nowMs() - this.updatedAt > this.deps.maxAgeMs) {
      this.deps.log("cart expired, clearing", { ageMs: nowMs() - this.updatedAt });
      this.items = [];
      this.discount = "";
      this.persist();
    }
  }

  private listenToOtherTabs(): void {
    if (!isBrowser()) return;
    this.storageListener = (event: StorageEvent) => {
      if (event.key !== this.key && event.key !== this.discountKey) return;
      this.load();
      this.totals = null;
      this.emitChanged();
    };
    window.addEventListener("storage", this.storageListener);
  }

  destroy(): void {
    if (this.storageListener && isBrowser()) window.removeEventListener("storage", this.storageListener);
    this.storageListener = null;
  }

  private emitChanged(): void {
    this.snapshot = null;
    this.deps.emitter.emit("cart:changed", this.get());
  }

  private invalidateTotals(): void {
    this.totals = null;
    this.error = null;
    this.snapshot = null;
  }

  // ------------------------------------------------------------- snapshot

  get(): Cart {
    if (this.snapshot) return this.snapshot;
    const currency = this.deps.defaultCurrency();
    const lines: CartLine[] = this.items.map((item) => {
      const unitAmount = Math.max(0, toInt(item.price, 0));
      const quantity = Math.max(1, toInt(item.quantity, 1));
      return {
        lineId: lineIdFor(item.product_id, item.variant_id),
        productId: item.product_id,
        variantId: item.variant_id || "",
        quantity,
        title: item.title || "",
        unitAmount,
        totalAmount: unitAmount * quantity,
        currency: normalizeCurrency(item.currency, currency),
        imageUrl: item.image || "",
        productUrl: item.product_url || "",
        productSlug: item.slug || "",
        sku: item.sku || "",
        inStock: item.in_stock !== false,
        available: item.available === undefined ? null : item.available,
        requiresShipping: Boolean(item.requires_shipping),
        pricingType: item.pricing_type || "one_time",
      };
    });
    const totals = this.totals || localTotals(lines, this.discount, currency);
    this.snapshot = {
      ...totals,
      itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      projectId: this.deps.projectId,
      lines,
      validated: Boolean(this.totals),
      validating: this.validating,
      error: this.error,
      updatedAt: this.updatedAt,
    };
    return this.snapshot;
  }

  count(): number {
    return this.get().itemCount;
  }

  subtotal(): number {
    return this.get().subtotalAmount;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  lineId(productId: string, variantId = ""): string {
    return lineIdFor(productId, variantId);
  }

  findLine(productId: string, variantId = ""): CartLine | null {
    const id = lineIdFor(productId, variantId);
    return this.get().lines.find((line) => line.lineId === id) || null;
  }

  subscribe(listener: (cart: Cart) => void): Unsubscribe {
    return this.deps.emitter.on("cart:changed", listener);
  }

  toLineItems(): Array<{ product_id: string; variant_id: string; quantity: number }> {
    return this.items.map((item) => ({
      product_id: item.product_id,
      variant_id: item.variant_id || "",
      quantity: Math.max(1, toInt(item.quantity, 1)),
    }));
  }

  getDiscount(): string {
    return this.discount;
  }

  // ------------------------------------------------------------ mutations

  async add(input: AddCartItem): Promise<Cart> {
    let productId = clean(input.productId, 80);
    const variantId = clean(input.variantId, 80);
    const quantity = Math.max(1, toInt(input.quantity, 1));
    let product: Product | null = null;

    if ((!productId || input.title === undefined || input.unitAmount === undefined) && this.deps.resolveProduct) {
      try {
        product = await this.deps.resolveProduct({ productId: productId || undefined, productSlug: clean(input.productSlug, 200) || undefined });
      } catch (error) {
        this.deps.log("product resolution failed", error);
      }
    }
    if (!productId && product) productId = product.id;
    if (!productId) {
      throw new GrigoraError("A product id (or a slug the store knows) is required to add to cart.", { code: "validation_error" });
    }
    if (product && product.hasVariants && !variantId) {
      throw new GrigoraError("Choose a product option before adding to cart.", { code: "variant_required" });
    }

    const variant = product?.variants.find((v) => v.id === variantId) || null;
    const display: Partial<StoredCartItem> = {
      title: clean(input.title, 300) || (variant ? `${product?.title} — ${variant.title}` : product?.title) || "",
      price: input.unitAmount !== undefined ? Math.max(0, toInt(input.unitAmount, 0)) : variant?.priceAmount ?? product?.priceAmount,
      currency: clean(input.currency, 3) || variant?.currency || product?.currency || undefined,
      image: clean(input.imageUrl, 1000) || variant?.imageUrl || product?.imageUrl || undefined,
      product_url: clean(input.productUrl, 1000) || product?.productUrl || undefined,
      slug: product?.slug || undefined,
      requires_shipping: input.requiresShipping ?? variant?.requiresShipping ?? product?.requiresShipping,
      pricing_type: clean(input.pricingType, 40) || product?.pricingType || undefined,
      in_stock: variant ? variant.inStock : product ? product.inStock : undefined,
    };

    const index = this.items.findIndex((item) => item.product_id === productId && (item.variant_id || "") === variantId);
    if (index >= 0) {
      const existing = this.items[index];
      existing.quantity = input.replace ? quantity : Math.max(1, toInt(existing.quantity, 1)) + quantity;
      for (const [key, value] of Object.entries(display)) {
        if (value !== undefined && value !== "" && (existing as unknown as Record<string, unknown>)[key] === undefined) {
          (existing as unknown as Record<string, unknown>)[key] = value;
        }
      }
    } else {
      const item: StoredCartItem = { product_id: productId, variant_id: variantId, quantity };
      for (const [key, value] of Object.entries(display)) {
        if (value !== undefined && value !== "") (item as unknown as Record<string, unknown>)[key] = value;
      }
      this.items.push(item);
    }
    this.invalidateTotals();
    this.persist();
    this.emitChanged();
    const line = this.findLine(productId, variantId);
    if (line) this.deps.emitter.emit("cart:line_added", { line, cart: this.get() });

    const cart = await this.validate();
    if (!cart.lines.some((candidate) => candidate.lineId === lineIdFor(productId, variantId))) {
      throw cart.error || new GrigoraError("This product is no longer available.", { code: "product_unavailable" });
    }
    return cart;
  }

  async update(lineId: string, changes: { quantity: number }): Promise<Cart> {
    const quantity = toInt(changes.quantity, 1);
    if (quantity <= 0) return this.remove(lineId);
    const item = this.items.find((candidate) => lineIdFor(candidate.product_id, candidate.variant_id) === lineId);
    if (!item) return this.get();
    if (item.quantity === quantity) return this.get();
    item.quantity = quantity;
    this.invalidateTotals();
    this.persist();
    this.emitChanged();
    return this.validate();
  }

  increment(lineId: string, by = 1): Promise<Cart> {
    const line = this.get().lines.find((candidate) => candidate.lineId === lineId);
    return this.update(lineId, { quantity: (line?.quantity || 0) + by });
  }

  async remove(lineId: string): Promise<Cart> {
    const before = this.items.length;
    this.items = this.items.filter((candidate) => lineIdFor(candidate.product_id, candidate.variant_id) !== lineId);
    if (this.items.length === before) return this.get();
    this.invalidateTotals();
    this.persist();
    this.emitChanged();
    this.deps.emitter.emit("cart:line_removed", { lineId, cart: this.get() });
    return this.validate();
  }

  clear(): Cart {
    this.items = [];
    this.discount = "";
    this.invalidateTotals();
    this.persist();
    this.emitChanged();
    return this.get();
  }

  async setDiscount(code: string | null): Promise<Cart> {
    const next = clean(code, 60).toUpperCase().replace(/\s+/g, "");
    const previous = this.discount;
    this.discount = next;
    this.invalidateTotals();
    this.persist();
    this.emitChanged();
    try {
      return await this.validate({ ...this.lastValidateOptions, discountCode: undefined, throwOnError: true });
    } catch (error) {
      this.discount = previous;
      this.invalidateTotals();
      this.persist();
      this.emitChanged();
      throw error;
    }
  }

  // ----------------------------------------------------------- validation

  async validate(options: CartValidateOptions = {}): Promise<Cart> {
    const { throwOnError, ...remembered } = options;
    this.lastValidateOptions = remembered;
    if (!this.items.length) {
      this.totals = null;
      this.error = null;
      this.validating = false;
      this.emitChanged();
      return this.get();
    }
    const seq = ++this.seq;
    this.validating = true;
    this.snapshot = null;
    this.emitChanged();

    const discount = options.discountCode === undefined ? this.discount : clean(options.discountCode, 60).toUpperCase();
    const body: Record<string, unknown> = {
      project_id: this.deps.projectId,
      line_items: this.toLineItems(),
    };
    if (discount) body.discount_code = discount;
    if (options.billingAddress) body.billing_address = toApiAddress(options.billingAddress);
    if (options.shippingAddress) body.shipping_address = toApiAddress(options.shippingAddress);
    if (options.shippingRateId) body.shipping_rate_id = clean(options.shippingRateId, 80);

    try {
      const output = await this.deps.client.post<Record<string, unknown>>("/cart/validate", body, { context: "cart" });
      if (seq !== this.seq) return this.get();
      this.applyValidation(output);
      this.validating = false;
      this.error = null;
      this.persist();
      this.snapshot = null;
      this.deps.emitter.emit("cart:validated", this.get());
      this.emitChanged();
      return this.get();
    } catch (raw) {
      if (seq !== this.seq) return this.get();
      const error = toGrigoraError(raw, { code: "unknown" });

      if (error.code === "product_unavailable" && this.items.length > 1) {
        await this.dropUnavailableLines();
        if (seq !== this.seq) return this.get();
        return this.validate({ ...options });
      }

      const discountRejected = Boolean(discount) && isDiscountRejection(error);
      if (discountRejected && !throwOnError && discount === this.discount) {
        this.discount = "";
        this.persist();
        this.deps.emitter.emit("cart:discount_removed", { code: discount, error });
        return this.validate({ ...options, discountCode: undefined });
      }

      this.validating = false;
      if (error.code === "product_unavailable" && this.items.length === 1) {
        this.items = [];
        this.persist();
      }
      this.error = error;
      this.snapshot = null;
      this.deps.emitter.emit("cart:error", error);
      this.emitChanged();
      if (throwOnError) throw error;
      return this.get();
    }
  }

  private applyValidation(output: Record<string, unknown>): void {
    const lines = Array.isArray(output.line_items) ? (output.line_items as Record<string, unknown>[]) : [];
    for (const item of this.items) {
      const match = lines.find(
        (line) => String(line.product_id) === item.product_id && clean(line.variant_id, 80) === (item.variant_id || "")
      );
      if (!match) continue;
      item.price = toInt(match.unit_amount, item.price ?? 0);
      item.currency = clean(match.currency, 3) || item.currency;
      if (match.title) item.title = clean(match.title, 300);
      if (match.image_url) item.image = clean(match.image_url, 1000);
      item.product_url = clean(match.product_url, 1000) || item.product_url;
      item.slug = clean(match.product_slug, 200) || item.slug;
      item.sku = clean(match.sku, 120) || item.sku;
      item.in_stock = match.in_stock !== false;
      item.requires_shipping = Boolean(match.requires_shipping);
      item.pricing_type = clean(match.pricing_type, 40) || item.pricing_type;
      item.available = match.available === null || match.available === undefined ? null : toInt(match.available, 0);
      // The server coalesces duplicate requests; mirror its quantity so totals agree.
      if (match.quantity !== undefined) item.quantity = Math.max(1, toInt(match.quantity, item.quantity));
    }
    this.totals = mapTotals(output, this.deps.defaultCurrency());
  }

  /** One request per line finds the product(s) the server no longer sells and removes them. */
  private async dropUnavailableLines(): Promise<void> {
    const keep: StoredCartItem[] = [];
    for (const item of this.items) {
      try {
        await this.deps.client.post("/cart/validate", {
          project_id: this.deps.projectId,
          line_items: [{ product_id: item.product_id, variant_id: item.variant_id || "", quantity: item.quantity }],
        }, { context: "cart" });
        keep.push(item);
      } catch (error) {
        if (isGrigoraError(error) && error.code === "product_unavailable") {
          this.deps.log("dropping unavailable line", item.product_id, item.variant_id);
          this.deps.emitter.emit("cart:line_removed", { lineId: lineIdFor(item.product_id, item.variant_id), cart: this.get() });
          continue;
        }
        keep.push(item);
      }
    }
    this.items = keep;
    this.invalidateTotals();
    this.persist();
    this.emitChanged();
  }
}

function isDiscountRejection(error: GrigoraError): boolean {
  if (error.code === "invalid_discount") return true;
  if (error.code !== "validation_error" && error.code !== "unknown") return false;
  return /discount|coupon|code/i.test(error.message);
}

function isStoredItem(value: unknown): value is StoredCartItem {
  return Boolean(value && typeof value === "object" && clean((value as StoredCartItem).product_id, 80));
}

function normalizeStoredItem(item: StoredCartItem): StoredCartItem {
  return {
    ...item,
    product_id: clean(item.product_id, 80),
    variant_id: clean(item.variant_id, 80),
    quantity: Math.max(1, toInt(item.quantity, 1)),
  };
}

function localTotals(lines: CartLine[], discountCode: string, currency: string): CartTotals {
  const subtotal = lines.reduce((sum, line) => sum + line.totalAmount, 0);
  return {
    subtotalAmount: subtotal,
    discountCode,
    discountAmount: 0,
    subtotalAfterDiscountAmount: subtotal,
    shippingAmount: 0,
    shippingQuote: null,
    taxMode: "",
    taxAmount: 0,
    taxBreakdown: [],
    pricesIncludeTax: false,
    taxCalculationStatus: "",
    totalIsEstimate: true,
    totalAmount: subtotal,
    currency: lines[0]?.currency || currency,
    allInStock: lines.every((line) => line.inStock),
    requiresShipping: lines.some((line) => line.requiresShipping),
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}
