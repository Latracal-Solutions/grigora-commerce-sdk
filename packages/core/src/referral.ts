import { isBrowser } from "./util";

/*
  Platform-agnostic affiliate referral capture.

  Stripe affiliate tools (Referly, Rewardful, FirstPromoter, Tolt, ...) attribute
  sales through the Checkout Session's `client_reference_id`, and their tracking
  scripts append that value to any Stripe Payment Link on the page. Grigora
  checkout is not a Payment Link, so we keep one invisible probe link that
  looks like one: the merchant's tracker decorates it, we persist the value
  first-party and send it as `referral_id`; the API forwards it to Stripe.

  Same contract as the published-site runtime (grigora-render-new
  lib/commerce-referral.js): shared `window.GrigoraCommerce` global, probe id
  and storage key, so either side picks up what the other captured.
*/

const PROBE_ID = "grigora-referral-probe";
const PROBE_HREF = "https://buy.stripe.com/grigora-referral-probe";
const STORAGE_KEY = "grigora-commerce-referral-v1";
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const PATTERN = /^[A-Za-z0-9._:@+/=~-]{1,200}$/;
const PROBE_STYLE =
  "position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;pointer-events:none";

interface ReferralGlobal {
  getReferral?: () => string;
  setReferral?: (value: unknown) => void;
}

/** Returns the value when it is a usable referral id, otherwise "". */
export function cleanReferral(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value).trim();
  return PATTERN.test(text) ? text : "";
}

function save(value: string): void {
  if (!value) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: value, at: Date.now() }));
  } catch {
    // storage blocked: the live probe still works on this page
  }
}

function stored(): string {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as { id?: unknown; at?: unknown } | null;
    if (!data || Date.now() - Number(data.at || 0) > MAX_AGE_MS) return "";
    return cleanReferral(data.id);
  } catch {
    return "";
  }
}

function fromProbe(link: HTMLAnchorElement | null): string {
  if (!link) return "";
  try {
    return cleanReferral(new URL(link.href).searchParams.get("client_reference_id"));
  } catch {
    return "";
  }
}

function probe(): HTMLAnchorElement | null {
  let link = document.getElementById(PROBE_ID) as HTMLAnchorElement | null;
  if (!link && document.body) {
    link = document.createElement("a");
    link.id = PROBE_ID;
    link.href = PROBE_HREF;
    link.rel = "nofollow noopener";
    link.setAttribute("aria-hidden", "true");
    link.tabIndex = -1;
    link.style.cssText = PROBE_STYLE;
    document.body.appendChild(link);
  }
  if (link && !link.getAttribute("data-grigora-probe")) {
    const target = link;
    target.setAttribute("data-grigora-probe", "1");
    target.addEventListener("click", (event) => event.preventDefault());
    if (typeof MutationObserver === "function") {
      new MutationObserver(() => save(fromProbe(target))).observe(target, { attributes: true, attributeFilter: ["href"] });
    }
    window.addEventListener("pagehide", () => save(fromProbe(target)));
    save(fromProbe(target));
  }
  return link;
}

/**
 * Installs the probe and the `window.GrigoraCommerce.getReferral/setReferral`
 * hooks once. Safe to call repeatedly and a no-op outside the browser.
 */
export function installReferralCapture(): void {
  if (!isBrowser()) return;
  const host = window as unknown as { GrigoraCommerce?: ReferralGlobal };
  const api = (host.GrigoraCommerce = host.GrigoraCommerce || {});
  if (typeof api.getReferral !== "function") {
    let explicit = "";
    api.setReferral = (value: unknown) => {
      explicit = cleanReferral(value);
      save(explicit);
    };
    api.getReferral = () => {
      if (explicit) return explicit;
      const live = fromProbe(probe());
      if (live) {
        save(live);
        return live;
      }
      return stored();
    };
  }
  if (document.body) probe();
  else document.addEventListener("DOMContentLoaded", () => probe(), { once: true });
}

/** The visitor's affiliate referral id, or "" when none was captured. */
export function currentReferral(): string {
  if (!isBrowser()) return "";
  installReferralCapture();
  const api = (window as unknown as { GrigoraCommerce?: ReferralGlobal }).GrigoraCommerce;
  try {
    return cleanReferral(api?.getReferral?.());
  } catch {
    return "";
  }
}
