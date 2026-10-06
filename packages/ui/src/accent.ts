/**
 * The accent the payment form should use: the site's CSS variable first (that
 * is what the rest of the UI is painted with), the store's setting only as a
 * fallback, then the SDK default.
 */
export function resolveAccent(element: Element, storeAccent = ""): string {
  let computed = "";
  try {
    computed = getComputedStyle(element).getPropertyValue("--g-accent").trim();
  } catch {
    computed = "";
  }
  const valid = (value: string) => /^#[0-9a-f]{3,8}$/i.test(value) || /^(rgb|hsl|oklch|color)\(/i.test(value);
  if (valid(computed)) return computed;
  if (valid(storeAccent)) return storeAccent;
  return "#111827";
}
