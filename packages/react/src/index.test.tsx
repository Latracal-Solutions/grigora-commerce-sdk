import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorageAdapter } from "@grigora/commerce-core";
import { catalogLine, fakeFetch, serverLine, validateResponse, STORE, type FakeRequest } from "../../core/src/__tests__/helpers";
import { createCommerce } from "../../core/src/commerce";
import { AddToCartButton, CartBadge, GrigoraProvider, Price, useCart, useProduct, useStore } from "./index";

function handler(req: FakeRequest) {
  if (req.path === "/storefront/p1/settings") return { body: { store: STORE } };
  if (req.path === "/storefront/p1/products/a") return { body: { product: catalogLine("a") } };
  if (req.path === "/cart/validate") {
    const lines = (req.body.line_items as Array<{ product_id: string; quantity: number }>).map((l) => serverLine(l.product_id, 1200, l.quantity));
    return { body: validateResponse(lines) };
  }
  return undefined;
}

function makeCommerce() {
  const { fetchImpl } = fakeFetch(handler);
  return createCommerce({ projectId: "p1", apiBase: "https://api.test", fetch: fetchImpl, storage: new MemoryStorageAdapter(), locale: "en-US" });
}

function CartCount() {
  const { count, cart, ready } = useCart();
  return createElement("div", null, createElement("span", { "data-testid": "count" }, ready ? String(count) : "-"), createElement("span", { "data-testid": "total" }, cart ? String(cart.totalAmount) : "-"));
}

function StoreName() {
  const { data, loading } = useStore();
  return createElement("span", { "data-testid": "store" }, loading ? "loading" : data?.storeName || "none");
}

function ProductTitle() {
  const { data } = useProduct("a");
  return createElement("span", { "data-testid": "product" }, data?.title || "");
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("@grigora/commerce-react", () => {
  it("provides the instance and updates hooks as the cart changes", async () => {
    const commerce = makeCommerce();
    render(
      createElement(
        GrigoraProvider,
        { commerce, ui: false },
        createElement(CartCount),
        createElement(AddToCartButton, { productId: "a", quantity: 2 }, "Add"),
        createElement(CartBadge, { showZero: true }),
        createElement(StoreName),
        createElement(ProductTitle),
        createElement(Price, { product: "a" })
      )
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));
    await waitFor(() => expect(screen.getByTestId("store").textContent).toBe("Test Store"));
    await waitFor(() => expect(screen.getByTestId("product").textContent).toBe("Product a"));
    await waitFor(() => expect(screen.getByText("$12.00")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText("Add"));
    });
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("2"));
    await waitFor(() => expect(screen.getByTestId("total").textContent).toBe("2400"));
    await waitFor(() => expect(screen.getByText("Added")).toBeTruthy());
    expect(commerce.cart.findLine("a")?.quantity).toBe(2);
  });

  it("renders safely before the provider has an instance", () => {
    render(createElement(GrigoraProvider, { ui: false }, createElement(CartCount)));
    expect(screen.getByTestId("count").textContent).toBe("-");
  });
});
