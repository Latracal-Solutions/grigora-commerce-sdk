# @grigora/commerce-adapter-paddle

Paddle Billing adapter for Grigora Commerce checkout. The Grigora API creates a Paddle transaction for the order. This adapter opens Paddle.js on your page for it, as an overlay or as an inline form, depending on the store's "Checkout display" setting in Grigora.

```bash
npm install @grigora/commerce-adapter-paddle
```

```ts
import { registerProvider } from "@grigora/commerce-core";
import { paddleAdapter } from "@grigora/commerce-adapter-paddle";

registerProvider(paddleAdapter);
```

- **Overlay**: "Pay" opens Paddle's checkout over the page.
- **Inline**: Paddle's form is embedded in the checkout's payment step.
- **Paddle-hosted page**: the shopper goes to the order page and is forwarded to the hosted checkout you created in Paddle. Set that hosted checkout's redirect URL to your success page so the SDK can show the order when Paddle sends the shopper back.

The order is settled from Paddle's signed webhook. Nothing is confirmed from the browser. The order status view waits for the webhook and offers "Pay with Paddle" when a shopper reaches an unpaid Paddle order.

Paddle requirements: approve your site's domain in Paddle > Checkout, and allow `https://*.paddle.com https://*.paddle.io` in your CSP (`script-src`, `frame-src`, `connect-src`).

Loads `https://cdn.paddle.com/paddle/v2/paddle.js` on first use. Already included in `@grigora/commerce` and the CDN bundle. MIT.
