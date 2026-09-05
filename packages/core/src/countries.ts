/**
 * ISO 3166-1 alpha-2 codes the Grigora checkout accepts. Mirrors the API's
 * VALID_CHECKOUT_COUNTRIES exactly; an address with any other country is
 * rejected server-side, so the SDK never offers one. Display names live in
 * @grigora/commerce-ui (COUNTRIES) to keep the headless core small.
 */
export const COUNTRY_CODE_LIST = "AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI KH CM CA CV KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW";

export const COUNTRY_CODES: ReadonlySet<string> = new Set(COUNTRY_CODE_LIST.split(" "));

const COUNTRY_ALIASES: Record<string, string> = {
  UNITEDSTATES: "US",
  UNITEDSTATESOFAMERICA: "US",
  USA: "US",
  INDIA: "IN",
  UNITEDKINGDOM: "GB",
  UK: "GB",
  GREATBRITAIN: "GB",
  CANADA: "CA",
  AUSTRALIA: "AU",
};

/** "USA" -> "US", "gb" -> "GB", "Mars" -> "". Same rules as the API. */
export function normalizeCountryCode(value: unknown): string {
  const text = String(value ?? "").trim().slice(0, 80).toUpperCase();
  if (/^[A-Z]{2}$/.test(text) && COUNTRY_CODES.has(text)) return text;
  const alias = COUNTRY_ALIASES[text.replace(/[^A-Z]/g, "")] || "";
  return alias && COUNTRY_CODES.has(alias) ? alias : "";
}
