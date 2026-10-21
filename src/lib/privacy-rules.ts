/**
 * Privacy Gate rules — shared by the SDK and the Worker.
 *
 * The module is intentionally dependency free and side effect free so that
 * both bundles can use it:
 *   - the SDK filters a payload before it leaves the browser,
 *   - the Worker validates the same payload again on arrival.
 *
 * The client side filter is a convenience, the server side validation is
 * the guarantee. Neither of them claims to detect every piece of personal
 * data - see docs/PRIVACY.md for the documented limits.
 */

/** The categories a blocked value can belong to. */
export type PrivacyCategory =
  | "email"
  | "token"
  | "creditcard"
  | "phone"
  | "nationalid"
  | "urlquery"
  | "formvalue";

export const PRIVACY_CATEGORIES: PrivacyCategory[] = [
  "email",
  "token",
  "creditcard",
  "phone",
  "nationalid",
  "urlquery",
  "formvalue",
];

/**
 * Property names that are never collected. The list is intentionally wide:
 * a false positive costs one dimension, a false negative leaks data.
 */
export const SENSITIVE_KEYS: readonly string[] = [
  "email",
  "e-mail",
  "emailaddress",
  "mail",
  "name",
  "firstname",
  "lastname",
  "fullname",
  "username",
  "user",
  "userid",
  "customer",
  "customerid",
  "password",
  "pass",
  "passwd",
  "pwd",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
  "authorization",
  "auth",
  "session",
  "sessionid",
  "cookie",
  "phone",
  "tel",
  "mobile",
  "msisdn",
  "ssn",
  "nationalid",
  "tckn",
  "taxid",
  "address",
  "street",
  "city",
  "zip",
  "postcode",
  "creditcard",
  "card",
  "cardnumber",
  "cvv",
  "cvc",
  "iban",
  "birthdate",
  "dob",
  "gender",
  "ip",
  "latitude",
  "longitude",
  "formvalue",
  "formdata",
  "inputvalue",
];

/** Normalised key set for fast lookups. */
const SENSITIVE_KEY_SET = new Set(SENSITIVE_KEYS.map((key) => key.toLowerCase()));

/** True when a property name must never be collected. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_SET.has(key.trim().toLowerCase());
}

/**
 * Query parameter names that are stripped from a URL before it is stored.
 * "state", "code" and "nonce" are included: they are one time OAuth
 * artefacts and still identify a session.
 */
export const SENSITIVE_QUERY_KEYS: readonly string[] = [
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "auth",
  "authorization",
  "key",
  "api_key",
  "apikey",
  "secret",
  "password",
  "passwd",
  "pwd",
  "email",
  "mail",
  "phone",
  "tel",
  "session",
  "sessionid",
  "sid",
  "jwt",
  "code",
  "sig",
  "signature",
  "otp",
  "hash",
  "state",
  "nonce",
  "card",
  "cc",
  "cvv",
  "cvc",
  "iban",
  "ssn",
  "tckn",
  "user",
  "username",
  "uid",
  "reset",
  "verify",
  "invite",
  "x-api-key",
];

const SENSITIVE_QUERY_SET = new Set(SENSITIVE_QUERY_KEYS.map((key) => key.toLowerCase()));

/** A JWT (three base64url parts). */
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/;
/** A long hexadecimal string (API keys, hashes, session ids). */
const HEX_TOKEN = /\b[0-9a-f]{24,}\b/i;
/** A long opaque base64url/Base64 string. */
const B64_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/;
/** A provider key prefix (OpenAI, Stripe, GitHub, …). */
const PREFIXED_KEY = /\b(?:sk|pk|rk|ghp|gho|ghs|glpat|xox[baprs]|AKIA)[-_][A-Za-z0-9_-]{12,}\b/;
/** "Bearer eyJ..." / "token=abc" inside a free text value. */
const AUTH_PHRASE = /\b(?:bearer|basic|token|apikey|api_key|password|passwd|secret)\s*[:=]?\s*\S{8,}/i;
/** An e-mail address. */
const EMAIL = /[^\s@<>()[\],;:]+@[^\s@<>()[\],;:]+\.[a-z]{2,}/i;
/** A phone number (international or national). */
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3}[\s.-]?\d{3}[\s.-]?\d{2,4}\b/;
/** A Turkish national id (11 digits). */
const NATIONAL_ID = /\b[1-9]\d{10}\b/;

/** Luhn check — a 13..19 digit run is only a card when the checksum fits. */
function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let value = digits.charCodeAt(index) - 48;
    if (value < 0 || value > 9) return false;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Classifies a value. Returns the category or null when the value looks
 * harmless. The function never returns the value itself.
 */
