import { normalizeCountryCode } from "./countries";
import type { Address, ApiAddress } from "./types";

/*
  Address validation, ported rule-for-rule from the Grigora API so the UI can
  mark a field wrong before the request is sent and never disagree with the
  server about what is acceptable. Field keys are the SDK's camelCase names.
*/

export type AddressField = keyof Address;

function cleanAddressText(value: unknown, max = 2000): string {
  return String(value ?? "")
    .trim()
    .slice(0, max)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>]/g, "");
}

export function cleanPhone(value: unknown): string {
  return cleanAddressText(value, 32).replace(/[^\d()+\-\s.]/g, "");
}

export function cleanPostalCode(value: unknown): string {
  return cleanAddressText(value, 40)
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
}

export function isValidEmail(value: unknown): boolean {
  const email = cleanAddressText(value, 240).toLowerCase();
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email);
}

function phoneDigits(value: unknown): string {
  return cleanPhone(value).replace(/\D/g, "");
}

export function isValidPhone(value: unknown, country = ""): boolean {
  const digits = phoneDigits(value);
  const code = normalizeCountryCode(country);
  if (!digits) return false;
  if (code === "US" || code === "CA") return /^(1)?[2-9]\d{9}$/.test(digits);
  if (code === "IN") return /^(91)?[6-9]\d{9}$/.test(digits);
  if (code === "GB") return /^(44)?[1-9]\d{9,10}$/.test(digits) || /^0[1-9]\d{8,9}$/.test(digits);
  if (code === "AU") return /^(61)?[2-478]\d{8}$/.test(digits) || /^0[2-478]\d{8}$/.test(digits);
  return /^[1-9]\d{6,14}$/.test(digits);
}

export function isValidPostalCode(value: unknown, country = ""): boolean {
  const postal = cleanPostalCode(value);
  const compact = postal.replace(/[\s-]/g, "");
  const code = normalizeCountryCode(country);
  if (!postal) return false;
  if (code === "US") return /^\d{5}(\d{4})?$/.test(compact);
  if (code === "IN") return /^[1-9]\d{5}$/.test(compact);
  if (code === "AU") return /^\d{4}$/.test(compact);
  if (code === "CA") return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(compact);
  if (code === "GB") return /^(GIR0AA|[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/.test(compact);
  return /^(?=.*\d)[A-Z0-9][A-Z0-9 -]{2,15}$/.test(postal);
}

export function isValidAddressName(value: unknown, required = true): boolean {
  const text = cleanAddressText(value, 120);
  if (!text) return !required;
  return /^[\p{L}][\p{L}\p{M} .'-]{1,119}$/u.test(text);
}

/** Whether the country's postal codes are a fixed shape worth normalising as the shopper types. */
export function normalizePostalForCountry(value: unknown, country = ""): string {
  const code = normalizeCountryCode(country);
  let postal = String(value ?? "").toUpperCase().replace(/[^A-Z0-9 -]/g, "");
  if (code === "US") postal = postal.replace(/[^0-9-]/g, "").slice(0, 10);
  else if (code === "IN" || code === "AU") postal = postal.replace(/\D/g, "").slice(0, code === "IN" ? 6 : 4);
  else if (code === "CA" && postal.length > 3 && !postal.includes(" ")) postal = `${postal.slice(0, 3)} ${postal.slice(3, 6)}`;
  return postal.slice(0, 16);
}

export interface AddressValidationOptions {
  requirePhone?: boolean;
}

export function normalizeAddress(input: Partial<Address> | null | undefined): Address {
  const source = input || {};
  return {
    name: cleanAddressText(source.name, 160),
    email: cleanAddressText(source.email, 240).toLowerCase(),
    phone: cleanPhone(source.phone),
    line1: cleanAddressText(source.line1, 240),
    line2: cleanAddressText(source.line2, 240),
    city: cleanAddressText(source.city, 120),
    state: cleanAddressText(source.state, 120),
    postalCode: cleanPostalCode(source.postalCode),
    country: normalizeCountryCode(source.country),
    taxId: cleanAddressText(source.taxId, 80),
  };
}

/** The fields the API would reject, in the order the API reports them. Empty when valid. */
export function addressErrors(input: Partial<Address> | null | undefined, options: AddressValidationOptions = {}): AddressField[] {
  const address = normalizeAddress(input);
  const requirePhone = options.requirePhone !== false;
  const errors: AddressField[] = [];
  if (!address.name) errors.push("name");
  if (!isValidEmail(address.email)) errors.push("email");
  if (!address.line1) errors.push("line1");
  if (!isValidAddressName(address.city)) errors.push("city");
  if (!isValidAddressName(address.state, false)) errors.push("state");
  if (!isValidPostalCode(address.postalCode, address.country)) errors.push("postalCode");
  if (!address.country) errors.push("country");
  if (requirePhone && !isValidPhone(address.phone, address.country)) errors.push("phone");
  return errors;
}

export function isAddressValid(input: Partial<Address> | null | undefined, options?: AddressValidationOptions): boolean {
  return addressErrors(input, options).length === 0;
}

export const ADDRESS_FIELD_LABELS: Record<AddressField, string> = {
  name: "full name",
  email: "email",
  phone: "phone number",
  line1: "address",
  line2: "address line 2",
  city: "city",
  state: "state / region",
  postalCode: "postal code",
  country: "country",
  taxId: "tax id",
};

export function addressErrorMessage(label: string, errors: AddressField[]): string {
  const list = Array.from(new Set(errors)).map((field) => ADDRESS_FIELD_LABELS[field]);
  return list.length ? `${label} needs a valid ${list.join(", ")}.` : "";
}

export function toApiAddress(input: Partial<Address> | null | undefined): ApiAddress {
  const a = normalizeAddress(input);
  return {
    name: a.name,
    email: a.email,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    postal_code: a.postalCode,
    country: a.country,
    tax_id: a.taxId,
  };
}

export function fromApiAddress(input: Partial<ApiAddress> | null | undefined): Address {
  const s = input || {};
  return normalizeAddress({
    name: s.name,
    email: s.email,
    phone: s.phone,
    line1: s.line1,
    line2: s.line2,
    city: s.city,
    state: s.state,
    postalCode: s.postal_code,
    country: s.country,
    taxId: s.tax_id,
  });
}
