export type GrigoraErrorCode =
  | "network_error"
  | "timeout"
  | "rate_limited"
  | "out_of_stock"
  | "invalid_address"
  | "mixed_currency"
  | "non_one_time_pricing"
  | "invalid_discount"
  | "checkout_failed"
  | "checkout_in_progress"
  | "checkout_unavailable"
  | "product_unavailable"
  | "variant_required"
  | "cart_empty"
  | "not_found"
  | "unauthorized"
  | "validation_error"
  | "provider_error"
  | "payment_failed"
  | "unknown"
  | (string & {});

export type ErrorContext = "checkout" | "cart" | "discount" | "product" | "order" | "confirm" | "generic";

export interface GrigoraErrorInit {
  code?: GrigoraErrorCode;
  httpStatus?: number;
  retryAfter?: number;
  details?: unknown;
  cause?: unknown;
}

/**
 * Every failure the SDK surfaces. `code` is stable and documented; `message`
 * is the backend's human-readable text where one exists and is safe to show
 * to a shopper as-is.
 */
export class GrigoraError extends Error {
  readonly code: GrigoraErrorCode;
  readonly httpStatus?: number;
  /** Seconds to wait before retrying, when the API said so (429). */
  readonly retryAfter?: number;
  /** Raw `{ code, message, ... }` payload from the API, when there was one. */
  readonly details?: unknown;

  constructor(message: string, init: GrigoraErrorInit = {}) {
    super(message || "Something went wrong.");
    this.name = "GrigoraError";
    this.code = init.code || "unknown";
    this.httpStatus = init.httpStatus;
    this.retryAfter = init.retryAfter;
    this.details = init.details;
    if (init.cause !== undefined) {
      (this as { cause?: unknown }).cause = init.cause;
    }
  }

  get isRetryable(): boolean {
    return this.code === "network_error" || this.code === "timeout" || this.code === "rate_limited";
  }

  toJSON(): { name: string; code: GrigoraErrorCode; message: string; httpStatus?: number; retryAfter?: number } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      retryAfter: this.retryAfter,
    };
  }
}

export function isGrigoraError(value: unknown): value is GrigoraError {
  return value instanceof GrigoraError || (typeof value === "object" && value !== null && (value as { name?: string }).name === "GrigoraError");
}

export function toGrigoraError(value: unknown, fallback: GrigoraErrorInit = {}): GrigoraError {
  if (isGrigoraError(value)) return value;
  if (value instanceof Error) {
    return new GrigoraError(value.message, { code: fallback.code || "unknown", cause: value, ...fallback });
  }
  return new GrigoraError(typeof value === "string" ? value : "Something went wrong.", fallback);
}

const CODE_ALIASES: Record<string, GrigoraErrorCode> = {
  cart_provider_unsupported: "checkout_unavailable",
  cart_provider_not_configured: "checkout_unavailable",
  cart_provider_embedded_unsupported: "checkout_unavailable",
  cart_provider_webhook_required: "checkout_unavailable",
  stripe_tax_requires_hosted_stripe: "checkout_unavailable",
  product_variant_required: "variant_required",
  product_variant_unavailable: "product_unavailable",
  product_unavailable: "product_unavailable",
  subscription_checkout_unsupported: "non_one_time_pricing",
  checkout_email_required: "validation_error",
  checkout_project_required: "validation_error",
  checkout_identity_incomplete: "checkout_failed",
  checkout_client_id_required: "checkout_failed",
  checkout_idempotency_key_required: "checkout_failed",
  checkout_idempotency_conflict: "checkout_failed",
  checkout_in_progress: "checkout_in_progress",
  checkout_post_required: "checkout_failed",
  payment_confirmation_failed: "payment_failed",
  shipping_address_required: "invalid_address",
  shipping_country_not_allowed: "invalid_address",
  shipping_not_configured: "checkout_unavailable",
  shipping_zone_not_found: "invalid_address",
  shipping_rate_not_found: "invalid_address",
  shipping_rate_invalid: "invalid_address",
  not_found: "not_found",
  project_required: "validation_error",
  storefront_failed: "unknown",
};

export interface ApiFailure {
  status: number;
  output?: { code?: unknown; message?: unknown; [key: string]: unknown } | null;
  retryAfterHeader?: string | null;
  context?: ErrorContext;
}

/**
 * Map an API failure to a stable code. The backend only sometimes sets a
 * `code`; when it does not, the message is the only signal, so a few
 * well-known messages are recognised here.
 */
export function mapApiError(failure: ApiFailure): GrigoraError {
  const { status, output, context = "generic" } = failure;
  const rawCode = typeof output?.code === "string" ? output.code : "";
  const message = typeof output?.message === "string" && output.message ? output.message : defaultMessage(status);
  const retryAfter = parseRetryAfter(failure.retryAfterHeader);
  const details = output || undefined;
  const init = (code: GrigoraErrorCode): GrigoraError =>
    new GrigoraError(message, { code, httpStatus: status, retryAfter, details });

  if (status === 429) return init("rate_limited");
  if (status === 409 || Array.isArray(output?.out_of_stock)) return init("out_of_stock");
  if (rawCode && CODE_ALIASES[rawCode]) return init(CODE_ALIASES[rawCode]);
  if (status === 404) return init("not_found");
  if (status === 401 || status === 403) return init("unauthorized");
  if (rawCode) return init(rawCode);

  const lower = message.toLowerCase();
  if (/mix multiple currencies/.test(lower)) return init("mixed_currency");
  if (/open this product page/.test(lower)) return init("non_one_time_pricing");
  if (/requires a valid/.test(lower)) return init("invalid_address");
  if (/cart is empty/.test(lower)) return init("cart_empty");
  if (/out of stock/.test(lower)) return init("out_of_stock");
  if (/no longer available/.test(lower)) return init("product_unavailable");
  if (context === "discount" || /discount|coupon/.test(lower)) return init("invalid_discount");
  if (context === "checkout") return init("checkout_failed");
  if (context === "confirm") return init("payment_failed");
  if (status >= 500) return init("network_error");
  return init(status >= 400 && status < 500 ? "validation_error" : "unknown");
}

function defaultMessage(status: number): string {
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status === 404) return "Not found.";
  if (status >= 500) return "The store is temporarily unavailable. Please try again.";
  return "Something went wrong.";
}

function parseRetryAfter(value?: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.round((date - Date.now()) / 1000));
  return undefined;
}
