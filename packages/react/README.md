# @grigora/commerce-react

React provider, hooks and components for Grigora Commerce. SSR-safe (the instance is created on the client), thin wrappers around the shared web components for the drop-in UI.

```bash
npm install @grigora/commerce-react @grigora/commerce-adapter-stripe @grigora/commerce-adapter-razorpay
```

```tsx
import { GrigoraProvider, AddToCartButton, CartLauncher, CartDrawer, useCart } from "@grigora/commerce-react";
import { stripeAdapter } from "@grigora/commerce-adapter-stripe";

<GrigoraProvider config={{ projectId: "YOUR_PROJECT_ID" }} adapters={[stripeAdapter]}>
  <CartLauncher />
  <AddToCartButton productSlug="blue-mug">Add to cart</AddToCartButton>
  <CartDrawer />
</GrigoraProvider>
```

Hooks: `useCommerce`, `useCart`, `useStore`, `useProduct`, `useProducts`, `useCollections`, `useCheckout`. Components: `AddToCartButton`, `BuyNowButton`, `CartBadge`, `CartLauncher`, `CartDrawer`, `CartView`, `BuyBox`, `Checkout`, `OrderStatus`, `Price`.

Docs: [React guide](https://github.com/Latracal-Solutions/grigora-commerce-sdk/blob/main/docs/react.md). MIT.
