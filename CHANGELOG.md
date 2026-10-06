# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Manual R2 CDN deployment workflow with dry runs, tested build artifacts, content-addressed revisions, public hash verification, and independently promoted `v1` URLs. CDN delivery is separate from npm releases and no longer requires copying bundles into the API.
- `@grigora/commerce-adapter-paddle`: opens Paddle.js for the Paddle transaction the API creates, as an overlay (on "Pay") or as an inline form in the payment step. Included in `@grigora/commerce` and the CDN bundle. Before this, the hosted redirect sent shoppers to a page that never opened Paddle, so Paddle orders stayed unpaid.
- `<g-order-status>` shows **Pay with Paddle** for an unpaid Paddle order (Paddle's `_ptxn` order page) and opens Paddle again, only in the browser that started that checkout. Paddle-hosted checkout goes through this page, and the SDK finds the order again when Paddle returns to its fixed redirect URL.
- Core: `CheckoutReturn.providerTransactionId` and `recovered`; `checkout.remembered()`, `awaitReturn()` and `forget()`; adapter hooks `handlesHostedSession`, `settlesByWebhook` and `resume`.

### Changed
- Paddle orders are not confirmed from the browser. The signed webhook settles them.
- UI size budget 26 kB → 27 kB.

## [0.1.0] - 2026-09-05

First release.

### Added
- `@grigora/commerce-core`: API client with envelope unwrapping, stable error codes, GET retries and idempotent checkout POSTs; localStorage cart compatible with Grigora's platform storefront scripts; products, collections and store settings from the public storefront API; hosted, embedded, free and single-product checkout; orders, discounts, availability; currency helpers; address validation ported from the API; typed events; payment adapter registry with a built-in hosted adapter.
- `@grigora/commerce-ui`: `<g-cart-drawer>`, `<g-cart>`, `<g-cart-badge>`, `<g-cart-launcher>`, `<g-buy-box>`, `<g-add-to-cart>`, `<g-price>`, `<g-checkout>`, `<g-order-status>`; delegated `data-*` bindings and mount-point upgrades; injected, themeable stylesheet; return-URL handling on any page.
- `@grigora/commerce-adapter-stripe` (Payment Element) and `@grigora/commerce-adapter-razorpay` (overlay).
- `@grigora/commerce-react`: provider, hooks and components. `@grigora/commerce-vue`: plugin and composables.
- `@grigora/commerce`: batteries-included package and the CDN bundle (`sdk.js`) with `window.Grigora.Commerce` and script-tag auto-init.
- Documentation, `llms.txt`, `skill.md`, examples, CI with size budgets, release workflow (npm + CDN).

### Backend
- Requires Grigora API with the public storefront read routes (`/general/commerce/storefront/:projectID/…`).
