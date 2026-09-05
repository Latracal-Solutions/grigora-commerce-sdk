import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDefaultInstance, MemoryStorageAdapter } from "@grigora/commerce-core";
import { autoInit, installGlobal } from "./global";

beforeEach(() => {
  resetDefaultInstance();
  delete (globalThis as { Grigora?: unknown }).Grigora;
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-g-project");
});

afterEach(() => {
  resetDefaultInstance();
});

describe("CDN global", () => {
  it("exposes window.Grigora.Commerce and flushes callbacks queued before load", () => {
    const seen: string[] = [];
    (globalThis as { Grigora?: { q: Array<() => void> } }).Grigora = { q: [() => seen.push("queued")] };
    const api = installGlobal();
    expect(window.Grigora?.Commerce).toBe(api);
    expect(seen).toEqual(["queued"]);
    (window.Grigora!.q as Array<() => void>).push(() => seen.push("late"));
    expect(seen).toEqual(["queued", "late"]);
    expect(api.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(installGlobal()).toBe(api);
    expect(api.adapters.stripe.id).toBe("stripe");
    expect(api.adapters.razorpay.supportsEmbedded).toBe(true);
  });

  it("starts the storefront from the script tag's data attributes", () => {
    const script = document.createElement("script");
    script.setAttribute("data-project", "project-abc");
    script.setAttribute("data-api-base", "https://api.test/");
    script.setAttribute("data-currency", "inr");
    script.setAttribute("data-payment", "hosted");
    script.setAttribute("data-checkout-url", "/checkout");
    script.setAttribute("data-cart-mode", "drawer");
    script.setAttribute("data-accent", "#ff0000");
    script.setAttribute("data-auto-open", "false");
    document.body.appendChild(script);
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" })) as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const commerce = autoInit(script)!;
      expect(commerce.projectId).toBe("abc");
      expect(commerce.apiBase).toBe("https://api.test");
      expect(commerce.config.currency).toBe("INR");
      expect(commerce.config.payment).toBe("hosted");
      expect(commerce.providers.has("stripe")).toBe(true);
      expect(commerce.providers.has("razorpay")).toBe(true);
      const ui = commerce.ui as { options: { checkoutPlacement: string; checkoutUrl: string; autoOpenCartOnAdd: boolean; theme: { accent: string } } };
      expect(ui.options.checkoutPlacement).toBe("page");
      expect(ui.options.checkoutUrl).toBe("/checkout");
      expect(ui.options.autoOpenCartOnAdd).toBe(false);
      expect(ui.options.theme.accent).toBe("#ff0000");
      expect(document.querySelector("g-cart-drawer")).not.toBeNull();
      const ready = vi.fn();
      installGlobal().onReady(ready);
      expect(ready).toHaveBeenCalledWith(commerce);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to <html data-g-project> and stays idle without a project", () => {
    expect(autoInit(document.createElement("script"))).toBeNull();
    document.documentElement.setAttribute("data-g-project", "site-1");
    const script = document.createElement("script");
    script.setAttribute("data-ui", "false");
    const commerce = autoInit(script)!;
    expect(commerce.projectId).toBe("site-1");
    expect(commerce.ui).toBeUndefined();
    expect(commerce.config.storage).toBeInstanceOf(Object);
    new MemoryStorageAdapter();
  });
});
