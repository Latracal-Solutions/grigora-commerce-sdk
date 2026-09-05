# Grigora Commerce SDK

Sell from a [Grigora](https://grigora.co) store on any website: a Grigora-built site, an AI-generated site, WordPress, Webflow, Framer, a React or Vue app, or a plain HTML page.

One script tag gives you a cart drawer, buy buttons, a complete checkout and an order status view. One npm package gives you the same as typed, tree-shakeable modules. A headless core underneath lets you build any storefront you like. Prices, stock, shipping, tax and payments are always decided and verified by the Grigora API; the SDK never holds a secret.

```html
<script src="https://cdn.grigora.co/commerce/v1/sdk.js" data-project="YOUR_PROJECT_ID" async></script>

<button data-grigora-add data-product-slug="blue-mug">Add to cart</button>
<a href="#" data-cart-open>Cart (<span data-cart-count>0</span>)</a>
```

That is a working store with checkout.

## Packages

| Package | What | Size (brotli) |
| --- | --- | --- |
| [`@grigora/commerce`](packages/sdk) | Everything: core + UI + Stripe + Razorpay adapters, `createStorefront()`, and the CDN bundle `dist/sdk.min.js` | bundle ≈ 35 kB |
| [`@grigora/commerce-core`](packages/core) | Headless client: cart, products, checkout, orders, currency, typed events. Zero dependencies, SSR-safe | ≈ 17 kB |
| [`@grigora/commerce-ui`](packages/ui) | Web components and data attributes: `<g-cart-drawer>`, `<g-buy-box>`, `<g-checkout>`, `<g-order-status>`… | ≈ 24 kB |
| [`@grigora/commerce-adapter-stripe`](packages/adapter-stripe) | Stripe Payment Element (embedded) | ≈ 1 kB |
| [`@grigora/commerce-adapter-razorpay`](packages/adapter-razorpay) | Razorpay Checkout (overlay) | ≈ 1 kB |
| [`@grigora/commerce-react`](packages/react) | Provider, hooks (`useCart`, `useProduct`…), components | ≈ 2.5 kB |
| [`@grigora/commerce-vue`](packages/vue) | Plugin and composables | ≈ 1 kB |

PayPal and Paddle are supported through the hosted redirect that is built into the core (the Grigora API has no embedded path for them). Budgets are enforced in CI with size-limit.

## Layers

```
sdk.js (CDN)  →  window.Grigora.Commerce, auto-init from <script data-project>
@grigora/commerce-react / -vue
@grigora/commerce-ui          drawer · badge · buy box · checkout · order status · data-* bindings
@grigora/commerce-core        client · cart · catalog · checkout · orders · currency · events · providers
adapters                      stripe (Payment Element) · razorpay (overlay) · hosted redirect (built in)
Grigora commerce API          https://api.grigora.co/general/commerce
```

## Quick starts

**Script tag** – see above; every option is a `data-*` attribute ([getting started](docs/getting-started.md)).

**npm, batteries included**

```ts
import { createStorefront } from "@grigora/commerce";
const commerce = createStorefront({ projectId: "YOUR_PROJECT_ID", ui: { checkoutUrl: "/checkout" } });
await commerce.cart.add({ productSlug: "blue-mug" });
```

**Headless**

```ts
import { createCommerce } from "@grigora/commerce-core";
const commerce = createCommerce({ projectId: "YOUR_PROJECT_ID" });
const { products, store } = await commerce.products.catalog();
await commerce.cart.add({ productId: products[0].id });
const session = await commerce.checkout.start({ billingAddress });   // hosted or embedded, per the store
```

**React**

```tsx
<GrigoraProvider config={{ projectId }} adapters={[stripeAdapter, razorpayAdapter]}>
  <AddToCartButton productSlug="blue-mug" />
  <CartDrawer />
</GrigoraProvider>
```

## What you get

- **Cart drawer** with live server totals, quantity steppers, stock badges, discount codes, empty and error states; `role="dialog"`, focus trap, Escape, inert background, reduced-motion aware.
- **Buy box** for product pages: price and compare-at, option chips with sold-out values marked, quantity, Add to cart / Buy now, pay-what-you-want.
- **Checkout**: contact, billing and shipping addresses validated with the API's own rules, shipping methods, discount, tax, then payment through the store's gateway: Stripe Payment Element or Razorpay in-page, hosted redirect for Stripe Checkout / PayPal / Paddle, and instant completion for free orders. Edits after a payment is prepared cancel the pending order automatically. Falls back to hosted if an embedded script is blocked.
- **Order status** that verifies the order through the API, polls while pending, and clears the cart only when paid.
- **Idempotent checkout** (`Idempotency-Key` + persistent client id) so retries never double-charge.
- **Compatibility** with Grigora's existing storefront scripts: same cart storage key and shape, same client id, same `data-cart-launch` / `data-cart-count` attributes ([migration](docs/migration-from-cart-js.md)).
- **Theming** with CSS variables and the store's own accent colour ([theming](docs/theming.md)); every string overridable.
- **Events** for analytics: `cart:changed`, `checkout:started`, `order:paid`… ([errors and events](docs/errors-and-events.md)).
- **AI-friendly**: [`llms.txt`](llms.txt) and a short [`skill.md`](skill.md) that lets a code generator produce a correct store from one instruction set.

## Documentation

- [Getting started](docs/getting-started.md) · [Data attributes and elements](docs/data-attributes.md) · [JavaScript API](docs/javascript-api.md)
- [Checkout](docs/checkout.md) · [Theming](docs/theming.md) · [Errors and events](docs/errors-and-events.md) · [Security and CSP](docs/security.md)
- [React](docs/react.md) · [Vue](docs/vue.md) · [Integrations](docs/integrations.md) (WordPress, Webflow, Framer, Bubble, Astro)
- [Migration from cart.js](docs/migration-from-cart-js.md) · [Backend API](docs/backend-api.md)
- Examples: [vanilla HTML](examples/vanilla/index.html) · [React](examples/react/App.tsx)

## Requirements

Evergreen browsers (last two Chrome/Edge/Firefox/Safari, iOS 15+): ES2020, `fetch`, `Intl.NumberFormat`, Custom Elements. Node 18+ for the packages. No IE11.

## Development

```bash
npm install
npm run check          # typecheck + tests + build + size budgets
npm test               # vitest (jsdom)
npm run build          # every package, in dependency order
```

Releases: `node scripts/set-version.mjs X.Y.Z`, commit, tag `vX.Y.Z`, push. The release workflow publishes every package to npm with provenance and uploads the CDN bundle to `cdn.grigora.co/commerce/{vX,X.Y.Z,latest}/sdk.js`. See [CONTRIBUTING](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Latracal Solutions (Grigora)
