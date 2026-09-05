import { isSafeHttpUrl } from "@grigora/commerce-core";

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

/**
 * Tiny element builder. Text children become text nodes (never HTML), `on*`
 * keys become listeners, booleans toggle attributes. Product data from the API
 * only ever reaches the DOM through this or through setAttribute, so a title
 * containing markup is rendered as text.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key === "class") {
        el.className = String(value);
      } else if (value === true) {
        el.setAttribute(key, "");
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function replaceChildren(el: Element, ...children: Child[]): void {
  clear(el);
  append(el, children);
}

const ICONS: Record<string, string> = {
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  package: '<path d="m7.5 4.3 9 5.2"/><path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  card: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
};

/** Inline SVG from a fixed, trusted set of paths. */
export function icon(name: keyof typeof ICONS | string, size = 20): SVGElement {
  const template = document.createElement("template");
  template.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.alert}</svg>`;
  return template.content.firstElementChild as SVGElement;
}

/** An <img> for a product URL, or null when the URL is not http(s). */
export function image(url: string, alt = ""): HTMLImageElement | null {
  if (!isSafeHttpUrl(url)) return null;
  return h("img", { src: url, alt, loading: "lazy", decoding: "async" });
}

export function safeHref(url: string): string {
  return isSafeHttpUrl(url) ? url : "#";
}

export function setText(el: Element | null, text: string): void {
  if (el) el.textContent = text;
}

export function toggle(el: Element | null, visible: boolean): void {
  if (!el) return;
  if (visible) el.removeAttribute("hidden");
  else el.setAttribute("hidden", "");
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusables(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("hidden") && el.offsetParent !== null || el === document.activeElement || !("offsetParent" in el));
}

/**
 * Keep Tab/Shift+Tab inside `root` and route Escape to `onEscape`. Returns a
 * disposer. Background content is made inert when the browser supports it.
 */
export function trapFocus(root: HTMLElement, onEscape: () => void): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== "Tab") return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("hidden") && !el.closest("[hidden]"));
    if (!items.length) {
      event.preventDefault();
      root.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKey, true);
  const inerted: Element[] = [];
  for (const sibling of Array.from(document.body.children)) {
    if (sibling === root || sibling.contains(root) || sibling.tagName === "SCRIPT" || sibling.tagName === "STYLE") continue;
    if (sibling.hasAttribute("inert")) continue;
    sibling.setAttribute("inert", "");
    inerted.push(sibling);
  }
  return () => {
    document.removeEventListener("keydown", onKey, true);
    for (const el of inerted) el.removeAttribute("inert");
  };
}

let lockCount = 0;
let previousOverflow = "";

export function lockScroll(): () => void {
  if (lockCount === 0) {
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) document.documentElement.style.overflow = previousOverflow;
  };
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = ((...args: never[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as T & { cancel: () => void };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

export function dispatch(target: EventTarget, name: string, detail?: unknown): void {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

export function readData(el: Element, name: string): string {
  const value = el.getAttribute(`data-${name}`);
  return value === null ? "" : value.trim();
}
