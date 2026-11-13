import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanReferral, currentReferral, installReferralCapture } from "../referral";
import { makeCommerce, STORE, type FakeRequest } from "./helpers";

const KEY = "grigora-commerce-referral-v1";

// Mimics what any Stripe affiliate tracker does to Payment Links on the page.
function trackerDecorates(id: string) {
  document.querySelectorAll<HTMLAnchorElement>("a[href*='stripe.com']").forEach((a) => {
    const url = new URL(a.href);
    if (url.hostname !== "buy.stripe.com" || url.searchParams.get("client_reference_id")) return;
    url.searchParams.set("client_reference_id", id);
    a.setAttribute("href", url.toString());
  });
}

// The test DOM exposes no Web Storage; give it a minimal in-memory one.
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

function reset() {
  document.body.innerHTML = "";
  delete (window as unknown as { GrigoraCommerce?: unknown }).GrigoraCommerce;
  vi.unstubAllGlobals();
}

describe("affiliate referral capture", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });
  afterEach(reset);

  it("accepts tracker ids and rejects unusable values", () => {
    expect(cleanReferral("rly_123")).toBe("rly_123");
    expect(cleanReferral(" 8f14e45f-ceea-467a-9575-0e3b1b2c4d5e ")).toBe("8f14e45f-ceea-467a-9575-0e3b1b2c4d5e");
    expect(cleanReferral("")).toBe("");
    expect(cleanReferral("has space")).toBe("");
    expect(cleanReferral("<b>")).toBe("");
    expect(cleanReferral("x".repeat(201))).toBe("");
    expect(cleanReferral({})).toBe("");
  });

  it("renders a probe that a tracker decorates, and persists the referral", () => {
    installReferralCapture();
    expect(currentReferral()).toBe("");
    trackerDecorates("rly_42");
    expect(currentReferral()).toBe("rly_42");
    expect(JSON.parse(localStorage.getItem(KEY) || "{}").id).toBe("rly_42");
  });

  it("falls back to the stored referral on pages without a tracker", () => {
    localStorage.setItem(KEY, JSON.stringify({ id: "rly_7", at: Date.now() }));
    expect(currentReferral()).toBe("rly_7");
  });

  it("ignores an expired stored referral", () => {
    localStorage.setItem(KEY, JSON.stringify({ id: "rly_old", at: Date.now() - 61 * 864e5 }));
    expect(currentReferral()).toBe("");
  });

  it("lets any script set the referral explicitly", () => {
    installReferralCapture();
    (window as unknown as { GrigoraCommerce: { setReferral: (v: string) => void } }).GrigoraCommerce.setReferral("partner-9");
    expect(currentReferral()).toBe("partner-9");
  });

  it("sends the captured referral, and an explicit referralId wins", async () => {
    const handler = (req: FakeRequest) => {
      if (req.path === "/storefront/p1/settings") return { body: { store: STORE } };
      return { body: { checkout: { provider: "stripe", mode: "hosted", checkout_url: "https://pay/1", order_id: "ord_r", lookup_token: "tok_".padEnd(24, "r") } } };
    };
    const { commerce, calls } = makeCommerce(handler);
    trackerDecorates("rly_99");
    await commerce.checkout.startSingle({ slug: "course", customerEmail: "a@b.co" });
    expect(calls.find((c) => c.path === "/checkout/create")!.body).toMatchObject({ referral_id: "rly_99" });

    await commerce.checkout.startSingle({ slug: "course-2", customerEmail: "a@b.co", referralId: "override_1" });
    const last = calls.filter((c) => c.path === "/checkout/create").pop()!;
    expect(last.body).toMatchObject({ referral_id: "override_1" });
  });

  it("omits referral_id when nothing was captured", async () => {
    const handler = (req: FakeRequest) => {
      if (req.path === "/storefront/p1/settings") return { body: { store: STORE } };
      return { body: { checkout: { provider: "stripe", mode: "hosted", checkout_url: "https://pay/1", order_id: "ord_n", lookup_token: "tok_".padEnd(24, "n") } } };
    };
    const { commerce, calls } = makeCommerce(handler);
    await commerce.checkout.startSingle({ slug: "course", customerEmail: "a@b.co" });
    expect(calls.find((c) => c.path === "/checkout/create")!.body).not.toHaveProperty("referral_id");
  });
});
