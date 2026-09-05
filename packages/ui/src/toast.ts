import { h } from "./dom";

let current: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, type: "info" | "error" | "success" = "info", durationMs = 3500): void {
  if (typeof document === "undefined") return;
  if (current) current.remove();
  if (timer) clearTimeout(timer);
  current = h("div", { class: "g-toast", "data-g-ui": "", "data-type": type, role: type === "error" ? "alert" : "status", "aria-live": type === "error" ? "assertive" : "polite" }, message);
  document.body.appendChild(current);
  timer = setTimeout(() => {
    current?.remove();
    current = null;
  }, durationMs);
}
