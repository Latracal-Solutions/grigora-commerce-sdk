# Skill: add Grigora Commerce to any website

You are building or editing a website that sells products from a Grigora store. Use the Grigora Commerce SDK. Do not write your own cart, checkout, payment or price logic; the SDK and the Grigora API own all of that and every price is verified server-side.

## 1. Load the SDK once

Put this in `<head>` (once per page / layout):

```html
<script src="https://cdn.grigora.co/commerce/v1/sdk.js" data-project="PROJECT_ID" async></script>
```

- `PROJECT_ID` is the Grigora project id. On a Grigora-published site it can be omitted (the SDK reads `<html data-g-project>`).
- Add `data-checkout-url="/checkout"` only if the site has a `/checkout` page containing `<g-checkout></g-checkout>`. Otherwise the checkout opens as a dialog and needs no page.
- Add `data-success-url="/thank-you"` only if the site has a `/thank-you` page containing `<g-order-status></g-order-status>`. Otherwise the shopper returns to the page they paid from and sees the order status there.

## 2. Get the products

Fetch the catalog at build time or in the browser:

```
GET https://api.grigora.co/general/commerce/storefront/PROJECT_ID/catalog
→ { "Output": { "store": {...}, "products": [...], "collections": [...] } }
```

Each product has `id`, `slug`, `title`, `description`, `price_amount` (integer minor units: 2999 = 29.99), `currency`, `image_url`, `images[]`, `in_stock`, `has_variants`, `options[]`, `variants[]`, `collections[]` (slugs). Never invent products or prices; render what the API returns and format prices from `price_amount` (`/100`) in `currency`, or use `<g-price product="SLUG"></g-price>`.

## 3. Mark up the store

Cart opener (header):

```html
<a href="#" data-cart-open>Cart (<span data-cart-count>0</span>)</a>
```

Product card (list / grid):

```html
<button data-grigora-add data-product-slug="SLUG">Add to cart</button>
```

Product page (variants, quantity, add, buy now — all handled):

```html
<g-buy-box product="SLUG"></g-buy-box>
```

A product with `has_variants: true` needs `<g-buy-box>` (or a `data-variant-id` on the button); a plain `data-grigora-add` without a variant will be refused.

Optional pages:

- `/checkout`: `<g-checkout></g-checkout>` (only with `data-checkout-url`).
- `/thank-you`: `<g-order-status></g-order-status>` (only with `data-success-url`).
- `/cart`: `<g-cart></g-cart>` with `data-cart-mode="page"` on the script.

## 4. Style it

The UI inherits the page font and uses CSS variables. Set them on `:root` to match the design:

```css
:root { --g-accent: #BRAND; --g-accent-contrast: #fff; --g-radius: 8px; }
```

Class names for deeper styling: `.g-btn-primary`, `.g-cart-drawer`, `.g-cart-line`, `.g-checkout-layout`, `.g-buybox`, `.g-chip`.

## Rules

- Amounts are integers in minor units. Never compute totals yourself; the drawer and checkout show server totals.
- Never put secret keys in the page. The SDK only uses publishable keys the store exposes.
- Never build your own cart storage, checkout form or payment form.
- Use `data-product-slug` (or `data-product-id`) from the catalog only.
- The payment provider is chosen by the merchant; the SDK handles Stripe, Razorpay, PayPal and Paddle.
- Reserved when using the platform pages on a Grigora site: `/cart`, `/checkout`, `/thank-you`, `/invoice`.

## Advanced (JavaScript)

```html
<script>
  window.Grigora = window.Grigora || { q: [] };
  Grigora.q.push(function () {
    Grigora.Commerce.onReady(function (c) {
      c.cart.add({ productSlug: "SLUG", quantity: 1 });       // add
      c.on("order:paid", function (order) { /* analytics */ });
      c.ui.openCart(); c.ui.openCheckout();                   // UI controls
    });
  });
</script>
```

Full docs: https://github.com/Latracal-Solutions/grigora-commerce-sdk
