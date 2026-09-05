# @grigora/commerce-adapter-razorpay

Razorpay Checkout adapter for Grigora Commerce embedded checkout. Opens the Razorpay overlay for the order the Grigora API created and returns payment id and signature for server-side verification.

```bash
npm install @grigora/commerce-adapter-razorpay
```

```ts
import { registerProvider } from "@grigora/commerce-core";
import { razorpayAdapter } from "@grigora/commerce-adapter-razorpay";

registerProvider(razorpayAdapter);
```

Loads `https://checkout.razorpay.com/v1/checkout.js` on first use. Already included in `@grigora/commerce` and the CDN bundle. MIT.
