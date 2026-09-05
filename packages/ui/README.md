# @grigora/commerce-ui

Drop-in storefront UI for Grigora Commerce as web components and data attributes: `<g-cart-drawer>`, `<g-cart>`, `<g-cart-badge>`, `<g-cart-launcher>`, `<g-buy-box>`, `<g-add-to-cart>`, `<g-price>`, `<g-checkout>`, `<g-order-status>`, plus `data-grigora-add`, `data-cart-open`, `data-cart-count`… Accessible, themeable with CSS variables, no framework required.

```bash
npm install @grigora/commerce-core @grigora/commerce-ui
```

```ts
import { createCommerce } from "@grigora/commerce-core";
import { installUI } from "@grigora/commerce-ui";

const commerce = createCommerce({ projectId: "YOUR_PROJECT_ID" });
installUI(commerce, { checkoutUrl: "/checkout" });
```

```html
<button data-grigora-add data-product-slug="blue-mug">Add to cart</button>
<g-buy-box product="blue-mug"></g-buy-box>
<g-checkout></g-checkout>
```

Register payment adapters (`@grigora/commerce-adapter-stripe`, `@grigora/commerce-adapter-razorpay`) for in-page payment; without them the checkout uses the store's hosted page.

Docs: [Data attributes and elements](https://github.com/Latracal-Solutions/grigora-commerce-sdk/blob/main/docs/data-attributes.md) · [Theming](https://github.com/Latracal-Solutions/grigora-commerce-sdk/blob/main/docs/theming.md). MIT.
