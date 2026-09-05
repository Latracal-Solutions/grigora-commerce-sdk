# The Grigora commerce API the SDK talks to

Base: `https://api.grigora.co/general/commerce`. Every JSON response is wrapped as `{ "Output": … }`; every error as `{ "Output": { "code"?, "message" } }` with a 4xx/5xx status. Amounts are integers in minor units. CORS is open. No authentication: these routes only expose what a shopper may see or do.

## Storefront (read)

Public, cached 60 s. Only active products and published collections; only publishable keys.

| Route | Returns |
| --- | --- |
| `GET /storefront/:projectID/catalog` | `{ store, products[], collections[] }` — one call to boot a storefront |
| `GET /storefront/:projectID/products?collection=&q=&ids=&in_stock=1&sort=newest|oldest|price_asc|price_desc|title&limit=50&cursor=` | `{ products[], total, limit, next_cursor }` |
| `GET /storefront/:projectID/products/:idOrSlug` | `{ product }` (404 for drafts) |
| `GET /storefront/:projectID/collections` | `{ collections[] }` |
| `GET /storefront/:projectID/settings` | `{ store }` |

`product`: `id, slug, title, subtitle, edition_label, description, product_type, pricing_type, price_amount, compare_at_amount, currency, image_url, image_alt, images[], gallery[{url,type,alt}], highlights[], faqs[], shipping_note, sample_url, sku, requires_shipping, digital, inventory{tracked,available}, in_stock, options[{name,values}], has_variants, variants[{variant_id, sku, title, option_values, price_amount, compare_at_amount, currency, image_url, requires_shipping, inventory, in_stock}], collections[] (slugs), product_url, seo, created_at, updated_at`.

`store`: `project_id, store_name, currency, support_email, storefront_base_url, storefront_origins[], checkout{provider, mode: embedded|hosted|unavailable, embedded_supported, hosted_supported, test_mode, code, message, stripe_publishable_key?, razorpay_key_id?}, shipping{configured, allowed_countries[]}, tax{mode, prices_include_tax}, appearance{theme_preset, accent_color, background_color, text_color, button_style}, newsletter_optin`.

## Cart and checkout (write)

| Route | Body | Returns |
| --- | --- | --- |
| `POST /cart/validate` | `{ project_id, line_items[{product_id, variant_id, quantity}], discount_code?, billing_address?, shipping_address?, shipping_rate_id? }` | `{ line_items[], subtotal_amount, discount_*, shipping_amount, shipping_quote{eligible, message, rate_id, available_rates[]}, tax_*, total_is_estimate, total_amount, currency, all_in_stock, requires_shipping, item_count }` |
| `POST /checkout/session` | line items + `billing_address`, `shipping_address`, `shipping_rate_id?`, `discount_code?`, `success_url`, `cancel_url`; headers `Idempotency-Key`, `X-Grigora-Checkout-Client` | `{ checkout{provider, mode: hosted|free, checkout_url, order_id, lookup_token, cancel_url, reservation_expires_at}, order_id, totals… }` |
| `POST /checkout/embedded` | same | `{ checkout{provider, mode: embedded, order_id, client_secret + publishable_key (Stripe) or razorpay_order_id + key_id + amount + currency (Razorpay), lookup_token}, … }` |
| `POST /checkout/embedded/confirm` | `{ project_id, provider, order_id, payment_intent_id }` or `{ …, razorpay_order_id, razorpay_payment_id, razorpay_signature }` | `{ ok, order_id, order }` |
| `POST /checkout/cancel` | `{ project_id, order_id, token }` | `{ ok, cancelled }` |
| `POST /checkout/create` | `{ project_id, product_id|slug, variant_id?, custom_amount? (major units), customer_email, customer_name?, discount_code?, provider?, success_url?, cancel_url? }` + idempotency headers | `{ checkout{provider, mode, checkout_url, order_id, lookup_token} }` |
| `POST /storefront/availability` | `{ project_id, items[{product_id, variant_id}] }` | `{ availability[{product_id, variant_id, available, in_stock}] }` |

Address shape: `{ name, email, phone, line1, line2, city, state, postal_code, country }`. Billing needs name, email, phone, line1, city, postal_code, country; shipping the same when the cart has physical items.

## Orders

| Route | | |
| --- | --- | --- |
| `POST /orders/lookup` | `{ project_id, order_id, lookup_token | email }` | `{ order{order_id, status, payment_status, fulfillment_status, currency, total_amount, line_items[], fulfillments[], invoice_*} }` |
| `GET /discounts/validate?project_id&code&product_id|slug` | | `{ ok, code, type, value, discount_amount, currency, original_amount, final_amount }` or `{ ok: false, reason, message }` |
| `GET /delivery/download?project_id&order_id&token&format=json` | | `{ download_url }` |
| `GET /invoice/:project_id/:invoice_id[/pdf]?token=` | | HTML / PDF / `?format=json` |

## Notes for backend maintainers

- The storefront routes live in `general/commerce-storefront.js` (grigora-api-new) and are mounted from `general/commerce.js`. They map hydrated rows through `publicProduct` / `publicStoreSettings`, so column changes never reach published sites.
- `checkout.mode` mirrors the published checkout page's provider decision (`getCartCheckoutProvider` in grigora-render-new); keep the two in step.
- Cart checkout always uses the merchant's selected provider; a client cannot pick another gateway.
