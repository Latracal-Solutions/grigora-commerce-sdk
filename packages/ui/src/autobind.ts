import type { UIContext } from "./context";
import { readData } from "./dom";

/*
  Zero-JS integration: one delegated click listener on the document, so a
  button rendered later (a carousel, a framework re-render) works without any
  re-initialisation, plus a MutationObserver that upgrades data-attribute
  mount points into the matching custom elements.

    <button data-grigora-add data-product-id="…" data-variant-id="…" data-quantity="1">
    <button data-grigora-buy-now data-product-slug="…">
    <a data-cart-open>Cart (<span data-cart-count>0</span>)</a>
    <div data-grigora-buy-box data-product-slug="…"></div>
    <div data-grigora-checkout></div>
    <div data-grigora-order-status></div>
*/

const MOUNTS: Array<{ selector: string; tag: string; attrs: (el: Element) => Record<string, string> }> = [
  {
    selector: "[data-grigora-buy-box],[data-grigora-buy][data-product-id],[data-grigora-buy][data-product-slug]",
    tag: "g-buy-box",
    attrs: (el) => ({
      product: readData(el, "product-slug") || readData(el, "product-id") || readData(el, "product"),
      variant: readData(el, "variant-id"),
      quantity: readData(el, "quantity"),
      "buy-now": readData(el, "buy-now"),
    }),
  },
  { selector: "[data-grigora-checkout]", tag: "g-checkout", attrs: () => ({}) },
  {
    selector: "[data-grigora-order-status]",
    tag: "g-order-status",
    attrs: (el) => ({ "order-id": readData(el, "order-id"), "lookup-token": readData(el, "lookup-token"), "continue-url": readData(el, "continue-url") }),
  },
  {
    selector: "[data-grigora-price]",
    tag: "g-price",
    attrs: (el) => ({ product: readData(el, "product-slug") || readData(el, "product-id") || readData(el, "grigora-price"), variant: readData(el, "variant-id"), compare: el.hasAttribute("data-compare") ? "" : "" }),
  },
  { selector: "[data-grigora-cart]", tag: "g-cart", attrs: () => ({}) },
];

export function installAutobind(ctx: UIContext): () => void {
  const { commerce } = ctx;
  const doc = document;

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    if (!target || !(target instanceof Element)) return;
    const add = target.closest<HTMLElement>("[data-grigora-add]");
    if (add) {
      event.preventDefault();
      void addFromElement(ctx, add, false);
      return;
    }
    const buyNow = target.closest<HTMLElement>("[data-grigora-buy-now]");
    if (buyNow) {
      event.preventDefault();
      void addFromElement(ctx, buyNow, true);
      return;
    }
    const open = target.closest<HTMLElement>("[data-cart-open],[data-cart-launch]");
    if (open && ctx.options.cartMode !== "none") {
      event.preventDefault();
      ctx.openCart(open);
      return;
    }
    const toggleEl = target.closest<HTMLElement>("[data-cart-toggle]");
    if (toggleEl && ctx.options.cartMode !== "none") {
      event.preventDefault();
      ctx.toggleCart(toggleEl);
      return;
    }
    if (target.closest("[data-cart-close]")) {
      event.preventDefault();
      ctx.closeCart();
      return;
    }
    if (target.closest("[data-checkout-open]")) {
      event.preventDefault();
      ctx.openCheckout();
    }
  };
  doc.addEventListener("click", onClick);

  const syncCounters = () => {
    const cart = commerce.cart.get();
    doc.querySelectorAll<HTMLElement>("[data-cart-count]").forEach((el) => {
      if (el.tagName.toLowerCase() === "g-cart-badge") return;
      el.textContent = String(cart.itemCount);
      if (cart.itemCount > 0 || el.hasAttribute("data-show-zero")) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "");
    });
    doc.querySelectorAll<HTMLElement>("[data-cart-subtotal]").forEach((el) => {
      el.textContent = commerce.formatCurrency(cart.subtotalAmount, cart.currency);
    });
    doc.querySelectorAll<HTMLElement>("[data-cart-total]").forEach((el) => {
      el.textContent = commerce.formatCurrency(cart.validated ? cart.totalAmount : cart.subtotalAmount, cart.currency);
    });
  };
  const unsubscribe = commerce.on("cart:changed", syncCounters);

  const upgrade = (root: ParentNode) => {
    for (const mount of MOUNTS) {
      const candidates: Element[] = [];
      if (root instanceof Element && root.matches(mount.selector)) candidates.push(root);
      candidates.push(...Array.from(root.querySelectorAll(mount.selector)));
      for (const el of candidates) {
        if (el.hasAttribute("data-g-mounted") || el.tagName.toLowerCase().startsWith("g-")) continue;
        el.setAttribute("data-g-mounted", "");
        const element = doc.createElement(mount.tag);
        for (const [key, value] of Object.entries(mount.attrs(el))) if (value) element.setAttribute(key, value);
        if (mount.tag === "g-price" && el.hasAttribute("data-compare")) element.setAttribute("compare", "");
        el.appendChild(element);
      }
    }
  };

  const ready = () => {
    upgrade(doc);
    syncCounters();
  };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();

  const observer = typeof MutationObserver !== "undefined" ? new MutationObserver((records) => {
    let countersDirty = false;
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        upgrade(node);
        if (node.matches("[data-cart-count],[data-cart-subtotal],[data-cart-total]") || node.querySelector("[data-cart-count],[data-cart-subtotal],[data-cart-total]")) countersDirty = true;
      });
    }
    if (countersDirty) syncCounters();
  }) : null;
  observer?.observe(doc.documentElement, { childList: true, subtree: true });

  return () => {
    doc.removeEventListener("click", onClick);
    unsubscribe();
    observer?.disconnect();
  };
}

