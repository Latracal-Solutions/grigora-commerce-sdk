# @grigora/commerce-vue

Vue 3 plugin and composables for Grigora Commerce. Use the shared web components (`<g-cart-drawer>`, `<g-buy-box>`, `<g-checkout>`…) directly in templates.

```bash
npm install @grigora/commerce-vue @grigora/commerce-adapter-stripe @grigora/commerce-adapter-razorpay
```

```ts
import { createGrigoraCommerce } from "@grigora/commerce-vue";
import { stripeAdapter } from "@grigora/commerce-adapter-stripe";

app.use(createGrigoraCommerce({ config: { projectId: "YOUR_PROJECT_ID" }, adapters: [stripeAdapter] }));
```

```vue
<script setup>
import { useCart } from "@grigora/commerce-vue";
const { count, add, open } = useCart();
</script>
```

Composables: `useCommerce`, `useCart`, `useStore`, `useProduct`, `useProducts`, `useCheckout`. Set `compilerOptions.isCustomElement = (tag) => tag.startsWith("g-")`.

Docs: [Vue guide](https://github.com/Latracal-Solutions/grigora-commerce-sdk/blob/main/docs/vue.md). MIT.
