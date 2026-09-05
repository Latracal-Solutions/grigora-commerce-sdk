# Errors and events

## `GrigoraError`

```ts
class GrigoraError extends Error {
  code: GrigoraErrorCode;
  httpStatus?: number;
  retryAfter?: number;   // seconds, from Retry-After on 429
  details?: unknown;     // the API's { code, message, ... } payload
  isRetryable: boolean;
}
```

`message` is the API's human-readable text where there is one and is safe to show to a shopper.

| Code | When |
| --- | --- |
| `network_error`, `timeout` | Could not reach the API (GETs retry 3× with backoff; POSTs never retry). |
| `rate_limited` | 429. `retryAfter` is set. |
| `out_of_stock` | 409 on checkout; `details.out_of_stock` lists the lines. |
| `invalid_address` | A billing/shipping field the API rejects; `details.field` / `details.scope` when raised client-side. |
| `mixed_currency` | Cart lines in two currencies. |
| `non_one_time_pricing` | A subscription or pay-what-you-want product in a cart checkout. |
| `invalid_discount` | Code unknown, expired, or not applicable. |
| `cart_empty` | Checkout with nothing in the cart. |
| `checkout_unavailable` | The store has no ready gateway for this mode; `message` says what the merchant must finish. |
| `checkout_in_progress` | The same idempotency key is still being processed; retry with the same inputs. |
| `checkout_failed` | Any other checkout creation failure. |
| `payment_failed` | Provider or confirmation failure. |
| `product_unavailable` | Product no longer sold / variant unavailable. |
| `variant_required` | Product has options but none chosen. |
| `not_found`, `unauthorized`, `validation_error`, `provider_error`, `unknown` | As named. |

## Events

Subscribe with `commerce.on(event, handler)`; it returns an unsubscribe function.

| Event | Payload |
| --- | --- |
| `ready` | the instance (default instance only, after `init`) |
| `cart:changed` | `Cart` – after every local mutation and every server validation |
| `cart:validated` | `Cart` – after a successful `/cart/validate` |
| `cart:error` | `GrigoraError` |
| `cart:line_added` | `{ line, cart }` |
| `cart:line_removed` | `{ lineId, cart }` |
| `cart:discount_removed` | `{ code, error }` – a stored code the server no longer accepts |
| `cart:opened`, `cart:closed` | `Cart` (from the UI) |
| `store:loaded` | `StoreSettings` |
| `checkout:started` | `CheckoutSession` |
| `checkout:completed` | `{ orderId, lookupToken, order }` – free order created, or embedded payment confirmed |
| `checkout:failed` | `GrigoraError` |
| `checkout:cancelled` | `{ orderId }` – pending order released |
| `order:paid` | `Order` – the status view verified a paid order (cart cleared) |
| `error` | `GrigoraError` – mirror of `cart:error` and `checkout:failed` |

DOM events from elements: `grigora:added` (bubbles from the button or buy box, `detail: { productId, variantId, quantity }`).

## Analytics example

```js
Grigora.Commerce.onReady((c) => {
  c.on("cart:line_added", ({ line }) => gtag("event", "add_to_cart", { items: [{ item_id: line.productId, quantity: line.quantity }] }));
  c.on("checkout:started", (s) => gtag("event", "begin_checkout", { value: s.amount / 100, currency: s.currency }));
  c.on("order:paid", (order) => gtag("event", "purchase", { transaction_id: order.orderId, value: order.totalAmount / 100, currency: order.currency }));
});
```
