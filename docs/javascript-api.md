# JavaScript API (`@grigora/commerce-core`)

Everything returns a `Promise` unless noted. Every amount is an integer in minor units (2999 = 29.99). Errors are `GrigoraError` with a stable `code` ([catalog](./errors-and-events.md)).

## Creating an instance

```ts
import { createCommerce, init, onReady, Commerce } from "@grigora/commerce-core";

const commerce = createCommerce(config);   // independent instance
const shared = init(config);               // the default instance (what the CDN global uses)
onReady((c) => { /* runs when init() has happened, immediately if it already has */ });
Commerce.get();                            // the default instance or null
```

```ts
interface GrigoraCommerceConfig {
  projectId: string;                 // required
  apiBase?: string;                  // default https://api.grigora.co (http://localhost:2706 on localhost)
  currency?: string;                 // fallback until the store settings load, default "USD"
  locale?: string;                   // default navigator.language
  successUrl?: string;               // default: current page
  cancelUrl?: string;                // default: current URL
  payment?: "auto" | "embedded" | "hosted";
  storage?: StorageAdapter;          // default localStorage (memory when unavailable)
  fetch?: typeof fetch;
  navigate?: (url: string) => void;  // default window.location.assign; use your router here
  debug?: boolean;
  cartMaxAgeMs?: number;             // default 30 days
  catalogTtlMs?: number;             // default 60s
  requestTimeoutMs?: number;         // default 20s
  ui?: UIOptions;                    // consumed by @grigora/commerce-ui
}
```

## `commerce.cart`

State lives in `localStorage` under `grigora-cart-<projectId>` in the same shape the Grigora platform's own storefront scripts use, so a shopper moving between a platform-rendered page and an SDK page keeps one cart. Prices, titles and stock are refreshed from `POST /cart/validate`.

```ts
cart.get(): Cart                         // synchronous snapshot
cart.count(): number; cart.subtotal(): number; cart.isEmpty(): boolean
cart.add({ productId | productSlug, variantId?, quantity?, replace?, title?, unitAmount?, imageUrl?, … }): Promise<Cart>
cart.update(lineId, { quantity }); cart.increment(lineId, by = 1); cart.remove(lineId); cart.clear()
cart.setDiscount(code | null): Promise<Cart>   // rejects with invalid_discount and reverts
cart.getDiscount(): string
cart.validate({ billingAddress?, shippingAddress?, shippingRateId?, discountCode?, throwOnError? }): Promise<Cart>
cart.findLine(productId, variantId?); cart.lineId(productId, variantId?)
cart.subscribe((cart) => …): () => void
cart.toLineItems()                       // [{ product_id, variant_id, quantity }]
```

`Cart` fields: `lines[]` (`lineId, productId, variantId, quantity, title, unitAmount, totalAmount, currency, imageUrl, productUrl, productSlug, sku, inStock, available, requiresShipping, pricingType`), `itemCount`, `currency`, `subtotalAmount`, `discountCode`, `discountAmount`, `subtotalAfterDiscountAmount`, `shippingAmount`, `shippingQuote` (`eligible, message, rateId, rateName, availableRates[]`), `taxMode`, `taxAmount`, `taxBreakdown`, `pricesIncludeTax`, `totalIsEstimate`, `totalAmount`, `allInStock`, `requiresShipping`, `validated`, `validating`, `error`, `updatedAt`.

Behaviour worth knowing:

- Mutations are optimistic: `cart:changed` fires at once, then again after the server validation.
- A product the store no longer sells is removed automatically (the SDK isolates it with one request per line).
- A discount the merchant has since disabled is dropped quietly during a background validation (`cart:discount_removed`); an explicit `setDiscount` rejects instead.
- Other tabs stay in sync through the `storage` event.

## `commerce.products` and `commerce.store`

```ts
products.catalog({ force? }): Promise<{ products, collections, store }>   // one request, cached
products.list({ collection?, q?, ids?, inStock?, sort?, limit?, cursor? }): Promise<{ products, total, limit, nextCursor }>
products.get(idOrSlug): Promise<Product>                                    // served from the catalog cache when possible
products.getBySlug(slug); products.collections(); products.find(idOrSlug) /* sync */; products.invalidate()
store.get({ force? }): Promise<StoreSettings>; store.current(): StoreSettings | null
```

`Product`: `id, slug, title, subtitle, description, productType, pricingType, priceAmount, priceFormatted, compareAtAmount, compareAtFormatted, currency, imageUrl, images[], gallery[], highlights[], faqs[], sku, requiresShipping, digital, inStock, available, inventoryTracked, options[{ name, values }], hasVariants, variants[{ id, title, optionValues, priceAmount, priceFormatted, inStock, available, … }], collections[] (slugs), productUrl, seo, createdAt, updatedAt`.

`StoreSettings`: `storeName, currency, supportEmail, storefrontBaseUrl, storefrontOrigins[], checkout { provider, mode: "embedded" | "hosted" | "unavailable", embeddedSupported, hostedSupported, testMode, code, message, stripePublishableKey, razorpayKeyId }, shipping { configured, allowedCountries[] }, tax { mode, pricesIncludeTax }, appearance { accentColor, … }`.

