# Checkout: hosted, embedded, free

## How the mode is decided

The store settings (`GET /storefront/:project/settings`) carry a server-computed `checkout.mode`:

| Store | Mode |
| --- | --- |
| Stripe with publishable key + webhook | `embedded` (Payment Element) |
| Stripe with `checkout_mode: stripe_hosted` or Stripe Tax | `hosted` (Stripe Checkout page) |
| Razorpay with key id + secret + webhook | `embedded` (overlay) |
| PayPal, credentials + webhook | `hosted` (redirect to PayPal) |
| Paystack, secret key + public key + confirmed webhook | `embedded` (Paystack popup) |
| Paystack, secret key + confirmed webhook, no public key | `hosted` (redirect to Paystack) |
| Paddle, API key + webhook + client-side token (overlay/inline) or hosted checkout link | `hosted`: the Paddle adapter opens Paddle.js on the page for the transaction (see below) |
| Anything missing | `unavailable`, with a merchant-facing `message` |

The SDK then applies the integrator's preference (`payment: "auto" | "embedded" | "hosted"`) and checks that an adapter for the provider is registered. The CDN bundle and `@grigora/commerce` ship Stripe, Razorpay, Paddle and Paystack adapters; a headless `@grigora/commerce-core` install without adapters always uses hosted.

If an embedded adapter's script fails to load (blocked by an extension, CSP, network), `<g-checkout>` cancels the pending order and restarts as hosted. Nothing is lost: the pending order held stock for a moment and was released.

## Paystack

The API initializes a Paystack transaction for the order (reference `grg-<order id>`). With the store's public key, the Paystack adapter resumes that transaction in Paystack's popup; without it, checkout redirects to Paystack's page for the same transaction and Paystack sends the shopper back to your success page. Either way the API confirms the payment by asking Paystack (`GET /transaction/verify`) and checks the reference, amount and currency against the order. The popup's success callback, the shopper's return and Paystack's signed `charge.success` webhook only trigger that check, so a late webhook does not leave a paid order pending.

Paystack signs webhooks with the store's secret key and keeps one webhook URL per mode. In Grigora the merchant adds the store's webhook URL in Paystack (Settings → API Keys & Webhooks) and confirms it; checkout stays closed until then. Paystack amounts are the base amount × 100 for every currency, the same minor units the SDK uses.

## Paddle

The API only creates Paddle checkouts as hosted sessions. A Paddle Billing transaction has no payment page of its own. Its checkout URL is your `successUrl` with `order_id`, `lookup_token` and `_ptxn` added, and that page has to open Paddle.js. What the shopper sees depends on the store's **Checkout display** setting in Grigora:

- **Overlay**: "Continue to payment" creates the order, then "Pay" opens Paddle's overlay on the checkout page.
- **Inline**: Paddle's form is embedded in the payment step and has its own pay button.
- **Paddle-hosted page**: the shopper goes to the order page, which forwards them to the hosted checkout created in Paddle. Paddle returns from a hosted checkout to one fixed redirect URL with no order reference. Set that redirect URL to your success page. The SDK saves the order right before leaving and shows its status when the shopper comes back.

The signed Paddle webhook settles the order. The SDK never confirms Paddle from the browser. It shows the status page, which waits for the webhook.

When a shopper reaches an unpaid Paddle order page (single-product checkout, Paddle.js blocked on the checkout page, or coming back later), `<g-order-status>` shows **Pay with Paddle** and opens Paddle again for the same transaction. This only happens in the browser that started the checkout, because Paddle's public setup comes from the session the SDK saved then. If Paddle.js cannot load during checkout, the SDK follows the transaction's checkout URL instead of creating a second order.

In Paddle: approve your site's domain in **Checkout > Website approval** and set a default payment link. Use the sandbox client-side token (`test_…`) while the store is in test mode.

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

When a shopper unchecks "Ship to my billing address", the separate shipping address reuses the email, name, and phone from Contact. Only the destination fields change. Headless `checkout.quote()` and cart checkout calls also inherit missing shipping contact fields from `billingAddress` when `sameAsBilling: false`; explicitly supplied recipient details are preserved. Missing destination fields still fail validation.

## On a phone

Below 860px the layout is one column: the order summary folds to a single line ("Order summary · $58.00") that expands on tap, form sections stack, inputs are 16px (no iOS zoom), and the pay button sticks to the bottom of the viewport. In the dialog placement the checkout goes full-screen below 640px.

## Return URLs

- Default `successUrl` is the current page. The SDK detects the return parameters on any page it runs on, so a single-page integration (Webflow, a landing page) needs no extra route.
- For Stripe redirect-based payment methods (bank redirects, wallets, 3DS) the Payment Element returns to `successUrl` with `payment_intent` appended; the SDK confirms it once (`handleReturn`) and then shows the status.
- The API only redirects to allow-listed origins: the store's Grigora domain, its custom domain, and **Storefront base URL** from Commerce settings. Set the latter for third-party sites.

## Idempotency and double charges

Every `/checkout/session`, `/checkout/embedded` and `/checkout/create` request carries an `Idempotency-Key` and a persistent `X-Grigora-Checkout-Client`. Retrying the same checkout replays the pending order instead of creating another; changing anything creates a new one and cancels the old. Confirmations (`/checkout/embedded/confirm`) are verified server-side (Stripe intent status, Razorpay signature) and the webhook settles the order regardless, so a confirm that fails after the provider took the payment still ends as a paid order on the status page.

## Testing

Use the provider's test mode in Grigora settings (`checkout.testMode` is exposed and shown as a "Test mode" pill in the checkout). Stripe test cards, Razorpay and Paystack test keys and the sandbox accounts of PayPal/Paddle all flow through the same code. Paddle loads its sandbox environment when the session says `environment: "sandbox"`.
