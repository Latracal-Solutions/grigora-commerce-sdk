# Checkout: hosted, embedded, free

## How the mode is decided

The store settings (`GET /storefront/:project/settings`) carry a server-computed `checkout.mode`:

| Store | Mode |
| --- | --- |
| Stripe with publishable key + webhook | `embedded` (Payment Element) |
| Stripe with `checkout_mode: stripe_hosted` or Stripe Tax | `hosted` (Stripe Checkout page) |
| Razorpay with key id + secret + webhook | `embedded` (overlay) |
| PayPal or Paddle, credentials + webhook | `hosted` (the API has no embedded path for them) |
| Anything missing | `unavailable`, with a merchant-facing `message` |

The SDK then applies the integrator's preference (`payment: "auto" | "embedded" | "hosted"`) and checks that an adapter for the provider is registered. The CDN bundle and `@grigora/commerce` ship Stripe and Razorpay adapters; a headless `@grigora/commerce-core` install without adapters always uses hosted.

If an embedded adapter's script fails to load (blocked by an extension, CSP, network), `<g-checkout>` cancels the pending order and restarts as hosted. Nothing is lost: the pending order held stock for a moment and was released.

## Free carts

When the total is 0 (free products, or a 100% discount) the API completes the order immediately and returns `mode: "free"` with a `checkoutUrl` pointing at the thank-you page including `order_id` and `lookup_token`. No provider is involved.

## Single-product checkout

`checkout.startSingle({ slug, customerEmail, amount? })` uses `POST /checkout/create` for one product, including pay-what-you-want products (`amount` in minor units). It returns a hosted `checkoutUrl`. The buy box uses this for pay-what-you-want after asking for an email.

Subscriptions are not sellable through the public API yet; the buy box shows them disabled.

## What the shopper sees

1. **Details** – contact (email, name, phone) and billing address. Shipping address when the cart has physical items, defaulting to "ship to my billing address". Country lists are limited to where the store ships. Fields are validated with the API's own rules as the shopper leaves them; the first invalid field is focused on submit.
2. **Totals** – updated from `POST /cart/validate` as the address changes (debounced), with the shipping methods the store offers for that address and the discount field. Totals marked "estimated" until the server can price them exactly.
3. **Payment** – "Continue to payment" creates the order and mounts the payment form (embedded) or redirects (hosted). Editing anything after that cancels the pending order (`POST /checkout/cancel`) and goes back to step 1 with a note.
4. **Return** – the shopper lands on `successUrl` with `order_id` and `lookup_token`. `<g-order-status>` (or the automatic dialog) verifies the order through `POST /orders/lookup`, polls while pending, clears the cart when paid.

## On a phone

Below 860px the layout is one column: the order summary folds to a single line ("Order summary · $58.00") that expands on tap, form sections stack, inputs are 16px (no iOS zoom), and the pay button sticks to the bottom of the viewport. In the dialog placement the checkout goes full-screen below 640px.

## Return URLs

- Default `successUrl` is the current page. The SDK detects the return parameters on any page it runs on, so a single-page integration (Webflow, a landing page) needs no extra route.
- For Stripe redirect-based payment methods (bank redirects, wallets, 3DS) the Payment Element returns to `successUrl` with `payment_intent` appended; the SDK confirms it once (`handleReturn`) and then shows the status.
- The API only redirects to allow-listed origins: the store's Grigora domain, its custom domain, and **Storefront base URL** from Commerce settings. Set the latter for third-party sites.

## Idempotency and double charges

Every `/checkout/session`, `/checkout/embedded` and `/checkout/create` request carries an `Idempotency-Key` and a persistent `X-Grigora-Checkout-Client`. Retrying the same checkout replays the pending order instead of creating another; changing anything creates a new one and cancels the old. Confirmations (`/checkout/embedded/confirm`) are verified server-side (Stripe intent status, Razorpay signature) and the webhook settles the order regardless, so a confirm that fails after the provider took the payment still ends as a paid order on the status page.

## Testing

Use the provider's test mode in Grigora settings (`checkout.testMode` is exposed and shown as a "Test mode" pill in the checkout). Stripe test cards, Razorpay test keys and the sandbox accounts of PayPal/Paddle all flow through the same code.
