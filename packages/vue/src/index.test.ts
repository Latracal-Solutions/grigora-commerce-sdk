import { createApp, defineComponent, h, nextTick } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorageAdapter } from "@grigora/commerce-core";
import { catalogLine, fakeFetch, serverLine, validateResponse, STORE, type FakeRequest } from "../../core/src/__tests__/helpers";
import { createCommerce } from "../../core/src/commerce";
import { createGrigoraCommerce, useCart, useProduct, useStore, type UseCartResult } from "./index";

function handler(req: FakeRequest) {
  if (req.path === "/storefront/p1/settings") return { body: { store: STORE } };
  if (req.path === "/storefront/p1/products/a") return { body: { product: catalogLine("a") } };
  if (req.path === "/cart/validate") {
    const lines = (req.body.line_items as Array<{ product_id: string; quantity: number }>).map((l) => serverLine(l.product_id, 1200, l.quantity));
    return { body: validateResponse(lines) };
  }
  return undefined;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("@grigora/commerce-vue", () => {
  it("installs the plugin and keeps composables reactive", async () => {
    const { fetchImpl } = fakeFetch(handler);
    const commerce = createCommerce({ projectId: "p1", apiBase: "https://api.test", fetch: fetchImpl, storage: new MemoryStorageAdapter(), locale: "en-US" });
    let cartApi: UseCartResult | null = null;
    const Root = defineComponent({
      setup() {
        const cart = useCart();
        const store = useStore();
        const product = useProduct("a");
        cartApi = cart;
        return () => h("div", [h("span", { id: "count" }, String(cart.count.value)), h("span", { id: "store" }, store.data.value?.storeName || ""), h("span", { id: "product" }, product.data.value?.title || "")]);
      },
    });
    const el = document.body.appendChild(document.createElement("div"));
    const app = createApp(Root);
    app.use(createGrigoraCommerce({ commerce, ui: false }));
    app.mount(el);
    expect(app.config.globalProperties.$grigora).toBe(commerce);
    await flush();
    await nextTick();
    expect(el.querySelector("#store")?.textContent).toBe("Test Store");
    expect(el.querySelector("#product")?.textContent).toBe("Product a");
    await cartApi!.add({ productId: "a", quantity: 3 });
    await nextTick();
    expect(el.querySelector("#count")?.textContent).toBe("3");
    expect(cartApi!.isEmpty.value).toBe(false);
    expect(cartApi!.formatCurrency(1200)).toBe("$12.00");
    app.unmount();
  });

  it("requires a config or an instance", () => {
    expect(() => createGrigoraCommerce({})).toThrow(/config/);
  });
});
