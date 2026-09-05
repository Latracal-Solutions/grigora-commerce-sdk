# @grigora/commerce-adapter-stripe

Stripe Payment Element adapter for Grigora Commerce embedded checkout. Mounts the Payment Element against the PaymentIntent the Grigora API creates, confirms with `redirect: "if_required"`, and hands the intent id back for server-side verification.

```bash
npm install @grigora/commerce-adapter-stripe
```

```ts
import { registerProvider } from "@grigora/commerce-core";
import { stripeAdapter, createStripeAdapter } from "@grigora/commerce-adapter-stripe";

registerProvider(stripeAdapter);
// or with options
registerProvider(createStripeAdapter({ layout: "accordion", appearance: { theme: "night" } }));
```

Loads `https://js.stripe.com/v3/` on first use. Already included in `@grigora/commerce` and the CDN bundle. MIT.
