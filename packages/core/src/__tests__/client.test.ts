import { describe, expect, it } from "vitest";
import { ApiClient } from "../client";
import { GrigoraError, mapApiError } from "../errors";
import { fakeFetch } from "./helpers";

describe("ApiClient", () => {
  it("unwraps the Output envelope and builds commerce URLs", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { hello: "world" } }));
    const client = new ApiClient({ apiBase: "https://api.test/", fetch: fetchImpl });
    const out = await client.get<{ hello: string }>("/discounts/validate", { query: { code: "X", empty: "", ids: ["a", "b"] } });
    expect(out.hello).toBe("world");
    expect(calls[0].url.toString()).toBe("https://api.test/general/commerce/discounts/validate?code=X&ids=a%2Cb");
    expect(calls[0].headers.accept).toBe("application/json");
  });

  it("maps failures to GrigoraError with the API message and a stable code", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 409, body: { message: "Some items are out of stock.", out_of_stock: [{ product_id: "p" }] } }));
    const client = new ApiClient({ apiBase: "https://api.test", fetch: fetchImpl });
    const error = (await client.post("/checkout/session", {}).catch((e: unknown) => e)) as GrigoraError & { details: { out_of_stock: unknown[] } };
    expect(error).toBeInstanceOf(GrigoraError);
    expect(error.code).toBe("out_of_stock");
    expect(error.httpStatus).toBe(409);
    expect(error.message).toBe("Some items are out of stock.");
    expect(error.details.out_of_stock).toHaveLength(1);
  });

  it("retries GETs on 5xx and network errors but never a POST", async () => {
    let getAttempts = 0;
    let postAttempts = 0;
    const { fetchImpl } = fakeFetch((req) => {
      if (req.method === "GET") {
        getAttempts += 1;
        return getAttempts < 3 ? { status: 503, body: { message: "down" } } : { body: { ok: true } };
      }
      postAttempts += 1;
      return { status: 500, body: { message: "boom" } };
    });
    const client = new ApiClient({ apiBase: "https://api.test", fetch: fetchImpl, retries: 3 });
    // speed up: override delay by monkeypatching setTimeout is heavy; the backoff is small enough (<2s total).
    const out = await client.get<{ ok: boolean }>("/storefront/p1/settings");
    expect(out.ok).toBe(true);
    expect(getAttempts).toBe(3);
    await expect(client.post("/checkout/session", {})).rejects.toMatchObject({ code: "network_error", httpStatus: 500 });
    expect(postAttempts).toBe(1);
  }, 10_000);

  it("sends idempotency headers when asked and surfaces 429 with Retry-After", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 429, body: { message: "slow down" }, headers: { "Retry-After": "600" } }));
    const client = new ApiClient({ apiBase: "https://api.test", fetch: fetchImpl });
    const error = (await client
      .post("/checkout/session", { a: 1 }, { idempotency: { key: "key-1", clientId: "client-123456789012345" } })
      .catch((e: unknown) => e)) as GrigoraError;
    expect(calls[0].headers["idempotency-key"]).toBe("key-1");
    expect(calls[0].headers["x-grigora-checkout-client"]).toBe("client-123456789012345");
    expect(error.code).toBe("rate_limited");
    expect(error.retryAfter).toBe(600);
    expect(error.isRetryable).toBe(true);
  });

  it("wraps fetch rejections as network errors", async () => {
    const client = new ApiClient({
      apiBase: "https://api.test",
      retries: 1,
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch,
    });
    await expect(client.get("/x")).rejects.toMatchObject({ code: "network_error" });
  });
});

describe("mapApiError", () => {
  const cases: Array<[number, Record<string, unknown>, string]> = [
    [400, { message: "Checkout cannot mix multiple currencies in one order." }, "mixed_currency"],
    [400, { message: "Open this product page to complete checkout." }, "non_one_time_pricing"],
    [400, { message: "Billing address requires a valid phone." }, "invalid_address"],
    [400, { message: "Your cart is empty." }, "cart_empty"],
    [400, { code: "cart_provider_not_configured", message: "x" }, "checkout_unavailable"],
    [400, { code: "product_variant_required", message: "x" }, "variant_required"],
    [400, { code: "checkout_in_progress", message: "x" }, "checkout_in_progress"],
    [404, { message: "Product not found." }, "not_found"],
    [403, { message: "Order lookup authorization is required." }, "unauthorized"],
    [400, { message: "This discount code is invalid." }, "invalid_discount"],
    [400, { message: "A product in your cart is no longer available." }, "product_unavailable"],
  ];
  for (const [status, output, code] of cases) {
    it(`${status} ${JSON.stringify(output)} -> ${code}`, () => {
      expect(mapApiError({ status, output }).code).toBe(code);
    });
  }

  it("uses the request context when the message carries no signal", () => {
    expect(mapApiError({ status: 400, output: { message: "Nope." }, context: "checkout" }).code).toBe("checkout_failed");
    expect(mapApiError({ status: 400, output: { message: "Nope." }, context: "discount" }).code).toBe("invalid_discount");
    expect(mapApiError({ status: 400, output: { message: "Nope." } }).code).toBe("validation_error");
  });
});
