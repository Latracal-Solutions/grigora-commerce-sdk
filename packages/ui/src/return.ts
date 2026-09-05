import type { CheckoutReturn, GrigoraCommerce } from "@grigora/commerce-core";

const pending = new WeakMap<GrigoraCommerce, Promise<CheckoutReturn | null>>();

/**
 * Read (and, for a Stripe redirect, confirm) the return parameters once per
 * instance and share the result, so the install step, <g-checkout> and
 * <g-order-status> never confirm the same payment twice.
 */
export function getReturn(commerce: GrigoraCommerce): Promise<CheckoutReturn | null> {
  const existing = pending.get(commerce);
  if (existing) return existing;
  const promise = commerce.checkout.handleReturn().catch(() => null);
  pending.set(commerce, promise);
  return promise;
}

export function resetReturn(commerce: GrigoraCommerce): void {
  pending.delete(commerce);
}

/** Strip order parameters from the address bar so a reload does not re-run the status flow with stale data. */
export function withOrderParams(url: string, orderId: string, lookupToken: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.set("order_id", orderId);
    if (lookupToken) parsed.searchParams.set("lookup_token", lookupToken);
    return parsed.toString();
  } catch {
    return url;
  }
}