async function addFromElement(ctx: UIContext, el: HTMLElement, buyNow: boolean): Promise<void> {
  const { commerce, t } = ctx;
  if (el.getAttribute("aria-busy") === "true") return;
  const productId = readData(el, "product-id");
  const productSlug = readData(el, "product-slug") || readData(el, "product");
  if (!productId && !productSlug) {
    ctx.notify("This button has no data-product-id or data-product-slug.", "error");
    return;
  }
  const original = el.textContent || "";
  const isButton = el instanceof HTMLButtonElement;
  const setLabel = (label: string) => {
    if (readData(el, "keep-label")) return;
    el.textContent = label;
  };
  el.setAttribute("aria-busy", "true");
  if (isButton) el.disabled = true;
  setLabel(readData(el, "adding-label") || t("adding"));
  try {
    const price = readData(el, "price");
    await commerce.cart.add({
      productId: productId || undefined,
      productSlug: productSlug || undefined,
      variantId: readData(el, "variant-id") || undefined,
      quantity: Math.max(1, Number(readData(el, "quantity")) || 1),
      replace: readData(el, "replace") === "true" || buyNow,
      title: readData(el, "title") || undefined,
      unitAmount: price ? Number(price) || 0 : undefined,
      currency: readData(el, "currency") || undefined,
      imageUrl: readData(el, "image") || undefined,
      productUrl: readData(el, "product-url") || undefined,
    });
    el.dispatchEvent(new CustomEvent("grigora:added", { bubbles: true, detail: { productId, productSlug, buyNow } }));
    if (buyNow) {
      el.removeAttribute("aria-busy");
      if (isButton) el.disabled = false;
      setLabel(original);
      ctx.openCheckout();
      return;
    }
    setLabel(readData(el, "added-label") || t("added"));
    el.classList.add("g-added");
    setTimeout(() => {
      setLabel(original);
      el.classList.remove("g-added");
      el.removeAttribute("aria-busy");
      if (isButton) el.disabled = false;
    }, 1600);
    if (ctx.options.autoOpenCartOnAdd) ctx.openCart(el);
  } catch (error) {
    setLabel(original);
    el.removeAttribute("aria-busy");
    if (isButton) el.disabled = false;
    ctx.notify((error as Error).message || t("error"), "error");
  }
}
