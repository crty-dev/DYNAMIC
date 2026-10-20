/**
 * Hostname normalisation and DNS-over-HTTPS TXT lookups.
 *
 * Workers have no node:dns, so the resolver talks to Cloudflare's public
 * DNS-over-HTTPS endpoint (1.1.1.1) — free, no API key, no paid service.
 */

const RESOLVER = "https://cloudflare-dns.com/dns-query";
const RESOLVER_FALLBACK = "https://dns.google/resolve";

export type HostnameResult =
  | { ok: true; hostname: string }
  | { ok: false; reason: string };

/** Labels may not start or end with a dash and only use a-z0-9-. */
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^[a-z]{2,63}$/;

const RESERVED = new Set([
  "localhost",
  "example.com",
  "example.org",
  "example.net",
  "invalid",
  "test",
]);

/**
 * Normalises a user supplied hostname:
 *  - accepts "example.com", "https://example.com/path" and "EXAMPLE.com.";
 *  - converts internationalised domains to punycode (IDNA);
 *  - rejects IPs, single labels, invalid TLDs and malformed labels.
 */
export function normalizeHostname(input: string): HostnameResult {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw) return { ok: false, reason: "Alan adı boş olamaz." };
  if (raw.length > 253) return { ok: false, reason: "Alan adı çok uzun (en fazla 253 karakter)." };

  let host = raw.replace(/\/+$/, "");
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return { ok: false, reason: "Alan adı çözümlenemedi." };
    }
  }
  host = host.split("/")[0].split("?")[0].split("#")[0].replace(/\.$/, "");

  if (!host) return { ok: false, reason: "Alan adı boş olamaz." };
  if (host.includes("..")) return { ok: false, reason: "Alan adı geçersiz." };

  // IPv4 / IPv6 are not verifiable with a TXT record.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return { ok: false, reason: "IP adresleri doğrulanamaz." };
  }
  if (host.startsWith("[") || host.includes(":")) {
    return { ok: false, reason: "IP adresleri doğrulanamaz." };
  }

  let ascii = host;
  // oxlint-disable-next-line eslint/no-control-regex
  if (/[^\x00-\x7F]/.test(host)) {
    try {
      ascii = new URL(`http://${host}`).hostname;
    } catch {
      return { ok: false, reason: "Alan adı geçersiz." };
    }
  }

  if (ascii.length > 253) return { ok: false, reason: "Alan adı çok uzun." };
  const labels = ascii.split(".");
  if (labels.length < 2) {
    return { ok: false, reason: "Alan adı en az bir nokta içermeli (ör. example.com)." };
  }
  for (const label of labels) {
    if (!label || label.length > 63 || !LABEL.test(label)) {
      return { ok: false, reason: "Alan adı geçersiz." };
    }
  }
  if (!TLD.test(labels[labels.length - 1])) {
    return { ok: false, reason: "Geçersiz alan adı uzantısı." };
  }
  if (RESERVED.has(ascii)) {
    return { ok: false, reason: "Bu alan adı kullanılamaz." };
  }

  return { ok: true, hostname: ascii };
}

/** The record a project owner has to publish. */
export function verificationRecord(hostname: string, token: string) {
  return {
    type: "TXT",
    name: `_dynamic-verification.${hostname}`,
    value: `dynamic-verification=${token}`,
  };
}

/** Joins the chunks of a TXT answer ("part1" "part2" -> "part1part2"). */
function joinTxtChunks(data: string): string {
  const trimmed = data.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  const parts = trimmed.match(/"([^"]*)"/g);
  if (!parts) return trimmed;
  return parts.map((part) => part.slice(1, -1)).join("");
}

export type TxtLookup = {
  found: boolean;
  records: string[];
  error?: string;
};

/**
 * Queries the TXT records of a name through DNS-over-HTTPS.
 * Never throws: DNS failures are returned as an error string.
 */
export async function lookupTxt(
  name: string,
  expected?: string,
  resolverUrl?: string,
): Promise<TxtLookup> {
  const primary = resolverUrl || RESOLVER;
  const url = `${primary}?name=${encodeURIComponent(name)}&type=TXT`;
  const fallback = `${RESOLVER_FALLBACK}?name=${encodeURIComponent(name)}&type=TXT`;

  let payload: { Status?: number; Answer?: { type?: number; data?: string }[]; Comment?: string } | null =
    null;

  for (const endpoint of resolverUrl ? [url] : [url, fallback]) {
    try {
      const response = await fetch(endpoint, {
        headers: { accept: "application/dns-json" },
        cf: { cacheTtl: 0 },
      });
      if (!response.ok) continue;
      const body = (await response.json()) as {
        Status?: number;
        Answer?: { type?: number; data?: string }[];
        Comment?: string;
      };
      payload = body;
      if (body.Status === 0) break;
    } catch {
      // try the next resolver
    }
  }

  if (!payload) {
    return { found: false, records: [], error: "dns_unreachable" };
  }
  if (payload.Status !== 0) {
    const reason =
      payload.Status === 3 ? "dns_not_found" : payload.Status === 2 ? "dns_server_error" : "dns_error";
    return { found: false, records: [], error: reason };
  }

  const records = (payload.Answer ?? [])
    .filter((answer) => answer.type === 16 && typeof answer.data === "string")
    .map((answer) => joinTxtChunks(answer.data as string));

  if (expected) {
    const wanted = expected.toLowerCase();
    const found = records.some((record) => record.toLowerCase() === wanted);
    return { found, records };
  }
  return { found: records.length > 0, records };
}
