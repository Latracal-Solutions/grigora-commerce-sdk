# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
