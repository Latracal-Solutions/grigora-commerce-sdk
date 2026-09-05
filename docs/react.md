# React (`@grigora/commerce-react`)

```bash
npm install @grigora/commerce-react @grigora/commerce-adapter-stripe @grigora/commerce-adapter-razorpay
```

```tsx
import { GrigoraProvider, AddToCartButton, CartLauncher, CartDrawer, useCart } from "@grigora/commerce-react";
import { stripeAdapter } from "@grigora/commerce-adapter-stripe";
import { razorpayAdapter } from "@grigora/commerce-adapter-razorpay";

export default function App() {
  return (
    <GrigoraProvider
      config={{ projectId: "YOUR_PROJECT_ID" }}
      adapters={[stripeAdapter, razorpayAdapter]}
      uiOptions={{ checkoutUrl: "/checkout" }}
    >
      <Header />
      <AddToCartButton productSlug="blue-mug" className="btn">Add to cart</AddToCartButton>
      <CartDrawer />
    </GrigoraProvider>
  );
}

function Header() {
  const { count } = useCart();
  return <CartLauncher className="btn">Cart ({count})</CartLauncher>;
}
```

## SSR and hydration

`GrigoraProvider` creates the instance inside `useEffect`, so nothing touches `window`, `localStorage` or the network during server rendering. Until then `useCart()` returns `{ cart: null, ready: false, count: 0 }` and the UI components render a placeholder `<div>`; there is no hydration mismatch. Works with Next.js (app or pages router), Remix, Astro islands and plain Vite.

Pass `commerce={instance}` instead of `config` to share an instance you created yourself (for example one that also runs the CDN bundle's global). Pass `ui={false}` for a fully headless tree.

## Hooks

| Hook | Returns |
| --- | --- |
| `useCommerce()` | the instance, or `null` before mount |
| `useCart()` | `{ cart, ready, count, isEmpty, add, update, remove, clear, setDiscount, validate, open, close, formatCurrency }` |
| `useStore()` | `{ data: StoreSettings, loading, error, reload }` |
| `useProduct(idOrSlug)` | `{ data: Product, loading, error, reload }` |
| `useProducts(params)` | `{ data: Product[], total, nextCursor, loading, error, reload }` |
| `useCollections()` | `{ data: Collection[], … }` |
| `useCheckout()` | the `CheckoutAPI` for a fully custom checkout |
| `useMounted()` | `true` after the first client render |

`useCart` uses `useSyncExternalStore`, so every component subscribed to the cart re-renders exactly once per change.

## Components

| Component | Props |
| --- | --- |
| `<AddToCartButton>` | `productId` / `productSlug`, `variantId`, `quantity`, `buyNow`, `onAdded`, `onError`, `addingLabel`, `addedLabel` + any `<button>` prop |
| `<BuyNowButton>` | same, opens checkout after adding |
| `<CartBadge showZero?>` | live count `<span data-cart-count>` |
| `<CartLauncher>` | button that opens the cart, with the badge |
| `<CartDrawer discount?>` | `<g-cart-drawer>` |
| `<CartView>` | `<g-cart>` inline |
| `<BuyBox product variant? quantity? buyNow? showPrice?>` | `<g-buy-box>` |
| `<Checkout>` | `<g-checkout>` |
| `<OrderStatus orderId? lookupToken? continueUrl?>` | `<g-order-status>` |
| `<Price product variant? compare?>` | formatted price |

The drop-in components are thin wrappers around the custom elements from `@grigora/commerce-ui`, so they look identical to the CDN build and are themed with the same [CSS variables](./theming.md).

## A custom storefront

```tsx
function Product({ slug }: { slug: string }) {
  const { data: product } = useProduct(slug);
  const { add, formatCurrency } = useCart();
  if (!product) return null;
  return (
    <article>
      <img src={product.images[0]} alt={product.title} />
      <h1>{product.title}</h1>
      <p>{product.priceFormatted}</p>
      <button onClick={() => add({ productId: product.id, variantId: product.variants[0]?.id })}>Add</button>
    </article>
  );
}
```

For a custom checkout use `useCheckout()` and the [headless flow](./javascript-api.md#commercecheckout); or render `<Checkout />` on your `/checkout` route and keep everything else custom.

## Next.js note

Put the provider in a client component (`"use client"`). Set `uiOptions.checkoutUrl` to your checkout route and pass `config.navigate={(url) => router.push(url)}` if you prefer client-side navigation for the success page (hosted provider redirects always leave the page).
