import { describe, expect, it } from "vitest";
import { normalizeCountryCode, COUNTRY_CODES } from "../countries";
import { formatMinor, toMinor, toMajor } from "../currency";
import { Commerce, init, onReady, resetDefaultInstance, registerProvider, getInstance, MemoryStorageAdapter } from "../index";
import { addressErrors, addressErrorMessage, isValidPhone, isValidPostalCode, normalizePostalForCountry, toApiAddress } from "../validation";

describe("address validation (API parity)", () => {
  const valid = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+1 (415) 555-2671",
    line1: "1 Market St",
    city: "San Francisco",
    state: "CA",
    postalCode: "94105",
    country: "US",
  };

  it("accepts a complete US address", () => {
    expect(addressErrors(valid)).toEqual([]);
  });

  it("lists every failing field in API order", () => {
    expect(addressErrors({ ...valid, name: "", email: "x", postalCode: "1", phone: "" })).toEqual(["name", "email", "postalCode", "phone"]);
    expect(addressErrorMessage("Billing address", ["email", "phone"])).toBe("Billing address needs a valid email, phone number.");
  });

  it("applies country specific phone and postal rules", () => {
    expect(isValidPhone("9876543210", "IN")).toBe(true);
    expect(isValidPhone("1234567890", "IN")).toBe(false);
    expect(isValidPhone("07911 123456", "GB")).toBe(true);
    expect(isValidPostalCode("SW1A 1AA", "GB")).toBe(true);
    expect(isValidPostalCode("M5V 3L9", "CA")).toBe(true);
    expect(isValidPostalCode("ABCDE", "US")).toBe(false);
    expect(isValidPostalCode("400001", "IN")).toBe(true);
    expect(isValidPostalCode("12345", "DE")).toBe(true);
  });

  it("phone is optional only when asked", () => {
    expect(addressErrors({ ...valid, phone: "" }, { requirePhone: false })).toEqual([]);
  });

  it("normalises country aliases and postal input", () => {
    expect(normalizeCountryCode("usa")).toBe("US");
    expect(normalizeCountryCode("United Kingdom")).toBe("GB");
    expect(normalizeCountryCode("Mars")).toBe("");
    expect(COUNTRY_CODES.size).toBeGreaterThan(240);
    expect(normalizePostalForCountry("m5v3l9", "CA")).toBe("M5V 3L9");
    expect(normalizePostalForCountry("94105-1234x", "US")).toBe("94105-1234");
  });

  it("converts to the API wire shape", () => {
    expect(toApiAddress({ ...valid, country: "usa" })).toMatchObject({ postal_code: "94105", country: "US", tax_id: "" });
  });
});

describe("currency", () => {
  it("formats minor units and converts both ways", () => {
    expect(formatMinor(2999, "USD")).toBe("$29.99");
    expect(formatMinor(0, "USD", "en-US", { zeroLabel: "Free" })).toBe("Free");
    expect(formatMinor(123400, "INR", "en-IN")).toContain("1,234");
    expect(formatMinor(500, "x")).toBe("$5.00");
    expect(formatMinor(500, "NOT").replace(/\s/g, " ")).toBe("NOT 5.00");
    expect(toMinor(29.99)).toBe(2999);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMajor(2999)).toBe(29.99);
  });
});

describe("default instance", () => {
  it("runs onReady callbacks once init happens, and immediately afterwards", () => {
    resetDefaultInstance();
    const seen: string[] = [];
    onReady((c) => seen.push(`queued:${c.projectId}`));
    expect(getInstance()).toBeNull();
    const instance = init({ projectId: "project-abc", storage: new MemoryStorageAdapter(), fetch: (async () => new Response("{}")) as typeof fetch });
    expect(instance.projectId).toBe("abc");
    onReady((c) => seen.push(`late:${c.projectId}`));
    expect(seen).toEqual(["queued:abc", "late:abc"]);
    expect(init({ projectId: "abc" })).toBe(instance);
    registerProvider({ id: "test", supportsEmbedded: false, mount: async () => {}, submit: async () => {}, destroy: () => {} });
    expect(instance.providers.has("test")).toBe(true);
    expect(instance.providers.has("hosted")).toBe(true);
    expect(Commerce.get()).toBe(instance);
    resetDefaultInstance();
    expect(getInstance()).toBeNull();
  });

  it("rejects a missing project id", () => {
    expect(() => init({ projectId: "" })).toThrow(/projectId/);
  });
});

describe("defaultApiBase", () => {
  it("targets the local API from localhost and from a *.localhost preview host", async () => {
    const { defaultApiBase } = await import("../util");
    const original = window.location.href;
    for (const url of ["http://localhost:3000/", "http://127.0.0.1:8080/x", "http://brew-and-bean.localhost:2706/shop/"]) {
      window.history.replaceState({}, "", url.replace(/^http:\/\/[^/]+/, ""));
      Object.defineProperty(window, "location", { value: new URL(url), configurable: true, writable: true });
      expect(defaultApiBase()).toBe("http://localhost:2706");
    }
    Object.defineProperty(window, "location", { value: new URL("https://shop.example/"), configurable: true, writable: true });
    expect(defaultApiBase()).toBe("https://api.grigora.co");
    Object.defineProperty(window, "location", { value: new URL(original), configurable: true, writable: true });
  });
});
