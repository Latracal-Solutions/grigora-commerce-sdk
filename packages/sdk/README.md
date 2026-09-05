# @grigora/commerce

The whole Grigora Commerce SDK in one package: headless core, drop-in UI, Stripe and Razorpay adapters, `createStorefront()`, and the single-script CDN bundle.

## Script tag (no build)

```html
<script src="https://cdn.grigora.co/commerce/v1/sdk.js" data-project="YOUR_PROJECT_ID" async></script>
<button data-grigora-add data-product-slug="blue-mug">Add to cart</button>
<a href="#" data-cart-open>Cart (<span data-cart-count>0</span>)</a>
```

Also on jsDelivr: `https://cdn.jsdelivr.net/npm/@grigora/commerce@0/dist/sdk.min.js`. Exposes `window.Grigora.Commerce` and flushes `window.Grigora.q`.

## npm

```bash
npm install @grigora/commerce
```

```ts
import { createStorefront } from "@grigora/commerce";
const commerce = createStorefront({ projectId: "YOUR_PROJECT_ID", ui: { checkoutUrl: "/checkout" } });
```

Everything from `@grigora/commerce-core`, `@grigora/commerce-ui` and both adapters is re-exported.

Docs: https://github.com/Latracal-Solutions/grigora-commerce-sdk. MIT.
