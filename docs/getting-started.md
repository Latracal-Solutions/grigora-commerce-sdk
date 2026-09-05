# Getting started

Grigora Commerce SDK turns any page into a storefront for a Grigora store: a cart drawer, buy buttons, a full checkout, and an order status view, all talking to the Grigora commerce API. Nothing here holds secrets or moves money; every amount is re-derived and every payment is verified server-side.

There are three ways in. Pick the one that matches your stack.

## 1. One script tag (any site, no build)

```html
<script
  src="https://cdn.grigora.co/commerce/v1/sdk.js"
  data-project="YOUR_PROJECT_ID"
  async></script>

<button data-grigora-add data-product-slug="blue-mug">Add to cart</button>
<a href="#" data-cart-open>Cart (<span data-cart-count>0</span>)</a>
```

That is a working store. Add to cart opens a drawer; its Checkout button opens the checkout as a dialog on the same page; after paying, the shopper returns to the page and sees their order status. Everything is styled and accessible out of the box, and you can restyle it with CSS variables ([theming](./theming.md)).

Find your project id in the Grigora dashboard URL, or in `<html data-g-project="…">` on a published Grigora site (the SDK reads that attribute automatically when `data-project` is absent).

### Script attributes

| Attribute | Default | Meaning |
| --- | --- | --- |
| `data-project` | from `<html data-g-project>` | Project id. |
| `data-payment` | `auto` | `auto` (embedded when the store supports it, else hosted), `embedded`, or `hosted`. |
| `data-checkout-url` | (dialog) | Set to e.g. `/checkout` to send shoppers to a page that contains `<g-checkout>` instead of opening a dialog. |
| `data-checkout-placement` | `dialog`, or `page` when `data-checkout-url` is set | Force one or the other. |
| `data-cart-mode` | `drawer` | `drawer`, `page` (launcher goes to `data-cart-url`, default `/cart`, which contains `<g-cart>`), or `none`. |
| `data-success-url` | current page | Where the shopper lands after paying. The SDK reads `order_id`/`lookup_token` from any page it is installed on. |
| `data-cancel-url` | current URL | Where a cancelled hosted checkout returns. |
| `data-auto-open` | `true` | Open the drawer after add to cart. |
| `data-accent`, `data-font`, `data-radius` | store accent / inherit / `10px` | Quick theme overrides. |
| `data-continue-url` | `/` | "Continue shopping" destination. |
| `data-currency`, `data-locale` | store currency / `navigator.language` | Formatting before the store settings load. |
| `data-api-base` | `https://api.grigora.co` | API origin (`http://localhost:2706` on localhost). |
| `data-ui` | `true` | `false` for a headless install (no drawer, no bindings, no styles). |
| `data-autobind`, `data-styles`, `data-handle-return` | `true` | Turn individual UI features off. |
| `data-debug` | `false` | Console logging. |

The script is safe to load `async`. Code that runs before it has loaded can queue itself:

```html
<script>
  window.Grigora = window.Grigora || { q: [] };
  Grigora.q.push(function () {
    Grigora.Commerce.onReady(function (commerce) {
      commerce.cart.add({ productSlug: "blue-mug" });
    });
  });
</script>
```

Pin a version if you need reproducible loads: `/commerce/0.1.0/sdk.js` (immutable) or `/commerce/v1/sdk.js` (latest non-breaking). jsDelivr mirrors the npm package too: `https://cdn.jsdelivr.net/npm/@grigora/commerce@0/dist/sdk.min.js`.

## 2. npm, batteries included

```bash
npm install @grigora/commerce
```

```ts
import { createStorefront } from "@grigora/commerce";

const commerce = createStorefront({
  projectId: "YOUR_PROJECT_ID",
  ui: { checkoutUrl: "/checkout" },
});

await commerce.cart.add({ productSlug: "blue-mug", quantity: 2 });
commerce.on("checkout:completed", ({ orderId }) => console.log("paid", orderId));
```

`createStorefront` = core instance + Stripe and Razorpay adapters + drop-in UI. The same custom elements as the CDN build are available: `<g-cart-drawer>`, `<g-cart>`, `<g-cart-badge>`, `<g-cart-launcher>`, `<g-buy-box product="…">`, `<g-add-to-cart product="…">`, `<g-price product="…">`, `<g-checkout>`, `<g-order-status>`.

## 3. Headless core

```bash
npm install @grigora/commerce-core
```

```ts
import { createCommerce } from "@grigora/commerce-core";

const commerce = createCommerce({ projectId: "YOUR_PROJECT_ID" });
const { products } = await commerce.products.catalog();
await commerce.cart.add({ productId: products[0].id });
const session = await commerce.checkout.start({ billingAddress });
```

No DOM, no styles, SSR-safe. See the [JavaScript API](./javascript-api.md).

## Framework wrappers

- React: [`@grigora/commerce-react`](./react.md)
- Vue 3: [`@grigora/commerce-vue`](./vue.md)

## Before you go live

1. Connect a payment provider in Grigora → Commerce → Settings, including its webhook. The SDK asks the store which gateway is ready and refuses to start a checkout otherwise (`checkout_unavailable`).
2. If the SDK runs on a domain that is not the site's Grigora domain (a WordPress site, a Webflow site), set **Storefront base URL** in Commerce settings to that origin. The API only redirects back to allow-listed origins after payment; `commerce.store.get()` returns `storefrontOrigins` so you can check.
3. Add the [CSP entries](./security.md) if your site sends a Content-Security-Policy.