## `commerce.checkout`

```ts
checkout.quote({ billingAddress, shippingAddress?, sameAsBilling?, shippingRateId?, discountCode? }): Promise<Cart>
checkout.start(input, { payment? }): Promise<CheckoutSession>   // embedded or hosted per store settings + preference
checkout.startHosted(input); checkout.startEmbedded(input)
checkout.startSingle({ productId | slug, variantId?, amount?, customerEmail, customerName?, discountCode?, provider? })
checkout.confirm({ provider, orderId, payload }): Promise<{ ok, orderId, order }>
checkout.cancel(session?): Promise<void>
checkout.current(): CheckoutSession | null; checkout.reset()
checkout.resolveMode(store, preference?): "embedded" | "hosted" | "unavailable"
checkout.parseReturn(url?): { orderId, lookupToken, paymentIntentId } | null
checkout.handleReturn(url?): Promise<CheckoutReturn | null>      // confirms a Stripe redirect payment when present
checkout.defaultSuccessUrl(); checkout.defaultCancelUrl()
```

`CheckoutInput.billingAddress` needs `name, email, phone, line1, city, postalCode, country` (plus `state`, `line2` optional). The SDK validates with the API's own rules before sending ([`addressErrors`](#validation-helpers)).

`CheckoutSession`: `mode: "hosted" | "embedded" | "free"`, `provider`, `orderId`, `lookupToken`, `checkoutUrl` (hosted redirect target, or the thank-you URL for a free order), `cancelUrl`, `amount`, `currency`, `totals`, `order` (free orders), `clientData` (raw provider data: `client_secret`, `publishable_key`, `razorpay_order_id`, `key_id`, …).

Idempotency: every checkout POST sends `Idempotency-Key` and `X-Grigora-Checkout-Client`. The key is reused while the request is identical (same lines, addresses, rate, discount, mode) so a retried click replays the pending order; any change mints a new key. `checkout_in_progress` keeps the key; other failures drop it.

Embedded flow (what `<g-checkout>` does):

```ts
const session = await commerce.checkout.startEmbedded({ billingAddress });
const adapter = commerce.providers.get(session.provider);   // stripe | razorpay
await adapter.loadScript?.();
await adapter.mount({ commerce, session, container, billing, shipping, returnUrl, theme,
  onComplete: (payload) => commerce.checkout.confirm({ provider: session.provider, orderId: session.orderId, payload }),
  onCancel, onError });
await adapter.submit(context);   // Stripe: confirmPayment; Razorpay: open overlay
```

Hosted flow: `commerce.navigate(session.checkoutUrl)` (or `commerce.providers.get("hosted").submit(context)`).

## `commerce.orders`, `discounts`, `availability`

```ts
orders.lookup({ orderId, lookupToken | email }): Promise<Order>   // paymentState: paid | pending | failed | unknown
orders.downloadUrl({ orderId, token }): Promise<string>          // token from the delivery email
orders.invoiceUrl({ invoiceId, token?, format?: "html" | "json" | "pdf" }): string
discounts.validate({ code, productId | slug }): Promise<DiscountResult>   // product-level; use cart.setDiscount for carts
availability.check([{ productId, variantId? }]): Promise<AvailabilityResult[]>
```

## `commerce.currency` and formatting

```ts
commerce.formatCurrency(2999)            // "$29.99" in the store currency
commerce.currency.format(2999, "INR", "en-IN"); .toMinor(29.99); .toMajor(2999); .symbol("USD"); .code()
```

The API treats every currency as having two decimals (it divides by 100 for JPY too); the SDK matches it so totals agree.

## `commerce.providers`

```ts
providers.register(adapter); providers.get(id); providers.has(id); providers.list()
registerProvider(adapter)   // module-level: applies to the default instance and every instance created afterwards
```

`PaymentProviderAdapter`: `{ id, supportsEmbedded, loadScript?(), mount(ctx), submit(ctx), destroy(), submitLabel?(ctx) }`. The built-in `hosted` adapter redirects to `session.checkoutUrl`. Stripe and Razorpay adapters live in their own packages.

## Events

```ts
commerce.on("cart:changed", (cart) => …)   // returns an unsubscribe function
commerce.once(event, fn); commerce.off(event, fn)
```

## Validation helpers

```ts
import { addressErrors, isAddressValid, normalizeAddress, toApiAddress, isValidEmail, isValidPhone, isValidPostalCode, COUNTRIES, countryName, normalizeCountryCode } from "@grigora/commerce-core";
addressErrors({ name: "", email: "x" })   // ["name", "email", "line1", "city", "postalCode", "country", "phone"]
```

Ported rule-for-rule from the API (country-specific phone and postal formats), so a field marked valid here is accepted there.

## Other

```ts
commerce.navigate(url)           // through config.navigate or window.location.assign
commerce.clientId()              // persistent anonymous id (X-Grigora-Checkout-Client)
commerce.getStorefrontLang()     // "en"
commerce.version; commerce.projectId; commerce.apiBase; commerce.config
commerce.destroy()
```
