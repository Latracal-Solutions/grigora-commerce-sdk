# @grigora/commerce-core

Headless client for Grigora Commerce: cart (localStorage, server-validated), products and store settings, checkout (hosted, embedded, free, single-product), orders, discounts, availability, currency formatting, typed events and a payment-adapter registry. Zero dependencies, import-safe in Node and during SSR.

```bash
npm install @grigora/commerce-core
```

```ts
import { createCommerce } from "@grigora/commerce-core";

const commerce = createCommerce({ projectId: "YOUR_PROJECT_ID" });
const { products } = await commerce.products.catalog();
await commerce.cart.add({ productId: products[0].id, quantity: 2 });
commerce.on("cart:changed", (cart) => console.log(cart.totalAmount));
const session = await commerce.checkout.start({ billingAddress: { /* … */ } });
```

Docs: [JavaScript API](https://github.com/Latracal-Solutions/grigora-commerce-sdk/blob/main/docs/javascript-api.md) · [Checkout](https://github.com/Latracal-Solutions/grigora-commerce-sdk/blob/main/docs/checkout.md) · [Errors and events](https://github.com/Latracal-Solutions/grigora-commerce-sdk/blob/main/docs/errors-and-events.md)

Pair with [`@grigora/commerce-ui`](https://www.npmjs.com/package/@grigora/commerce-ui) for the drop-in UI, or install [`@grigora/commerce`](https://www.npmjs.com/package/@grigora/commerce) for everything at once. MIT.
