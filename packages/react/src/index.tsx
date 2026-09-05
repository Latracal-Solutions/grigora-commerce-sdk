import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  createCommerce,
  isBrowser,
  type AddCartItem,
  type Cart,
  type CheckoutAPI,
  type Collection,
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
  React bindings. The provider creates the commerce instance on the client
  (inside an effect), so server rendering never touches window or storage;
  hooks return empty defaults until then and components render placeholders.
  The web components from @grigora/commerce-ui are used for the drop-in UI so
  the React layer stays thin and the visuals stay identical across frameworks.
*/

const CommerceContext = createContext<GrigoraCommerce | null>(null);

export interface GrigoraProviderProps {
  /** Either a config to create an instance from, or an existing instance. */
  config?: GrigoraCommerceConfig;
  commerce?: GrigoraCommerce;
  /** Install the drop-in UI (drawer, data attributes, styles). Default true. */
  ui?: boolean;
  uiOptions?: UIOptions;
  adapters?: PaymentProviderAdapter[];
  children?: ReactNode;
}

export function GrigoraProvider({ config, commerce, ui = true, uiOptions, adapters, children }: GrigoraProviderProps) {
  const [instance, setInstance] = useState<GrigoraCommerce | null>(commerce ?? null);
  const projectId = config?.projectId;
  const adaptersRef = useRef(adapters);
  adaptersRef.current = adapters;
  const uiOptionsRef = useRef(uiOptions);
  uiOptionsRef.current = uiOptions;
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!isBrowser()) return;
    const owned = !commerce;
    const inst = commerce ?? (configRef.current ? createCommerce(configRef.current) : null);
    if (!inst) return;
    for (const adapter of adaptersRef.current || []) inst.providers.register(adapter);
    let handle: UIHandle | null = null;
    if (ui && !inst.ui) handle = installUI(inst, uiOptionsRef.current);
    setInstance(inst);
    return () => {
      handle?.destroy();
      if (owned) inst.destroy();
    };
  }, [commerce, projectId, ui]);

  return createElement(CommerceContext.Provider, { value: instance }, children);
}

/** The commerce instance, or null before the provider has mounted on the client. */
export function useCommerce(): GrigoraCommerce | null {
  return useContext(CommerceContext);
}

export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export interface UseCartResult {
  cart: Cart | null;
  ready: boolean;
  count: number;
  isEmpty: boolean;
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

const noCommerce = () => Promise.reject(new Error("Grigora Commerce is not ready."));

export function useCart(): UseCartResult {
  const commerce = useCommerce();
  const subscribe = useCallback(
    (onChange: () => void) => (commerce ? commerce.on("cart:changed", onChange) : () => {}),
    [commerce]
  );
  const cart = useSyncExternalStore(
    subscribe,
    () => (commerce ? commerce.cart.get() : null),
    () => null
  );
  return useMemo<UseCartResult>(
    () => ({
      cart,
      ready: Boolean(commerce),
      count: cart?.itemCount || 0,
      isEmpty: !cart || cart.lines.length === 0,
      add: (item) => (commerce ? commerce.cart.add(item) : noCommerce()),
      update: (lineId, quantity) => (commerce ? commerce.cart.update(lineId, { quantity }) : noCommerce()),
      remove: (lineId) => (commerce ? commerce.cart.remove(lineId) : noCommerce()),
      clear: () => commerce?.cart.clear(),
      setDiscount: (code) => (commerce ? commerce.cart.setDiscount(code) : noCommerce()),
      validate: () => (commerce ? commerce.cart.validate() : noCommerce()),
      open: () => (commerce?.ui as UIHandle | undefined)?.openCart(),
      close: () => (commerce?.ui as UIHandle | undefined)?.closeCart(),
      formatCurrency: (amount, currency) => (commerce ? commerce.formatCurrency(amount, currency) : ""),
    }),
    [cart, commerce]
  );
}

export function useCheckout(): CheckoutAPI | null {
  return useCommerce()?.checkout || null;
}

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: GrigoraError | null;
}

function useAsync<T>(commerce: GrigoraCommerce | null, key: string, load: (commerce: GrigoraCommerce) => Promise<T>): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: Boolean(commerce), error: null });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!commerce) return;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    loadRef
      .current(commerce)
      .then((data) => !cancelled && setState({ data, loading: false, error: null }))
      .catch((error: GrigoraError) => !cancelled && setState({ data: null, loading: false, error }));
    return () => {
      cancelled = true;
    };
  }, [commerce, key, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

export function useStore(): AsyncState<StoreSettings> & { reload: () => void } {
  const commerce = useCommerce();
  return useAsync(commerce, "store", (c) => c.store.get());
}

export function useProduct(idOrSlug: string | null | undefined): AsyncState<Product> & { reload: () => void } {
  const commerce = useCommerce();
  const key = idOrSlug || "";
  return useAsync(key ? commerce : null, key, (c) => c.products.get(key));
}

export function useProducts(params: ProductListParams = {}): AsyncState<Product[]> & { total: number; nextCursor: string; reload: () => void } {
  const commerce = useCommerce();
  const key = JSON.stringify(params);
  const [meta, setMeta] = useState({ total: 0, nextCursor: "" });
  const result = useAsync(commerce, key, async (c) => {
    const list = await c.products.list(params);
    setMeta({ total: list.total, nextCursor: list.nextCursor });
    return list.products;
  });
  return { ...result, ...meta };
}

export function useCollections(): AsyncState<Collection[]> & { reload: () => void } {
  const commerce = useCommerce();
  return useAsync(commerce, "collections", (c) => c.products.collections());
}

// ------------------------------------------------------------- components

type Attrs = Record<string, string | undefined>;

function CustomElement({ tag, attrs, children, style }: { tag: string; attrs?: Attrs; children?: ReactNode; style?: CSSProperties }) {
  const mounted = useMounted();
  const props: Record<string, unknown> = { style };
  for (const [key, value] of Object.entries(attrs || {})) if (value !== undefined && value !== "") props[key] = value;
  if (!mounted) return createElement("div", { "data-grigora-placeholder": tag, style });
  return createElement(tag, props, children);
}

export interface AddToCartButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onError"> {
  productId?: string;
  productSlug?: string;
  variantId?: string;
  quantity?: number;
  /** Open checkout right after adding. */
  buyNow?: boolean;
  onAdded?: (cart: Cart) => void;
  onError?: (error: GrigoraError) => void;
  addingLabel?: ReactNode;
  addedLabel?: ReactNode;
}

