import { computed, inject, onUnmounted, ref, shallowRef, watch, type App, type ComputedRef, type InjectionKey, type Ref, type ShallowRef } from "vue";
import {
  createCommerce,
  isBrowser,
  type AddCartItem,
  type Cart,
  type CheckoutAPI,
  type GrigoraCommerce,
  type GrigoraCommerceConfig,
  type GrigoraError,
  type PaymentProviderAdapter,
  type Product,
  type ProductListParams,
  type StoreSettings,
} from "@grigora/commerce-core";
import { installUI, type UIHandle, type UIOptions } from "@grigora/commerce-ui";

/*
  Vue 3 bindings: a plugin that provides one commerce instance and composables
  that expose it reactively. The drop-in UI is the same set of custom elements
  as everywhere else; register them with `compilerOptions.isCustomElement =
  (tag) => tag.startsWith("g-")` and use <g-cart-drawer>, <g-buy-box> etc.
  directly in templates.
*/

export const GRIGORA_COMMERCE: InjectionKey<GrigoraCommerce> = Symbol("grigora-commerce");

export interface GrigoraPluginOptions {
  config?: GrigoraCommerceConfig;
  commerce?: GrigoraCommerce;
  /** Install the drop-in UI in the browser. Default true. */
  ui?: boolean;
  uiOptions?: UIOptions;
  adapters?: PaymentProviderAdapter[];
}

export function createGrigoraCommerce(options: GrigoraPluginOptions) {
  const instance = options.commerce ?? (options.config ? createCommerce(options.config) : null);
  if (!instance) throw new Error("createGrigoraCommerce needs `config` or `commerce`.");
  for (const adapter of options.adapters || []) instance.providers.register(adapter);
  return {
    commerce: instance,
    install(app: App) {
      app.provide(GRIGORA_COMMERCE, instance);
      app.config.globalProperties.$grigora = instance;
      if (isBrowser() && options.ui !== false && !instance.ui) installUI(instance, options.uiOptions);
    },
  };
}

export function useCommerce(): GrigoraCommerce {
  const commerce = inject(GRIGORA_COMMERCE, null);
  if (!commerce) throw new Error("Grigora Commerce is not installed. Use app.use(createGrigoraCommerce({ config })).");
  return commerce;
}

export interface UseCartResult {
  cart: ShallowRef<Cart>;
  count: ComputedRef<number>;
  isEmpty: ComputedRef<boolean>;
  add(item: AddCartItem): Promise<Cart>;
  update(lineId: string, quantity: number): Promise<Cart>;
  remove(lineId: string): Promise<Cart>;
  clear(): void;
  setDiscount(code: string | null): Promise<Cart>;
  validate(): Promise<Cart>;
  open(): void;
  close(): void;
  formatCurrency(minorUnits: number, currency?: string): string;
}

export function useCart(): UseCartResult {
  const commerce = useCommerce();
  const cart = shallowRef<Cart>(commerce.cart.get());
  const off = commerce.on("cart:changed", (next) => {
    cart.value = next;
  });
  onUnmounted(off);
  const ui = () => commerce.ui as UIHandle | undefined;
  return {
    cart,
    count: computed(() => cart.value.itemCount),
    isEmpty: computed(() => cart.value.lines.length === 0),
    add: (item) => commerce.cart.add(item),
    update: (lineId, quantity) => commerce.cart.update(lineId, { quantity }),
    remove: (lineId) => commerce.cart.remove(lineId),
    clear: () => commerce.cart.clear(),
    setDiscount: (code) => commerce.cart.setDiscount(code),
    validate: () => commerce.cart.validate(),
    open: () => ui()?.openCart(),
    close: () => ui()?.closeCart(),
    formatCurrency: (amount, currency) => commerce.formatCurrency(amount, currency),
  };
}

export function useCheckout(): CheckoutAPI {
  return useCommerce().checkout;
}

export interface AsyncResult<T> {
  data: ShallowRef<T | null>;
  loading: Ref<boolean>;
  error: ShallowRef<GrigoraError | null>;
  reload(): Promise<void>;
}

function useAsync<T>(load: () => Promise<T>, deps: Ref<unknown>[] = []): AsyncResult<T> {
  const data = shallowRef<T | null>(null);
  const loading = ref(false);
  const error = shallowRef<GrigoraError | null>(null);
  let seq = 0;
  const reload = async () => {
    const current = ++seq;
    loading.value = true;
    error.value = null;
    try {
      const result = await load();
      if (current === seq) data.value = result;
    } catch (raw) {
      if (current === seq) {
        data.value = null;
        error.value = raw as GrigoraError;
      }
    } finally {
      if (current === seq) loading.value = false;
    }
  };
  void reload();
  if (deps.length) watch(deps, () => void reload());
  return { data, loading, error, reload };
}

export function useStore(): AsyncResult<StoreSettings> {
  const commerce = useCommerce();
  return useAsync(() => commerce.store.get());
}

export function useProduct(idOrSlug: string | Ref<string>): AsyncResult<Product> {
  const commerce = useCommerce();
  const key = typeof idOrSlug === "string" ? ref(idOrSlug) : idOrSlug;
  return useAsync(() => commerce.products.get(key.value), [key]);
}

export interface UseProductsResult extends AsyncResult<Product[]> {
  total: Ref<number>;
  nextCursor: Ref<string>;
}

export function useProducts(params: ProductListParams | Ref<ProductListParams> = {}): UseProductsResult {
  const commerce = useCommerce();
  const source = "value" in params && typeof (params as Ref<ProductListParams>).value === "object" ? (params as Ref<ProductListParams>) : ref(params as ProductListParams);
  const total = ref(0);
  const nextCursor = ref("");
  const result = useAsync(async () => {
    const list = await commerce.products.list(source.value);
    total.value = list.total;
    nextCursor.value = list.nextCursor;
    return list.products;
  }, [source]);
  return { ...result, total, nextCursor };
}

declare module "vue" {
  interface ComponentCustomProperties {
    $grigora: GrigoraCommerce;
  }
}

export type { Cart, Product, StoreSettings, GrigoraCommerce, GrigoraCommerceConfig, UIOptions };