export function classifyValue(value: unknown): PrivacyCategory | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  if (EMAIL.test(text)) return "email";
  if (JWT.test(text) || HEX_TOKEN.test(text) || B64_TOKEN.test(text) || PREFIXED_KEY.test(text)) {
    return "token";
  }
  if (AUTH_PHRASE.test(text)) return "token";

  const digits = text.replace(/[\s.-]/g, "");
  if (/^\d{13,19}$/.test(digits) && luhn(digits)) return "creditcard";
  if (NATIONAL_ID.test(text)) return "nationalid";
  if (PHONE.test(text)) return "phone";

  return null;
}

/**
 * Removes the sensitive query parameters of a URL.
 *
 * A parameter is dropped when its name is known or when its value looks
 * sensitive. The result keeps the readable part of the URL, so the owner can
 * still recognise the page.
 */
export function redactUrl(url: string): { url: string; redacted: string[] } {
  const redacted: string[] = [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL: only strip a trailing query string by hand.
    const cut = url.search(/[?#]/);
    if (cut < 0) return { url, redacted };
    const head = url.slice(0, cut);
    const query = url.slice(cut + 1).split("#")[0] ?? "";
    const kept: string[] = [];
    for (const pair of query.split("&")) {
      if (!pair) continue;
      const name = decodeURIComponent(pair.split("=")[0] ?? "").toLowerCase();
      const value = decodeURIComponent(pair.split("=").slice(1).join("=") ?? "");
      if (SENSITIVE_QUERY_SET.has(name) || classifyValue(value)) {
        redacted.push(name || "value");
        continue;
      }
      kept.push(pair);
    }
    return { url: kept.length ? `${head}?${kept.join("&")}` : head, redacted };
  }

  const params = parsed.searchParams;
  const kept = new URLSearchParams();
  for (const [name, value] of params.entries()) {
    if (SENSITIVE_QUERY_SET.has(name.toLowerCase()) || classifyValue(value)) {
      redacted.push(name.toLowerCase());
      continue;
    }
    kept.append(name, value);
  }
  if (redacted.length === 0) return { url, redacted };
  parsed.search = kept.toString();
  return { url: parsed.toString(), redacted };
}

/** The value that replaces a blocked field. */
export const REDACTED = "[redacted]";

/** The maximum number of properties one event may carry. */
export const MAX_PROPS = 8;
/** The maximum length of a property value. */
export const MAX_PROP_LENGTH = 200;

/**
 * The category a sensitive property name belongs to.
 *
 * The console shows the categories as counters, so "e-posta" is more useful
 * than "12 adet alan engellendi".
 */
export function categoryForKey(key: string): PrivacyCategory {
  const name = key.trim().toLowerCase();
  if (name.includes("mail")) return "email";
  if (name.includes("phone") || name.includes("tel") || name.includes("mobile") || name.includes("msisdn")) {
    return "phone";
  }
  if (
    name.includes("card") ||
    name.includes("cvv") ||
    name.includes("cvc") ||
    name.includes("iban")
  ) {
    return "creditcard";
  }
  if (name.includes("ssn") || name.includes("nationalid") || name.includes("tckn")) {
    return "nationalid";
  }
  if (
    name.includes("token") ||
    name.includes("apikey") ||
    name.includes("secret") ||
    name.includes("auth") ||
    name.includes("session") ||
    name.includes("cookie")
  ) {
    return "token";
  }
  return "formvalue";
}

/**
 * Inspects a property bag. Returns the values that may be sent and the
 * categories that were blocked. The blocked values never leave this function.
 */
export function inspectProps(
  props: Record<string, unknown> | undefined,
): { props: Record<string, string | number | boolean>; blocked: PrivacyCategory[] } {
  const out: Record<string, string | number | boolean> = {};
  const blocked: PrivacyCategory[] = [];
  if (!props) return { props: out, blocked };

  for (const [key, raw] of Object.entries(props)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    const name = key.trim().slice(0, 40);
    if (!name) continue;
    if (isSensitiveKey(name)) {
      blocked.push(categoryForKey(name));
      continue;
    }
    if (typeof raw === "string") {
      const category = classifyValue(raw);
      if (category) {
        blocked.push(category);
        continue;
      }
      if (looksLikeUrl(raw)) {
        const { url, redacted } = redactUrl(raw);
        if (redacted.length) blocked.push("urlquery");
        out[name] = url.slice(0, MAX_PROP_LENGTH);
        continue;
      }
      out[name] = raw.slice(0, MAX_PROP_LENGTH);
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      out[name] = raw;
    } else if (typeof raw === "boolean") {
      out[name] = raw;
    }
  }
  return { props: out, blocked };
}

/**
 * The rules the gate applies — shared by the SDK, the Worker and the
 * console, so the documentation can never drift from the code.
 */
export const GATE_RULES = {
  sensitiveKeys: true,
  valuePatterns: ["email", "token", "creditcard", "phone", "nationalid"],
  queryParameters: true,
  pathSegments: true,
  errorMessages: true,
} as const;

/** True when a string looks like an absolute URL. */
export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}
