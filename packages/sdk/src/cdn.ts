/*
  CDN entry: <script src="https://cdn.grigora.co/commerce/v1/sdk.js" data-project="…" async></script>
  Exposes window.Grigora.Commerce, flushes window.Grigora.q, and starts the
  storefront from the script tag's data attributes.
*/
import { autoInit, installGlobal } from "./global";

installGlobal();
autoInit(typeof document !== "undefined" ? document.currentScript : null);
