/**
 * DYNAMIC Privacy Gate â€” the client side inspection layer.
 *
 * Every telemetry payload passes through `inspectEvent` before it is queued.
 * Sensitive values are dropped or redacted *in the browser*, so they never
 * reach the network. The server validates the same payload again; the gate
 * is a convenience, the server is the guarantee.
 *
 * The gate never logs a value. It only counts how many payloads were
 * blocked per category â€” the counters travel with the batch, the values do
 * not.
 */
import {
  classifyValue,
  inspectProps,
  isSensitiveKey,
  looksLikeUrl,
  redactUrl,
  type PrivacyCategory,
} from "../lib/privacy-rules";

export type PrivacyMode = "strict" | "balanced" | "off";

export type PrivacyConfig = {
  /** strict blocks every match, balanced keeps harmless values, off disables the gate. */
  mode: PrivacyMode;
  /** Strip sensitive query parameters from URLs. */
  redactQuery: boolean;
  /** Block values that look like an e-mail, a token or a card number. */
  blockValues: boolean;
  /** Collect JavaScript errors (redacted). */
  captureErrors: boolean;
};

export const DEFAULT_PRIVACY: PrivacyConfig = {
  mode: "balanced",
  redactQuery: true,
  blockValues: true,
  captureErrors: true,
};

/** Counters per category. Only the counts are ever transmitted. */
export type PrivacyCounters = Partial<Record<PrivacyCategory, number>>;

export type GateResult<T> = {
  event: T | null;
  blocked: PrivacyCategory[];
};

/** A payload the gate understands. Unknown shapes are returned untouched. */
type Inspectable = {
  type?: string;
  path?: string;
  name?: string;
  message?: string;
  props?: Record<string, unknown>;
  attribution?: Record<string, unknown>;
  ref?: string;
  release?: string;
  [key: string]: unknown;
};

const counters: PrivacyCounters = {};

/** The counters since the last read (the values themselves are never kept). */
export function readCounters(): PrivacyCounters {
  const copy: PrivacyCounters = { ...counters };
  for (const key of Object.keys(counters) as PrivacyCategory[]) delete counters[key];
  return copy;
}

function count(categories: PrivacyCategory[]): void {
  for (const category of categories) {
    counters[category] = (counters[category] ?? 0) + 1;
  }
}

/**
 * Redacts a path: the query string is removed and a suspicious path segment
 * is replaced. `/reset/eyJhbGciOi...` must not become a permanent record.
 */
export function sanitizePath(path: string | undefined): string | undefined {
  if (!path) return path;
  const cut = path.search(/[?#]/);
  const head = cut >= 0 ? path.slice(0, cut) : path;
  const segments = head.split("/");
  const cleaned = segments.map((segment) => {
    if (!segment) return segment;
    const category = classifyValue(decodeURIComponent(segment));
    return category ? "[redacted]" : segment;
  });
  return cleaned.join("/").slice(0, 512) || "/";
}

/**
 * Inspects one event. The returned event is safe to transmit; `blocked`
 * lists the categories that were removed.
 */
export function inspectEvent<T extends Inspectable>(
  event: T,
  config: PrivacyConfig = DEFAULT_PRIVACY,
): GateResult<T> {
  if (config.mode === "off") return { event, blocked: [] };

  const blocked: PrivacyCategory[] = [];
  const next: Record<string, unknown> = { ...event };

  if (config.redactQuery && typeof next.path === "string") {
    const path = sanitizePath(next.path);
    if (path !== next.path) {
      next.path = path;
      blocked.push("urlquery");
    }
  }

  if (typeof next.ref === "string") {
    const { url, redacted } = redactUrl(next.ref);
    if (redacted.length) {
      next.ref = url;
      blocked.push("urlquery");
    }
  }

  if (next.props && typeof next.props === "object") {
    const inspected = inspectProps(next.props as Record<string, unknown>);
    next.props = inspected.props;
    blocked.push(...inspected.blocked);
  }

  if (next.attribution && typeof next.attribution === "object") {
    const inspected = inspectProps(next.attribution as Record<string, unknown>);
    next.attribution = inspected.props;
    blocked.push(...inspected.blocked);
  }

  if (typeof next.message === "string" && config.blockValues) {
    const category = classifyValue(next.message);
    if (category) {
      // The message is replaced, not dropped: the error itself is still useful.
      next.message = "[redacted]";
      blocked.push(category);
    }
  }

  if (typeof next.name === "string" && config.blockValues) {
    const category = classifyValue(next.name);
    if (category) {
      blocked.push(category);
    }
  }

  // A payload that is entirely made of blocked parts must not be sent.
  const meaningful = Object.entries(next).filter(
    ([key, value]) => key !== "props" && key !== "attribution" && value !== undefined && value !== null,
  );
  const hasContent = meaningful.length > 0;
  const hasDetails =
    (next.props && Object.keys(next.props as Record<string, unknown>).length > 0) ||
    (next.attribution && Object.keys(next.attribution as Record<string, unknown>).length > 0);

  count(blocked);

  if (!hasContent && !hasDetails) {
    return { event: null, blocked };
  }
  return { event: next as T, blocked };
}

/** The values the gate blocks — used by the documentation and the console. */
export { GATE_RULES } from "../lib/privacy-rules";

/**
 * A synthetic self test: fabricated values run through the gate, so the
 * owner can see what would be blocked. Nothing is sent anywhere.
 */
export function selfTest(config: PrivacyConfig = DEFAULT_PRIVACY): {
  total: number;
  blocked: number;
  allowed: number;
  byCategory: PrivacyCounters;
  samples: { label: string; blocked: boolean; categories: PrivacyCategory[] }[];
} {
  const samples: { label: string; blocked: boolean; categories: PrivacyCategory[] }[] = [];
  const byCategory: PrivacyCounters = {};

  const cases: { label: string; event: Record<string, unknown> }[] = [
    { label: "e-posta deÄŸeri", event: { type: "event", name: "signup", props: { mail: "jane@example.com" } } },
    { label: "bearer token", event: { type: "event", name: "auth", props: { auth: "Bearer abcdefghijklmnop" } } },
    { label: "uzun hex", event: { type: "event", name: "id", props: { ref: "9f8e7d6c5b4a39281706f5e4d3c2b1a0" } } },
    { label: "kredi kartÄ±", event: { type: "event", name: "pay", props: { card: "4242 4242 4242 4242" } } },
    { label: "sorgu parametresi", event: { type: "event", name: "nav", props: { to: "https://site.com/x?token=secretvalue" } } },
    { label: "parola alanÄ±", event: { type: "event", name: "form", props: { password: "hunter2" } } },
    { label: "gÃ¼venli sayaÃ§", event: { type: "event", name: "checkout", props: { items: 3, currency: "TRY" } } },
  ];

  for (const item of cases) {
    const result = inspectEvent(item.event, config);
    for (const category of result.blocked) {
      byCategory[category] = (byCategory[category] ?? 0) + 1;
    }
    samples.push({
      label: item.label,
      // Blocked means: a part of the payload was removed (or the whole
      // payload was dropped).
      blocked: result.blocked.length > 0,
      categories: result.blocked,
    });
  }

  const blocked = samples.filter((sample) => sample.blocked).length;
  return {
    total: samples.length,
    blocked,
    allowed: samples.length - blocked,
    byCategory,
    samples,
  };
}

export { classifyValue, isSensitiveKey, looksLikeUrl, redactUrl };
export type { PrivacyCategory };
