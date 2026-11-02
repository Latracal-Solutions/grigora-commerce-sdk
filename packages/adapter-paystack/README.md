# @grigora/commerce-adapter-paystack

Paystack Popup adapter for Grigora Commerce embedded checkout. Opens the Paystack popup for the transaction the Grigora API initialized and returns its reference, which the API verifies with Paystack before the order is marked paid.

```bash
npm install @grigora/commerce-adapter-paystack
```

```ts
import { registerProvider } from "@grigora/commerce-core";
import { paystackAdapter } from "@grigora/commerce-adapter-paystack";

registerProvider(paystackAdapter);
```

Loads `https://js.paystack.co/v2/inline.js` on first use. The store needs the Paystack public key in Commerce settings for the popup; without it checkout redirects to Paystack's own page. Already included in `@grigora/commerce` and the CDN bundle. MIT.
