/*
  One stylesheet for every SDK surface.

  Precedence is deliberate and is the contract with integrators:

  - Theme variables are declared on `:where(:root)`, which has zero
    specificity. A site's own `:root { --g-accent: … }` therefore always wins,
    no matter where the SDK's <style> lands in the document. The store's
    accent colour from its settings is the lowest default, not an override.
  - Component rules are prefixed with `:where([data-g-ui])`, so they carry the
    specificity of a single class. A site override written as
    `[data-g-ui] .g-btn-primary { … }` (or any two-part selector) beats them,
    while a generic reset such as `button { background: transparent }` does not
    leak in.
*/

export interface UITheme {
  accent: string;
  accentContrast: string;
  background: string;
  foreground: string;
  muted: string;
  line: string;
  radius: string;
  font: string;
  drawerWidth: string;
  overlay: string;
  zIndex: string;
  danger: string;
  success: string;
}

export const DEFAULT_THEME: UITheme = {
  accent: "#111827",
  accentContrast: "#ffffff",
  background: "#ffffff",
  foreground: "#111827",
  muted: "#6b7280",
  line: "#e5e7eb",
  radius: "10px",
  font: "inherit",
  drawerWidth: "420px",
  overlay: "rgba(17, 24, 39, 0.5)",
  zIndex: "2147483000",
  danger: "#b91c1c",
  success: "#047857",
};

const THEME_VARS: Record<keyof UITheme, string> = {
  accent: "--g-accent",
  accentContrast: "--g-accent-contrast",
  background: "--g-bg",
  foreground: "--g-fg",
  muted: "--g-muted",
  line: "--g-line",
  radius: "--g-radius",
  font: "--g-font",
  drawerWidth: "--g-drawer-width",
  overlay: "--g-overlay",
  zIndex: "--g-z",
  danger: "--g-danger",
  success: "--g-success",
};

