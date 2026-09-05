# Security

## What the SDK never does

- Hold secrets. It only ever sees publishable keys (Stripe `pk_…`, Razorpay key id) that the store settings endpoint returns. Secret keys, webhook secrets and API keys never leave the Grigora API.
- Trust the page for money. Prices, stock, shipping, tax and totals are computed by the API from product ids and quantities. `data-price` and friends are display hints only.
- Handle card data. Stripe renders its Payment Element in its own iframe; Razorpay opens its own overlay; hosted providers run on their own pages. Merchants stay in PCI SAQ-A scope.
- Put personal data in URLs. Only `order_id` and a capability token (`lookup_token`) travel in the success URL, and the token is required to read the order.
- Render API text as HTML. Titles, messages and images go through `textContent`/`setAttribute`; image and link URLs are checked to be `http(s)` or relative.

## Replay protection

Every checkout POST carries `Idempotency-Key` (a UUID per distinct checkout attempt) and `X-Grigora-Checkout-Client` (a persistent anonymous id). The API replays the pending order for a repeated key and refuses a reused key with a different payload.

## Content-Security-Policy

If your site sends a CSP, allow:

```
script-src  https://cdn.grigora.co https://js.stripe.com https://checkout.razorpay.com
connect-src https://api.grigora.co https://api.stripe.com https://r.stripe.com https://checkout.razorpay.com https://lumberjack.razorpay.com
frame-src   https://js.stripe.com https://hooks.stripe.com https://checkout.razorpay.com https://api.razorpay.com
img-src     https: data:
style-src   'unsafe-inline'   (the SDK injects one <style>; or set data-styles="false" and ship the CSS yourself)
```

PayPal and Paddle are hosted redirects and need nothing in your CSP. Add `https://cdn.jsdelivr.net` if you load the bundle from jsDelivr.

## Return URL allow-list

The API only redirects back to the store's own origins (Grigora subdomain, custom domain, and the configured Storefront base URL). A third-party site must be set as Storefront base URL, or shoppers land on the store's Grigora domain after paying. `commerce.store.get()` → `storefrontOrigins` shows the current list.

## Reporting

See [SECURITY.md](../SECURITY.md) in the repository root.
