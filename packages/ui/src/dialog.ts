import { h, icon, lockScroll, trapFocus } from "./dom";

export interface DialogHandle {
  root: HTMLElement;
  panel: HTMLElement;
  close(): void;
  isOpen(): boolean;
}

export interface DialogOptions {
  label: string;
  size?: "sm" | "lg";
  closeLabel?: string;
  onClose?: () => void;
  /** Return false to keep the dialog open (e.g. while a payment is in flight). */
  beforeClose?: () => boolean;
  dismissible?: boolean;
}

/**
 * A modal without <dialog>: focus trapped, background inert, scroll locked,
 * Escape and overlay click close it, focus returns to the opener.
 */
export function openDialog(content: HTMLElement, options: DialogOptions): DialogHandle {
  const opener = document.activeElement as HTMLElement | null;
  const closeButton = h("button", { type: "button", class: "g-icon-btn g-dialog-close", "aria-label": options.closeLabel || "Close" }, icon("close", 18));
  const panel = h(
    "div",
    { class: `g-dialog${options.size === "sm" ? " g-dialog-sm" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": options.label, tabindex: "-1" },
    options.dismissible === false ? null : closeButton,
    content
  );
  const root = h("div", { class: "g-dialog-root", "data-g-ui": "" }, panel);
  let open = true;
  const unlock = lockScroll();
  let untrap: (() => void) | null = null;

  const close = () => {
    if (!open) return;
    if (options.beforeClose && options.beforeClose() === false) return;
    open = false;
    untrap?.();
    unlock();
    root.remove();
    options.onClose?.();
    if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
  };

  closeButton.addEventListener("click", close);
  if (options.dismissible !== false) {
    root.addEventListener("click", (event) => {
      if (event.target === root) close();
    });
  }
  document.body.appendChild(root);
  untrap = trapFocus(panel, () => {
    if (options.dismissible !== false) close();
  });
  const firstField = panel.querySelector<HTMLElement>("input,select,button:not(.g-dialog-close),a[href]");
  (firstField || closeButton).focus();
  return { root, panel, close, isOpen: () => open };
}
