# Migrating from the platform `cart.js`

Grigora-published sites ship a small `cart.js` plus a buy widget injected into product pages. The SDK replaces both without a data migration.

## What stays the same

- **Storage**: the SDK reads and writes `localStorage["grigora-cart-<projectId>"]` in the same array shape (`product_id`, `variant_id`, `quantity`, `title`, `price`, `currency`, `image`, `product_url`, `slug`, `in_stock`, `requires_shipping`) and the same discount key (`…-discount`). Existing carts are picked up as-is; pages still running the old scripts see the SDK's cart.
- **Client id**: `localStorage["grigora-commerce-client-v1"]`, the checkout replay-protection id, is shared.
- **Attributes**: `[data-cart-launch]` and `[data-cart-count]` keep working (`data-cart-open` is the new name).
- **Routes**: the platform `/checkout` and `/thank-you` pages continue to work with an SDK cart.
- **Project id**: read from `<html data-g-project>`.

## What changes

| `cart.js` | SDK |
| --- | --- |
| Drawer markup created by `cart.js` with `g-cart-*` classes styled by the theme | `<g-cart-drawer>` with the same class names, styled by the SDK stylesheet (scoped under `[data-g-ui]`), themed with `--g-*` variables. |
| Checkout button navigates to `/checkout` | Opens the SDK checkout dialog by default; set `data-checkout-url="/checkout"` to keep navigating. |
| Buy widget injected at publish into `[data-grigora-buy]` | `<g-buy-box product="slug">` (a `[data-grigora-buy][data-product-slug]` element is upgraded automatically). |
| Prices re-validated on drawer open | Same, plus after every change, with optimistic updates in between. |
| No events | Typed events: `cart:changed`, `checkout:completed`, `order:paid`… |

## Steps

1. Add the script tag to the site `<head>` (or the published site's custom code):
   `<script src="https://cdn.grigora.co/commerce/v1/sdk.js" async></script>` — no `data-project` needed on a Grigora site.
2. Remove the old `cart.js` include if you control it (harmless if both load; the SDK's drawer takes precedence visually).
3. Replace injected buy widgets with `<g-buy-box product="{slug}">` where you render product pages.
4. Optionally keep the platform checkout page by setting `data-checkout-url="/checkout"`.

## Visual parity

The SDK drawer keeps the right-side slide-in, 420px width, header/lines/footer layout and the `g-cart-line`, `g-cart-thumb`, `g-cart-qty`, `g-cart-checkout` class names. Colours default to the store's accent. Anything else is a CSS variable away ([theming](./theming.md)).
