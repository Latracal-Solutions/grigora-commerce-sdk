# Vue 3 (`@grigora/commerce-vue`)

```bash
npm install @grigora/commerce-vue @grigora/commerce-adapter-stripe @grigora/commerce-adapter-razorpay
```

```ts
// main.ts
import { createApp } from "vue";
import { createGrigoraCommerce } from "@grigora/commerce-vue";
import { stripeAdapter } from "@grigora/commerce-adapter-stripe";
import { razorpayAdapter } from "@grigora/commerce-adapter-razorpay";
import App from "./App.vue";

createApp(App)
  .use(createGrigoraCommerce({
    config: { projectId: "YOUR_PROJECT_ID" },
    adapters: [stripeAdapter, razorpayAdapter],
    uiOptions: { checkoutUrl: "/checkout" },
  }))
  .mount("#app");
```

Tell the compiler the SDK's tags are custom elements (Vite):

```ts
// vite.config.ts
vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("g-") } } })
```

Then use them directly in templates:

```vue
<script setup lang="ts">
import { useCart, useProduct } from "@grigora/commerce-vue";
const { count, add, open } = useCart();
const { data: product } = useProduct("blue-mug");
</script>

<template>
  <button @click="open()">Cart ({{ count }})</button>
  <h1 v-if="product">{{ product.title }} — {{ product.priceFormatted }}</h1>
  <button v-if="product" @click="add({ productId: product.id })">Add to cart</button>
  <g-buy-box product="blue-mug"></g-buy-box>
  <g-cart-drawer></g-cart-drawer>
</template>
```

## Composables

| Composable | Returns |
| --- | --- |
| `useCommerce()` | the instance (throws if the plugin is not installed) |
| `useCart()` | `{ cart: ShallowRef<Cart>, count, isEmpty, add, update, remove, clear, setDiscount, validate, open, close, formatCurrency }` |
| `useStore()` | `{ data, loading, error, reload }` |
| `useProduct(idOrSlug | Ref)` | `{ data, loading, error, reload }`, reloads when the ref changes |
| `useProducts(params | Ref)` | `{ data, total, nextCursor, loading, error, reload }` |
| `useCheckout()` | the `CheckoutAPI` |

`$grigora` is also available on component instances.

## SSR (Nuxt)

The plugin installs the UI only in the browser (`isBrowser()`), so it is safe to register in a universal plugin. Composables that read the cart return the empty cart on the server; wrap DOM-only pieces in `<ClientOnly>`.