export function AddToCartButton({ productId, productSlug, variantId, quantity = 1, buyNow, onAdded, onError, addingLabel, addedLabel, children, disabled, onClick, ...rest }: AddToCartButtonProps) {
  const { add, ready } = useCart();
  const commerce = useCommerce();
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || state === "adding") return;
    setState("adding");
    try {
      const cart = await add({ productId, productSlug, variantId, quantity, replace: buyNow });
      onAdded?.(cart);
      const ui = commerce?.ui as UIHandle | undefined;
      if (buyNow) {
        setState("idle");
        ui?.openCheckout();
        return;
      }
      setState("added");
      if (ui?.options.autoOpenCartOnAdd) ui.openCart(event.currentTarget);
      timer.current = setTimeout(() => setState("idle"), 1600);
    } catch (error) {
      setState("idle");
      onError?.(error as GrigoraError);
      (commerce?.ui as UIHandle | undefined)?.notify((error as Error).message, "error");
    }
  };
  const label = state === "adding" ? addingLabel ?? "Adding…" : state === "added" ? addedLabel ?? "Added" : children ?? (buyNow ? "Buy now" : "Add to cart");
  return createElement(
    "button",
    { type: "button", ...rest, disabled: disabled || !ready || state === "adding", "aria-busy": state === "adding" || undefined, onClick: handleClick },
    label
  );
}

export function BuyNowButton(props: Omit<AddToCartButtonProps, "buyNow">) {
  return createElement(AddToCartButton, { ...props, buyNow: true });
}

export function CartBadge({ showZero, className, style }: { showZero?: boolean; className?: string; style?: CSSProperties }) {
  const { count, ready } = useCart();
  if (!ready || (count === 0 && !showZero)) return null;
  return createElement("span", { className, style, "data-cart-count": "", "aria-live": "polite" }, String(count));
}

export function CartLauncher({ children, className, style, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, count, ready } = useCart();
  return createElement(
    "button",
    { type: "button", className, style, "aria-haspopup": "dialog", disabled: !ready, ...rest, onClick: () => open() },
    children ?? "Cart",
    " ",
    createElement(CartBadge, null)
  );
}

export function CartDrawer({ discount = true }: { discount?: boolean }) {
  return createElement(CustomElement, { tag: "g-cart-drawer", attrs: { discount: discount ? undefined : "off" } });
}

export function CartView() {
  return createElement(CustomElement, { tag: "g-cart" });
}

export function BuyBox({ product, variant, quantity, buyNow = true, showPrice = true, style }: { product: string; variant?: string; quantity?: number; buyNow?: boolean; showPrice?: boolean; style?: CSSProperties }) {
  return createElement(CustomElement, {
    tag: "g-buy-box",
    style,
    attrs: { product, variant, quantity: quantity ? String(quantity) : undefined, "buy-now": buyNow ? undefined : "off", "show-price": showPrice ? undefined : "off" },
  });
}

export function Checkout({ style }: { style?: CSSProperties }) {
  return createElement(CustomElement, { tag: "g-checkout", style });
}

export function OrderStatus({ orderId, lookupToken, continueUrl, style }: { orderId?: string; lookupToken?: string; continueUrl?: string; style?: CSSProperties }) {
  return createElement(CustomElement, { tag: "g-order-status", style, attrs: { "order-id": orderId, "lookup-token": lookupToken, "continue-url": continueUrl } });
}

export function Price({ product, variant, compare, className }: { product: string; variant?: string; compare?: boolean; className?: string }) {
  const { data } = useProduct(product);
  const commerce = useCommerce();
  if (!data || !commerce) return createElement("span", { className, "aria-busy": "true" });
  const v = variant ? data.variants.find((candidate) => candidate.id === variant) : null;
  const amount = compare ? (v?.compareAtAmount ?? data.compareAtAmount) : v?.priceAmount ?? data.priceAmount;
  if (compare && amount <= 0) return null;
  return createElement("span", { className }, commerce.formatCurrency(amount, v?.currency || data.currency));
}

export type { Cart, Product, StoreSettings, GrigoraCommerce, GrigoraCommerceConfig, UIOptions };
