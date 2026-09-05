# Integrations: WordPress, Webflow, Framer, Bubble, Astro, and Grigora sites

Every integration is the same two steps: load the script once, mark up buttons. The store's products, prices, stock, shipping and taxes come from Grigora; the page only needs product ids or slugs.

Before any third-party site can complete a purchase, set **Storefront base URL** in Grigora → Commerce → Settings to that site's origin (e.g. `https://shop.example.com`). The API redirects back only to allow-listed origins after payment.

## Plain HTML / static site

```html
<script src="https://cdn.grigora.co/commerce/v1/sdk.js" data-project="PROJECT_ID" async></script>
<button data-grigora-add data-product-slug="blue-mug">Add to cart</button>
<a href="#" data-cart-open>Cart (<span data-cart-count>0</span>)</a>
```

## WordPress

1. Enqueue the script in your theme's `functions.php` or via a snippets plugin:

```php
add_action('wp_enqueue_scripts', function () {
  wp_enqueue_script('grigora-commerce', 'https://cdn.grigora.co/commerce/v1/sdk.js', [], null, true);
});
add_filter('script_loader_tag', function ($tag, $handle) {
  if ($handle !== 'grigora-commerce') return $tag;
  return str_replace(' src=', ' async data-project="PROJECT_ID" data-checkout-url="/checkout/" src=', $tag);
}, 10, 2);
```

2. Add buttons with a Custom HTML block (or a shortcode that prints them):

```php
add_shortcode('grigora_add', function ($atts) {
  $a = shortcode_atts(['product' => '', 'label' => 'Add to cart'], $atts);
  return sprintf('<button class="wp-element-button" data-grigora-add data-product-slug="%s">%s</button>', esc_attr($a['product']), esc_html($a['label']));
});
// [grigora_add product="blue-mug"]
```

3. Create a page at `/checkout/` containing `<div data-grigora-checkout></div>` (Custom HTML block), or leave `data-checkout-url` out to use the dialog.

The SDK needs no server code, no PHP session and no WooCommerce.

## Webflow

Site settings → Custom code → Head: paste the script tag. Then add an Embed element wherever you want a button:

```html
<button class="button" data-grigora-add data-product-slug="blue-mug">Add to cart</button>
```

For a product page built from a Webflow CMS collection, bind the slug: `data-product-slug="{{wf {&quot;path&quot;:&quot;slug&quot;} }}"` (use the Embed's "Add field" button so Webflow inserts the field for you). Add a `<div data-grigora-buy-box data-product-slug="…"></div>` for the full variant picker. Keep Grigora product slugs equal to your Webflow slugs and nothing else needs wiring.

## Framer

Site Settings → General → Custom Code → Start of `<head>`: the script tag. Use a Code Embed component for buttons and the buy box exactly as above. Framer pages are client-rendered; the SDK's delegated listener and MutationObserver pick elements up when Framer mounts them.

## Bubble

Settings → SEO / metatags → Script in the header: the script tag. Place an HTML element with the button markup; use Bubble's dynamic data to fill `data-product-slug`. Bubble re-renders often; that is fine, bindings are delegated.

## Astro / Eleventy / Hugo (static builds)

Load the script in the layout `<head>` and render buttons from your build data. If you generate product pages from the Grigora storefront API at build time, fetch `https://api.grigora.co/general/commerce/storefront/PROJECT_ID/catalog` in your build step ([backend API](./backend-api.md)) and emit `<g-buy-box product="{slug}">` per page.

## Grigora-published sites

Published Grigora sites already carry `<html data-g-project="…">`, so the script needs no `data-project`. The cart storage key and format are shared with the platform's own storefront scripts: a shopper's cart survives moving between a platform page and an SDK page, and the platform `/checkout`, `/cart` and `/thank-you` routes keep working. Point `data-checkout-url="/checkout"` at the platform checkout if you want to keep it, or let the SDK render its own.

## Single page apps

Pass `navigate` to route success pages client-side, and use the [React](./react.md) or [Vue](./vue.md) wrappers. Hosted provider redirects always leave the page and come back to `successUrl`.
