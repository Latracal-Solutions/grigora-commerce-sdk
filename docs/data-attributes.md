# Data attributes and custom elements

The zero-JavaScript surface. One delegated listener on `document` handles every attribute, so elements added later (carousels, framework re-renders, CMS blocks) work with no re-initialisation.

## Buttons and links

| Attribute | On | Does |
| --- | --- | --- |
| `data-grigora-add` | `<button>` / `<a>` | Adds the product to the cart, shows "Adding…" then "Added", opens the drawer. |
| `data-grigora-buy-now` | `<button>` / `<a>` | Sets the line to the given quantity and opens checkout. |
| `data-cart-open`, `data-cart-launch` | anything | Opens the cart (`data-cart-launch` is the legacy Grigora attribute; both work). |
| `data-cart-toggle` | anything | Toggles the drawer. |
| `data-cart-close` | anything | Closes the drawer. |
| `data-checkout-open` | anything | Opens checkout. |

Product reference (one required) and options for `data-grigora-add` / `data-grigora-buy-now`:

| Attribute | Meaning |
| --- | --- |
| `data-product-id` | Product id. |
| `data-product-slug` | Product slug; resolved through the catalog. |
| `data-variant-id` | Variant id. Required when the product has options. |
| `data-quantity` | Default `1`. |
| `data-replace="true"` | Set the quantity instead of adding to it. |
| `data-title`, `data-price` (minor units), `data-image`, `data-product-url`, `data-currency` | Optional display data for an instant render. The server's values replace them on validation. |
| `data-adding-label`, `data-added-label`, `data-keep-label` | Button feedback text; `data-keep-label` leaves the label alone. |

```html
<button data-grigora-add data-product-id="01H…" data-variant-id="01H…" data-quantity="2">Add two</button>
<button data-grigora-buy-now data-product-slug="blue-mug">Buy now</button>
```

Progressive enhancement: give a launcher a real `href="/cart"` and it still works if the script fails to load.

## Live values

| Attribute | Updated with |
| --- | --- |
| `data-cart-count` | Item count. Hidden at zero unless `data-show-zero`. |
| `data-cart-subtotal` | Formatted subtotal. |
| `data-cart-total` | Formatted total (subtotal until validated). |

## Mount points

These are upgraded into the matching custom element, including when added later:

| Attribute | Becomes |
| --- | --- |
| `data-grigora-buy-box` + `data-product-slug`/`data-product-id` | `<g-buy-box>` |
| `data-grigora-buy` + `data-product-id`/`data-product-slug` | `<g-buy-box>` (Grigora's legacy product-page slot) |
| `data-grigora-checkout` | `<g-checkout>` |
| `data-grigora-order-status` | `<g-order-status>` |
| `data-grigora-price` + product ref (+ `data-compare`) | `<g-price>` |
| `data-grigora-cart` | `<g-cart>` |

## Custom elements

All elements render into light DOM under a `[data-g-ui]` root and are styled by the injected stylesheet ([theming](./theming.md)).

### `<g-cart-drawer>`

The slide-in cart. Created automatically when `cartMode` is `drawer`; place your own to control where it sits in the DOM. Attributes: `open` (reflects state), `discount="off"` hides the discount field. Methods: `show(opener?)`, `hide()`, `toggle()`; property `open`.

Accessibility: `role="dialog"`, `aria-modal`, labelled by its heading, focus moves to the close button, Tab is trapped, Escape closes and returns focus, background is made `inert`, body scroll is locked, animation respects `prefers-reduced-motion`.

### `<g-cart>`

The same content rendered inline, for a dedicated cart page (`cartMode: "page"`).

### `<g-cart-badge>` / `<g-cart-launcher label="Cart">`

Live count badge (`show-zero` to always show) and a ready-made launcher button.

### `<g-buy-box product="slug-or-id" [variant] [quantity] [buy-now="off"] [show-price="off"]>`

Price (with compare-at strike-through), option chips with sold-out values marked, stock note, quantity stepper, Add to cart and Buy now. Pay-what-you-want products show an amount field and go straight to checkout after asking for an email. Fires `grigora:added` (`detail: { productId, variantId, quantity }`).

### `<g-add-to-cart product="slug" [variant] [quantity] [label]>`

A single styled button.

### `<g-price product="slug" [variant] [compare]>`

Formatted price text from the catalog.

### `<g-checkout>`

The whole checkout: contact, billing and shipping addresses (country lists limited to where the store ships), shipping method, discount code, live totals, and payment. Payment is embedded (Stripe Payment Element, Razorpay) when the store supports it and the adapter is present, hosted redirect otherwise. On return with `order_id` and `lookup_token` in the URL it renders the order status instead.

Place it on a `/checkout` page and set `checkoutUrl: "/checkout"`, or let the SDK open it as a dialog (the default).

### `<g-order-status [order-id] [lookup-token] [continue-url] [poll="off"]>`

Verifies the order through the public lookup, keeps polling while payment is pending, clears the cart only when the order is paid, shows the order reference, line items, total and invoice link. Reads `order_id`/`lookup_token` from the URL when the attributes are absent.

## Events on the instance

Every element reports through the commerce instance: `cart:changed`, `cart:opened`, `cart:closed`, `checkout:started`, `checkout:completed`, `order:paid`, `error`… See [errors and events](./errors-and-events.md).
