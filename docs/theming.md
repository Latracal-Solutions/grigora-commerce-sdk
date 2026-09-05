# Theming

The UI is plain light DOM styled by one injected stylesheet, scoped under `[data-g-ui]`, and driven by CSS custom properties. The store's accent colour (Commerce → Settings → Appearance) is applied automatically; anything you set wins over it.

## Variables

```css
:root {
  --g-accent: #111827;          /* buttons, focus rings, active states */
  --g-accent-contrast: #fff;    /* text on the accent */
  --g-bg: #fff;
  --g-fg: #111827;
  --g-muted: #6b7280;
  --g-line: #e5e7eb;
  --g-radius: 10px;
  --g-font: inherit;            /* inherits your page font by default */
  --g-drawer-width: 420px;
  --g-overlay: rgba(17, 24, 39, .5);
  --g-z: 2147483000;            /* above builder chrome and sticky headers */
  --g-danger: #b91c1c;
  --g-success: #047857;
}
```

Set them in your own CSS, through the script tag (`data-accent`, `data-font`, `data-radius`), through `installUI(commerce, { theme: { accent: "#e11d48" } })`, or at runtime with `commerce.ui.setTheme({ accent })`.

## Dark surfaces

```css
:root { --g-bg: #0b0f19; --g-fg: #f3f4f6; --g-muted: #9ca3af; --g-line: #1f2937; --g-overlay: rgba(0,0,0,.7); }
```

## Overriding parts

Every piece has a stable class: `.g-cart-drawer`, `.g-cart-line`, `.g-btn`, `.g-btn-primary`, `.g-checkout-layout`, `.g-checkout-summary`, `.g-buybox`, `.g-chip`, `.g-order`… Selectors in the SDK stylesheet are prefixed with `[data-g-ui]`, so your override needs the same or more specificity:

```css
[data-g-ui] .g-btn-primary { text-transform: uppercase; letter-spacing: .06em; }
.g-cart-drawer[data-g-ui] { --g-drawer-width: 480px; }
```

## Bring your own stylesheet

`installUI(commerce, { injectStyles: false })` (or `data-styles="false"`) skips the injection. Import `BASE_CSS` and `themeCss()` from `@grigora/commerce-ui` if you want to bundle them yourself.

## Strings

Every visible string is overridable: `installUI(commerce, { strings: { cartTitle: "Your basket", checkout: "Pay now" } })`. See `EN` in `@grigora/commerce-ui` for the full key list; placeholders like `{amount}` are kept.

## Payment forms

Stripe's Payment Element receives the accent colour and font (`appearance.variables`); pass more through `createStripeAdapter({ appearance })`. Razorpay's overlay receives `theme.color`.
