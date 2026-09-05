import type { ApiClient } from "./client";
import { formatMinor, normalizeCurrency } from "./currency";
import { GrigoraError } from "./errors";
import type { Emitter } from "./events";
import type {
  Catalog,
  Collection,
  GrigoraEvents,
  Product,
  ProductList,
  ProductListParams,
  ProductVariant,
  ProductsAPI,
  StoreAPI,
  StoreSettings,
} from "./types";
import { clean, nowMs, toInt, type Logger } from "./util";

type Raw = Record<string, unknown>;

export interface CatalogDeps {
  client: ApiClient;
  projectId: string;
  emitter: Emitter<GrigoraEvents>;
  ttlMs: number;
  log: Logger;
  locale: () => string;
}

function asRaw(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

function asRawList(value: unknown): Raw[] {
  return Array.isArray(value) ? value.map(asRaw) : [];
}

function asStrings(value: unknown, max = 300): string[] {
  return Array.isArray(value) ? value.map((item) => clean(item, max)).filter(Boolean) : [];
}

function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function mapVariant(raw: Raw, locale: string, productCurrency: string): ProductVariant {
  const currency = normalizeCurrency(raw.currency, productCurrency);
  const inventory = asRaw(raw.inventory);
  const priceAmount = Math.max(0, toInt(raw.price_amount, 0));
  const optionValues: Record<string, string> = {};
  for (const [key, value] of Object.entries(asRaw(raw.option_values))) optionValues[key] = clean(value, 120);
  return {
    id: clean(raw.variant_id ?? raw.id, 80),
    sku: clean(raw.sku, 120),
    title: clean(raw.title, 300) || Object.values(optionValues).filter(Boolean).join(" / ") || "Default",
    optionValues,
    priceAmount,
    priceFormatted: formatMinor(priceAmount, currency, locale),
    compareAtAmount: Math.max(0, toInt(raw.compare_at_amount, 0)),
    currency,
    imageUrl: clean(raw.image_url, 1000),
    requiresShipping: raw.requires_shipping === true,
    inStock: raw.in_stock !== false,
    available: nullableInt(inventory.available),
    inventoryTracked: inventory.tracked === true,
  };
}

export function mapProduct(raw: Raw, locale = "en-US"): Product {
  const currency = normalizeCurrency(raw.currency, "USD");
  const inventory = asRaw(raw.inventory);
  const priceAmount = Math.max(0, toInt(raw.price_amount, 0));
  const compareAtAmount = Math.max(0, toInt(raw.compare_at_amount, 0));
  const seo = asRaw(raw.seo);
  const productType = clean(raw.product_type, 40) || "digital";
  const requiresShipping = raw.requires_shipping === true;
  return {
    id: clean(raw.id, 80),
    slug: clean(raw.slug, 200),
    title: clean(raw.title, 300),
    subtitle: clean(raw.subtitle, 300),
    editionLabel: clean(raw.edition_label, 120),
    description: clean(raw.description, 20000),
    productType,
    pricingType: clean(raw.pricing_type, 40) || "one_time",
    priceAmount,
    priceFormatted: formatMinor(priceAmount, currency, locale),
    compareAtAmount,
    compareAtFormatted: compareAtAmount > 0 ? formatMinor(compareAtAmount, currency, locale) : "",
    currency,
    imageUrl: clean(raw.image_url, 1000),
    imageAlt: clean(raw.image_alt, 240),
    images: asStrings(raw.images, 1000),
    gallery: asRawList(raw.gallery)
      .map((item) => ({
        url: clean(item.url, 1000),
        type: clean(item.type, 10) === "video" ? ("video" as const) : ("image" as const),
        alt: clean(item.alt, 240),
      }))
      .filter((item) => item.url),
    highlights: asStrings(raw.highlights),
    faqs: asRawList(raw.faqs)
      .map((faq) => ({ question: clean(faq.question, 400), answer: clean(faq.answer, 4000) }))
      .filter((faq) => faq.question),
    shippingNote: clean(raw.shipping_note, 600),
    sampleUrl: clean(raw.sample_url, 1000),
    sku: clean(raw.sku, 120),
    requiresShipping,
    digital: raw.digital === undefined ? productType !== "physical" && !requiresShipping : raw.digital === true,
    inStock: raw.in_stock !== false,
    available: nullableInt(inventory.available),
    inventoryTracked: inventory.tracked === true,
    options: asRawList(raw.options)
      .map((option) => ({ name: clean(option.name, 80), values: asStrings(option.values, 80) }))
      .filter((option) => option.name),
    hasVariants: raw.has_variants === true,
    variants: asRawList(raw.variants).map((variant) => mapVariant(variant, locale, currency)),
    collections: asStrings(raw.collections, 200),
    productUrl: clean(raw.product_url, 1000),
    seo: { title: clean(seo.title, 300), description: clean(seo.description, 600) },
    createdAt: nullableInt(raw.created_at),
    updatedAt: nullableInt(raw.updated_at),
  };
}

export function mapCollection(raw: Raw): Collection {
  const seo = asRaw(raw.seo);
  const productIds = asStrings(raw.product_ids, 80);
  return {
    id: clean(raw.id, 80),
    slug: clean(raw.slug, 200),
    title: clean(raw.title, 300),
    description: clean(raw.description, 4000),
    imageUrl: clean(raw.image_url, 1000),
    productIds,
    productCount: toInt(raw.product_count, productIds.length),
    sort: toInt(raw.sort, 0),
    seo: { title: clean(seo.title, 300), description: clean(seo.description, 600) },
  };
}

export function mapStore(raw: Raw, projectId: string): StoreSettings {
  const checkout = asRaw(raw.checkout);
  const shipping = asRaw(raw.shipping);
  const tax = asRaw(raw.tax);
  const appearance = asRaw(raw.appearance);
  const mode = clean(checkout.mode, 20);
  return {
    projectId: clean(raw.project_id, 80) || projectId,
    storeName: clean(raw.store_name, 160) || "Store",
    currency: normalizeCurrency(raw.currency, "USD"),
    supportEmail: clean(raw.support_email, 240),
    storefrontBaseUrl: clean(raw.storefront_base_url, 1000),
    storefrontOrigins: asStrings(raw.storefront_origins, 1000),
    checkout: {
      provider: clean(checkout.provider, 40) || "stripe",
      mode: mode === "embedded" || mode === "hosted" ? mode : "unavailable",
      embeddedSupported: checkout.embedded_supported === true,
      hostedSupported: checkout.hosted_supported === true,
      testMode: checkout.test_mode !== false,
      code: clean(checkout.code, 80),
      message: clean(checkout.message, 400),
      stripePublishableKey: clean(checkout.stripe_publishable_key, 240),
      razorpayKeyId: clean(checkout.razorpay_key_id, 240),
    },
    shipping: {
      configured: shipping.configured === true,
      allowedCountries: asStrings(shipping.allowed_countries, 2).map((code) => code.toUpperCase()),
    },
    tax: { mode: clean(tax.mode, 40) || "none", pricesIncludeTax: tax.prices_include_tax === true },
    appearance: {
      themePreset: clean(appearance.theme_preset, 40),
      accentColor: clean(appearance.accent_color, 20),
      backgroundColor: clean(appearance.background_color, 20),
      textColor: clean(appearance.text_color, 20),
      buttonStyle: clean(appearance.button_style, 20),
    },
    newsletterOptin: raw.newsletter_optin === true,
  };
}

interface Cached<T> {
  value: T;
  at: number;
}

/**
 * Products, collections and store settings, read from the public storefront
 * endpoints and cached briefly. One `catalog()` call is the cheapest way to
 * boot a whole storefront; `get()` answers from that cache when it can.
 */
export class CatalogClient implements ProductsAPI {
  private readonly deps: CatalogDeps;
  private storeCache: Cached<StoreSettings> | null = null;
  private catalogCache: Cached<Catalog> | null = null;
  private storeInFlight: Promise<StoreSettings> | null = null;
  private catalogInFlight: Promise<Catalog> | null = null;

  constructor(deps: CatalogDeps) {
    this.deps = deps;
  }

  private path(suffix: string): string {
    return `/storefront/${encodeURIComponent(this.deps.projectId)}${suffix}`;
  }

  private fresh<T>(cache: Cached<T> | null, force?: boolean): T | null {
    if (!cache || force) return null;
    return nowMs() - cache.at <= this.deps.ttlMs ? cache.value : null;
  }

  readonly storeApi: StoreAPI = {
    get: (options) => this.loadStore(options),
    current: () => this.storeCache?.value || null,
  };

  async loadStore(options: { force?: boolean } = {}): Promise<StoreSettings> {
    const cached = this.fresh(this.storeCache, options.force);
    if (cached) return cached;
    if (this.storeInFlight && !options.force) return this.storeInFlight;
    this.storeInFlight = this.deps.client
      .get<Raw>(this.path("/settings"), { context: "generic" })
      .then((output) => {
        const store = mapStore(asRaw(output.store), this.deps.projectId);
        this.storeCache = { value: store, at: nowMs() };
        this.deps.emitter.emit("store:loaded", store);
        return store;
      })
      .finally(() => {
        this.storeInFlight = null;
      });
    return this.storeInFlight;
  }

  async catalog(options: { force?: boolean } = {}): Promise<Catalog> {
    const cached = this.fresh(this.catalogCache, options.force);
    if (cached) return cached;
    if (this.catalogInFlight && !options.force) return this.catalogInFlight;
    const locale = this.deps.locale();
    this.catalogInFlight = this.deps.client
      .get<Raw>(this.path("/catalog"), { context: "product" })
      .then((output) => {
        const store = mapStore(asRaw(output.store), this.deps.projectId);
        const catalog: Catalog = {
          store,
          products: asRawList(output.products).map((raw) => mapProduct(raw, locale)),
          collections: asRawList(output.collections).map(mapCollection),
        };
        this.catalogCache = { value: catalog, at: nowMs() };
        if (!this.storeCache || options.force) {
          this.storeCache = { value: store, at: nowMs() };
          this.deps.emitter.emit("store:loaded", store);
        }
        return catalog;
      })
      .finally(() => {
        this.catalogInFlight = null;
      });
    return this.catalogInFlight;
  }

  async list(params: ProductListParams = {}): Promise<ProductList> {
    const output = await this.deps.client.get<Raw>(this.path("/products"), {
      context: "product",
      query: {
        collection: params.collection,
        q: params.q,
        ids: params.ids,
        in_stock: params.inStock ? "1" : undefined,
        sort: params.sort,
        limit: params.limit,
        cursor: params.cursor,
      },
    });
    const locale = this.deps.locale();
    return {
      products: asRawList(output.products).map((raw) => mapProduct(raw, locale)),
      total: toInt(output.total, 0),
      limit: toInt(output.limit, 0),
      nextCursor: clean(output.next_cursor, 400),
    };
  }

  find(idOrSlug: string): Product | null {
    const key = clean(idOrSlug, 200);
    if (!key) return null;
    const products = this.fresh(this.catalogCache)?.products || this.catalogCache?.value.products || [];
    return products.find((product) => product.id === key || product.slug === key) || null;
  }

  async get(idOrSlug: string): Promise<Product> {
    const key = clean(idOrSlug, 200);
    if (!key) throw new GrigoraError("A product id or slug is required.", { code: "validation_error" });
    const cached = this.fresh(this.catalogCache)?.products.find((product) => product.id === key || product.slug === key);
    if (cached) return cached;
    const output = await this.deps.client.get<Raw>(this.path(`/products/${encodeURIComponent(key)}`), { context: "product" });
    const product = mapProduct(asRaw(output.product), this.deps.locale());
    if (!product.id) throw new GrigoraError("Product not found.", { code: "not_found", httpStatus: 404 });
    return product;
  }

  getBySlug(slug: string): Promise<Product> {
    return this.get(slug);
  }

  async collections(): Promise<Collection[]> {
    const cached = this.fresh(this.catalogCache);
    if (cached) return cached.collections;
    const output = await this.deps.client.get<Raw>(this.path("/collections"), { context: "product" });
    return asRawList(output.collections).map(mapCollection);
  }

  invalidate(): void {
    this.storeCache = null;
    this.catalogCache = null;
  }
}