const SAFE_CSS_VALUE = /^[#a-zA-Z0-9 ,.()%'"\-_/]+$/;

export function themeCss(theme: Partial<UITheme> = {}): string {
  const merged = { ...DEFAULT_THEME, ...theme };
  const declarations = (Object.keys(THEME_VARS) as Array<keyof UITheme>)
    .map((key) => {
      const value = String(merged[key] ?? DEFAULT_THEME[key]);
      return SAFE_CSS_VALUE.test(value) ? `${THEME_VARS[key]}:${value};` : `${THEME_VARS[key]}:${DEFAULT_THEME[key]};`;
    })
    .join("");
  return `:where(:root){${declarations}}`;
}

const RAW_CSS = `
[data-g-ui],[data-g-ui] *,[data-g-ui] *::before,[data-g-ui] *::after{box-sizing:border-box}
[data-g-ui]{font-family:var(--g-font);color:var(--g-fg);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased}
[data-g-ui] button,[data-g-ui] input,[data-g-ui] select{font:inherit;color:inherit}
[data-g-ui] button{cursor:pointer}
[data-g-ui] button:disabled{cursor:not-allowed;opacity:.55}
[data-g-ui] [hidden]{display:none!important}
[data-g-ui] a{color:inherit}
[data-g-ui] :focus-visible{outline:2px solid var(--g-accent);outline-offset:2px}
[data-g-ui] .g-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
[data-g-ui] svg{display:block}

/* Buttons */
[data-g-ui] .g-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 18px;border-radius:var(--g-radius);border:1px solid transparent;font-weight:600;text-decoration:none;transition:background-color .15s,border-color .15s,color .15s,transform .05s;white-space:nowrap}
[data-g-ui] .g-btn:active:not(:disabled){transform:translateY(1px)}
[data-g-ui] .g-btn-primary{background:var(--g-accent);color:var(--g-accent-contrast)}
[data-g-ui] .g-btn-primary:hover:not(:disabled){filter:brightness(1.08)}
[data-g-ui] .g-btn-secondary{background:var(--g-bg);color:var(--g-fg);border-color:var(--g-line)}
[data-g-ui] .g-btn-secondary:hover:not(:disabled){border-color:var(--g-fg)}
[data-g-ui] .g-btn-block{width:100%}
[data-g-ui] .g-btn-sm{min-height:36px;padding:0 12px;font-size:14px}
[data-g-ui] .g-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid var(--g-line);border-radius:calc(var(--g-radius) - 2px);background:var(--g-bg);color:var(--g-fg);padding:0}
[data-g-ui] .g-icon-btn:hover:not(:disabled){border-color:var(--g-fg)}
[data-g-ui] .g-icon-btn svg{width:18px;height:18px}
[data-g-ui] .g-spinner{width:18px;height:18px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:g-spin .7s linear infinite}
@keyframes g-spin{to{transform:rotate(360deg)}}

/* Overlay + drawer */
.g-cart-overlay[data-g-ui]{position:fixed;inset:0;background:var(--g-overlay);z-index:calc(var(--g-z) - 1);opacity:0;pointer-events:none;transition:opacity .25s}
.g-cart-overlay[data-g-ui][data-open]{opacity:1;pointer-events:auto}
.g-cart-drawer[data-g-ui]{position:fixed;top:0;right:0;bottom:0;width:min(var(--g-drawer-width),100vw);background:var(--g-bg);color:var(--g-fg);z-index:var(--g-z);display:flex;flex-direction:column;box-shadow:-16px 0 48px rgba(15,23,42,.18);transform:translateX(100%);transition:transform .28s cubic-bezier(.2,.8,.2,1);visibility:hidden}
.g-cart-drawer[data-g-ui][data-open]{transform:translateX(0);visibility:visible}
.g-cart-drawer[data-g-ui][data-inline]{position:static;width:100%;transform:none;visibility:visible;box-shadow:none;border:1px solid var(--g-line);border-radius:var(--g-radius);height:auto}
@media (prefers-reduced-motion:reduce){.g-cart-drawer[data-g-ui],.g-cart-overlay[data-g-ui],[data-g-ui] .g-dialog{transition:none}}
[data-g-ui] .g-cart-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid var(--g-line)}
[data-g-ui] .g-cart-title{margin:0;font-size:18px;font-weight:700}
[data-g-ui] .g-cart-count-pill{display:inline-block;margin-left:8px;min-width:22px;padding:0 7px;border-radius:999px;background:var(--g-accent);color:var(--g-accent-contrast);font-size:12px;font-weight:700;line-height:22px;text-align:center;vertical-align:middle}
[data-g-ui] .g-cart-body{flex:1;overflow-y:auto;padding:6px 20px;-webkit-overflow-scrolling:touch}
[data-g-ui] .g-cart-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;min-height:260px;color:var(--g-muted);text-align:center;padding:24px 0}
[data-g-ui] .g-cart-empty svg{width:44px;height:44px;opacity:.5}
[data-g-ui] .g-cart-line{display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:14px;padding:16px 0;border-bottom:1px solid var(--g-line)}
[data-g-ui] .g-cart-line:last-child{border-bottom:0}
[data-g-ui] .g-cart-thumb{width:72px;height:72px;border-radius:calc(var(--g-radius) - 2px);border:1px solid var(--g-line);background:#f3f4f6;display:grid;place-items:center;overflow:hidden;color:var(--g-muted)}
[data-g-ui] .g-cart-thumb img{width:100%;height:100%;object-fit:cover;display:block}
[data-g-ui] .g-cart-thumb svg{width:24px;height:24px}
[data-g-ui] .g-cart-line-main{min-width:0;display:flex;flex-direction:column;gap:8px}
[data-g-ui] .g-cart-line-title{font-weight:600;font-size:14px;line-height:1.35;text-decoration:none;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
[data-g-ui] a.g-cart-line-title:hover{text-decoration:underline}
[data-g-ui] .g-cart-line-meta{font-size:12px;color:var(--g-muted)}
[data-g-ui] .g-cart-line-price{font-weight:700;font-size:14px;white-space:nowrap;text-align:right}
[data-g-ui] .g-cart-line-unit{display:block;font-weight:400;font-size:12px;color:var(--g-muted)}
[data-g-ui] .g-qty{display:inline-flex;align-items:center;border:1px solid var(--g-line);border-radius:calc(var(--g-radius) - 2px);height:36px;overflow:hidden}
[data-g-ui] .g-qty button{width:36px;height:100%;border:0;background:transparent;color:var(--g-fg);display:grid;place-items:center;padding:0}
[data-g-ui] .g-qty button:hover:not(:disabled){background:#f3f4f6}
[data-g-ui] .g-qty button svg{width:14px;height:14px}
[data-g-ui] .g-qty output,[data-g-ui] .g-qty input{min-width:34px;text-align:center;font-weight:600;font-size:14px;border:0;background:transparent;padding:0;-moz-appearance:textfield}
[data-g-ui] .g-qty input::-webkit-inner-spin-button{-webkit-appearance:none}
[data-g-ui] .g-cart-line-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
[data-g-ui] .g-link-btn{border:0;background:transparent;padding:0;color:var(--g-muted);font-size:13px;text-decoration:underline;text-underline-offset:3px}
[data-g-ui] .g-link-btn:hover{color:var(--g-fg)}
[data-g-ui] .g-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
[data-g-ui] .g-badge-danger{background:#fef2f2;color:var(--g-danger)}
[data-g-ui] .g-badge-muted{background:#f3f4f6;color:var(--g-muted)}
[data-g-ui] .g-badge-success{background:#ecfdf5;color:var(--g-success)}
[data-g-ui] .g-cart-foot{border-top:1px solid var(--g-line);padding:16px 20px 20px;display:flex;flex-direction:column;gap:12px;background:var(--g-bg)}
[data-g-ui] .g-rows{display:flex;flex-direction:column;gap:6px;font-size:14px}
[data-g-ui] .g-row{display:flex;justify-content:space-between;gap:12px;color:var(--g-muted)}
[data-g-ui] .g-row strong{color:var(--g-fg)}
[data-g-ui] .g-row-total{font-size:17px;font-weight:700;color:var(--g-fg);padding-top:8px;margin-top:2px;border-top:1px dashed var(--g-line)}
[data-g-ui] .g-row-total span{color:var(--g-fg)}
[data-g-ui] .g-note{margin:0;font-size:12px;color:var(--g-muted)}
[data-g-ui] .g-alert{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:calc(var(--g-radius) - 2px);font-size:13px;background:#fef2f2;color:var(--g-danger);border:1px solid #fecaca}
[data-g-ui] .g-alert-info{background:#f3f4f6;color:var(--g-fg);border-color:var(--g-line)}
[data-g-ui] .g-alert-success{background:#ecfdf5;color:var(--g-success);border-color:#a7f3d0}
[data-g-ui] .g-alert button{margin-left:auto}
[data-g-ui] .g-skeleton{display:inline-block;height:14px;width:64px;border-radius:6px;background:linear-gradient(90deg,#f3f4f6,#e5e7eb,#f3f4f6);background-size:200% 100%;animation:g-shimmer 1.2s infinite}
@keyframes g-shimmer{to{background-position:-200% 0}}

/* Discount field */
[data-g-ui] .g-discount{display:flex;gap:8px}
[data-g-ui] .g-discount input{flex:1;min-width:0}
[data-g-ui] .g-discount-applied{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;padding:8px 12px;border:1px dashed var(--g-line);border-radius:calc(var(--g-radius) - 2px)}
[data-g-ui] .g-discount-applied code{font-weight:700}

/* Forms */
[data-g-ui] .g-field{display:flex;flex-direction:column;gap:6px;min-width:0}
[data-g-ui] .g-field label{font-size:13px;font-weight:600}
[data-g-ui] .g-input,[data-g-ui] .g-select{width:100%;min-height:46px;padding:0 14px;border:1px solid var(--g-line);border-radius:calc(var(--g-radius) - 2px);background:var(--g-bg);color:var(--g-fg);font-size:15px;transition:border-color .15s,box-shadow .15s}
[data-g-ui] .g-input:focus,[data-g-ui] .g-select:focus{outline:0;border-color:var(--g-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--g-accent) 18%,transparent)}
[data-g-ui] .g-input[aria-invalid="true"],[data-g-ui] .g-select[aria-invalid="true"]{border-color:var(--g-danger)}
[data-g-ui] .g-field-error{font-size:12px;color:var(--g-danger)}
[data-g-ui] .g-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
[data-g-ui] .g-grid .g-span{grid-column:1/-1}
@media (max-width:480px){[data-g-ui] .g-grid{grid-template-columns:1fr}}
[data-g-ui] .g-check{display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer}
[data-g-ui] .g-check input{width:18px;height:18px;accent-color:var(--g-accent);margin:0}
[data-g-ui] .g-radio-list{display:flex;flex-direction:column;gap:8px}
[data-g-ui] .g-radio{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--g-line);border-radius:calc(var(--g-radius) - 2px);cursor:pointer}
[data-g-ui] .g-radio:has(input:checked){border-color:var(--g-accent);box-shadow:0 0 0 1px var(--g-accent)}
[data-g-ui] .g-radio input{accent-color:var(--g-accent);margin:0}
[data-g-ui] .g-radio-main{flex:1;min-width:0}
[data-g-ui] .g-radio-sub{font-size:12px;color:var(--g-muted)}

/* Checkout */
[data-g-ui].g-checkout{display:block}
[data-g-ui] .g-checkout-layout{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(300px,.85fr);gap:32px;align-items:start}
@media (max-width:860px){[data-g-ui] .g-checkout-layout{grid-template-columns:1fr}[data-g-ui] .g-checkout-summary{order:-1}}
[data-g-ui] .g-checkout-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}
[data-g-ui] .g-checkout-head h2{margin:0;font-size:22px;font-weight:700}
[data-g-ui] .g-checkout-store{font-size:13px;color:var(--g-muted)}
[data-g-ui] .g-steps{display:flex;gap:8px;font-size:12px;color:var(--g-muted);margin-bottom:18px;flex-wrap:wrap}
[data-g-ui] .g-step{display:inline-flex;align-items:center;gap:6px}
[data-g-ui] .g-step i{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;border:1px solid var(--g-line);font-style:normal;font-size:11px;font-weight:700}
[data-g-ui] .g-step[data-active] { color:var(--g-fg);font-weight:600 }
[data-g-ui] .g-step[data-active] i{background:var(--g-accent);color:var(--g-accent-contrast);border-color:var(--g-accent)}
[data-g-ui] .g-section{display:flex;flex-direction:column;gap:14px;padding:20px;border:1px solid var(--g-line);border-radius:var(--g-radius);background:var(--g-bg)}
[data-g-ui] .g-section + .g-section{margin-top:16px}
[data-g-ui] .g-section h3{margin:0;font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px}
[data-g-ui] .g-section h3 svg{width:16px;height:16px;color:var(--g-muted)}
[data-g-ui] .g-payment-mount{min-height:40px}
[data-g-ui] .g-payment-mount:empty{display:none}
[data-g-ui] .g-checkout-summary{position:sticky;top:16px;display:flex;flex-direction:column;gap:14px;padding:20px;border:1px solid var(--g-line);border-radius:var(--g-radius);background:#fafafa}
[data-g-ui] .g-summary-lines{display:flex;flex-direction:column;gap:12px;max-height:320px;overflow:auto}
[data-g-ui] .g-summary-line{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:12px;align-items:center;font-size:14px}
[data-g-ui] .g-summary-line .g-cart-thumb{width:52px;height:52px;position:relative}
[data-g-ui] .g-summary-qty{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--g-muted);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center}
[data-g-ui] .g-summary-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
[data-g-ui] .g-secure{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--g-muted);justify-content:center}
[data-g-ui] .g-secure svg{width:14px;height:14px}
[data-g-ui] .g-testmode{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:#fffbeb;color:#92400e;font-size:12px;font-weight:600}

/* Dialog */
.g-dialog-root[data-g-ui]{position:fixed;inset:0;z-index:var(--g-z);display:flex;align-items:center;justify-content:center;padding:16px;background:var(--g-overlay);animation:g-fade .2s}
@keyframes g-fade{from{opacity:0}}
[data-g-ui] .g-dialog{position:relative;width:min(100%,var(--g-dialog-width,980px));max-height:calc(100vh - 32px);overflow:auto;background:var(--g-bg);color:var(--g-fg);border-radius:var(--g-radius);box-shadow:0 30px 80px rgba(15,23,42,.35);padding:24px}
[data-g-ui] .g-dialog-sm{--g-dialog-width:460px}
[data-g-ui] .g-dialog-close{position:absolute;top:14px;right:14px}
@media (max-width:640px){.g-dialog-root[data-g-ui]{padding:0;align-items:stretch}[data-g-ui] .g-dialog{max-height:100vh;border-radius:0;padding:20px 16px}}

/* Buy box */
[data-g-ui].g-buybox{display:flex;flex-direction:column;gap:16px}
[data-g-ui] .g-price{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
[data-g-ui] .g-price-now{font-size:24px;font-weight:700}
[data-g-ui] .g-price-was{color:var(--g-muted);text-decoration:line-through}
[data-g-ui] .g-option{display:flex;flex-direction:column;gap:8px}
[data-g-ui] .g-option-label{font-size:13px;font-weight:600}
[data-g-ui] .g-option-values{display:flex;flex-wrap:wrap;gap:8px}
[data-g-ui] .g-chip{min-height:38px;padding:0 14px;border:1px solid var(--g-line);border-radius:calc(var(--g-radius) - 2px);background:var(--g-bg)}
[data-g-ui] .g-chip[aria-pressed="true"]{border-color:var(--g-accent);box-shadow:0 0 0 1px var(--g-accent);font-weight:600}
[data-g-ui] .g-chip[data-unavailable]{text-decoration:line-through;color:var(--g-muted)}
[data-g-ui] .g-buybox-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
[data-g-ui] .g-buybox-actions .g-btn{flex:1 1 160px}
[data-g-ui] .g-stock{font-size:13px;color:var(--g-muted)}
[data-g-ui] .g-stock[data-low]{color:#b45309}
[data-g-ui] .g-stock[data-out]{color:var(--g-danger)}
[data-g-ui] .g-pwyw{display:flex;align-items:center;gap:8px}
[data-g-ui] .g-pwyw .g-input{max-width:160px}

/* Order status */
[data-g-ui].g-order{display:flex;flex-direction:column;gap:18px;text-align:center;align-items:center;padding:8px}
[data-g-ui] .g-order-icon{width:64px;height:64px;border-radius:20px;display:grid;place-items:center;background:#f3f4f6;color:var(--g-muted)}
[data-g-ui] .g-order-icon svg{width:30px;height:30px}
[data-g-ui].g-order[data-state="paid"] .g-order-icon{background:#ecfdf5;color:var(--g-success)}
[data-g-ui].g-order[data-state="pending"] .g-order-icon{background:#fffbeb;color:#b45309}
[data-g-ui].g-order[data-state="failed"] .g-order-icon,[data-g-ui].g-order[data-state="error"] .g-order-icon{background:#fef2f2;color:var(--g-danger)}
[data-g-ui] .g-order h2{margin:0;font-size:24px;font-weight:700}
[data-g-ui] .g-order p{margin:0;color:var(--g-muted);max-width:52ch}
[data-g-ui] .g-order-ref{display:inline-flex;gap:6px;padding:6px 12px;border:1px solid var(--g-line);border-radius:999px;font-size:13px;font-weight:600}
[data-g-ui] .g-order-lines{width:100%;max-width:440px;text-align:left;border-top:1px solid var(--g-line);padding-top:12px}
[data-g-ui] .g-order-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}

/* Toast */
.g-toast[data-g-ui]{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:var(--g-z);max-width:min(92vw,420px);padding:12px 16px;border-radius:var(--g-radius);background:var(--g-fg);color:var(--g-bg);font-size:14px;box-shadow:0 12px 30px rgba(15,23,42,.25);animation:g-fade .2s}
.g-toast[data-g-ui][data-type="error"]{background:var(--g-danger);color:#fff}
.g-toast[data-g-ui][data-type="success"]{background:var(--g-success);color:#fff}

/* Badge / launcher */
g-cart-badge[data-g-ui]{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--g-accent);color:var(--g-accent-contrast);font-size:12px;font-weight:700;line-height:1}
g-cart-badge[data-g-ui][hidden]{display:none}
[data-g-ui] .g-added{color:var(--g-success)}

/* Checkout summary: collapsible on small screens */
[data-g-ui] .g-summary-toggle{display:none;width:100%;align-items:center;justify-content:space-between;gap:12px;padding:0;border:0;background:transparent;font:inherit;font-weight:700;text-align:left}
[data-g-ui] .g-summary-toggle svg{width:18px;height:18px;transition:transform .2s;flex:0 0 auto}
[data-g-ui] .g-summary-toggle[aria-expanded="true"] svg{transform:rotate(180deg)}
[data-g-ui] .g-summary-toggle-total{margin-left:auto;font-weight:700}
[data-g-ui] .g-summary-body{display:flex;flex-direction:column;gap:14px}
@media (max-width:860px){
  [data-g-ui] .g-checkout-summary{position:static;padding:14px 16px;gap:10px}
  [data-g-ui] .g-summary-toggle{display:flex}
  [data-g-ui] .g-summary-heading{display:none}
  [data-g-ui] .g-checkout-summary[data-collapsed] .g-summary-body{display:none}
  [data-g-ui] .g-section{padding:16px}
  [data-g-ui] .g-input,[data-g-ui] .g-select{font-size:16px}
  [data-g-ui] .g-pay-bar{position:sticky;bottom:0;z-index:1;padding:10px 0 12px;background:var(--g-bg);border-top:1px solid var(--g-line)}
  [data-g-ui] .g-checkout-head{flex-wrap:wrap}
}
`;

/** RAW_CSS with every `[data-g-ui]` lowered to `:where([data-g-ui])` — see the note at the top of this file. */
export const BASE_CSS = RAW_CSS.replace(/\[data-g-ui\]/g, ":where([data-g-ui])");

export const STYLE_ID = "grigora-commerce-ui";
export const THEME_STYLE_ID = "grigora-commerce-theme";

export function injectStyles(doc: Document, theme: Partial<UITheme> = {}): void {
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = BASE_CSS;
    doc.head.appendChild(style);
  }
  applyTheme(doc, theme);
}

export function applyTheme(doc: Document, theme: Partial<UITheme>): void {
  let style = doc.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = THEME_STYLE_ID;
    const base = doc.getElementById(STYLE_ID);
    if (base?.parentNode) base.parentNode.insertBefore(style, base);
    else doc.head.appendChild(style);
  }
  style.textContent = themeCss(theme);
}
