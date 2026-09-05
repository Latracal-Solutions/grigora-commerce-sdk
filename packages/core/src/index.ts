export * from "./types";
export { GrigoraError, isGrigoraError, toGrigoraError, mapApiError } from "./errors";
export type { GrigoraErrorCode, ErrorContext } from "./errors";
export { ApiClient, COMMERCE_PATH } from "./client";
export type { ApiClientOptions, RequestOptions } from "./client";
export { Emitter } from "./events";
export type { Listener } from "./events";
export {
  LocalStorageAdapter,
  MemoryStorageAdapter,
  defaultStorage,
  getOrCreateClientId,
  readJson,
  writeJson,
  CLIENT_ID_PATTERN,
  DEFAULT_CLIENT_ID_KEY,
} from "./storage";
export { formatMinor, toMinor, toMajor, currencySymbol, normalizeCurrency, createCurrencyAPI, MINOR_UNITS_PER_MAJOR } from "./currency";
export { COUNTRY_CODES, COUNTRY_CODE_LIST, normalizeCountryCode } from "./countries";
export {
  addressErrors,
  addressErrorMessage,
  isAddressValid,
  normalizeAddress,
  toApiAddress,
  fromApiAddress,
  isValidEmail,
  isValidPhone,
  isValidPostalCode,
  isValidAddressName,
  normalizePostalForCountry,
  cleanPhone,
  cleanPostalCode,
  ADDRESS_FIELD_LABELS,
} from "./validation";
export type { AddressField, AddressValidationOptions } from "./validation";
export { CartStore, lineIdFor, mapTotals, mapShippingQuote } from "./cart";
export type { StoredCartItem, CartStoreDeps } from "./cart";
export { CatalogClient, mapProduct, mapVariant, mapCollection, mapStore } from "./catalog";
export { CheckoutClient, toSession } from "./checkout";
export { OrdersClient, DiscountsClient, AvailabilityClient, mapOrder, orderPaymentState, orderReference } from "./orders";
export {
  ProviderRegistryImpl,
  hostedAdapter,
  providerLabel,
  loadExternalScript,
  resetExternalScripts,
  registerGlobalProvider,
  listGlobalProviders,
} from "./providers";
export { createCommerce, init, getInstance, onReady, registerProvider, resolveConfig, resetDefaultInstance } from "./commerce";
export { isBrowser, uuid, stableStringify, defaultApiBase, isSafeHttpUrl } from "./util";
export { VERSION } from "./version";

import { createCommerce, init, getInstance, onReady, registerProvider } from "./commerce";
import { VERSION } from "./version";

/** Namespace-style entry point mirroring the CDN global `Grigora.Commerce`. */
export const Commerce = Object.freeze({
  version: VERSION,
  init,
  create: createCommerce,
  get: getInstance,
  onReady,
  registerProvider,
});
