#!/usr/bin/env node
/**
 * Cloudinary link-up — one command, one prompt.
 *
 *   npm run cloudinary:link
 *
 * 1. asks for the Cloudinary API secret (hidden input)
 * 2. verifies it against the Cloudinary API
 * 3. writes .dev.vars (CLOUDINARY_URL + MEDIA_UPLOAD_TOKEN)
 * 4. pushes both values into the Worker secret store (wrangler secret put)
 * 5. creates the unsigned upload preset (dynamic_uploads)
 * 6. checks that the five brand assets exist in the media library and uploads
 *    the missing ones from images/png-to-webp
 *
 * Non-interactive alternative (CI / scripted):
 *   npm run cloudinary:link -- --secret <API_SECRET>
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const DEV_VARS = path.join(ROOT, ".dev.vars");

const CLOUD_NAME = "di9c12gg6";
const API_KEY = "657115753521274";
const UPLOAD_PRESET = "dynamic_uploads";
const UPLOAD_FOLDER = "dynamic/uploads";
const BRAND_FOLDER = "dynamic/brand";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Brand assets that must exist in the media library. */
const BRAND_ASSETS = [
  { publicId: "logo-removebg-preview_dnbcty", file: "logo-removebg-preview.webp" },
  { publicId: "DYNAMIC_Analytics-removebg-preview_jiuqiw", file: "DYNAMIC_Analytics-removebg-preview.webp" },
  { publicId: "DYNAMIC_RUM-removebg-preview_xmrfrg", file: "DYNAMIC_RUM-removebg-preview.webp" },
  { publicId: "DYNAMIC_SDK-removebg-preview_mriaab", file: "DYNAMIC_SDK-removebg-preview.webp" },
  { publicId: "DYNAMIC_Console-removebg-preview_machdd", file: "DYNAMIC_Console-removebg-preview.webp" },
];

const log = (message) => console.log(message);
const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

/* ------------------------------------------------------------------ input */

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index > -1 ? process.argv[index + 1] : undefined;
}

/** Hidden single-line prompt (works on Windows terminals). */
function askSecret(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    if (stdin.isTTY && typeof stdin.setRawMode === "function") stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
          process.exit(1);
        }
        if (char === "\r" || char === "\n") {
          stdin.removeListener("data", onData);
          if (stdin.isTTY && typeof stdin.setRawMode === "function") stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

/* ------------------------------------------------------------------ files */

function readDevVars() {
  if (!fs.existsSync(DEV_VARS)) return "";
  return fs.readFileSync(DEV_VARS, "utf8");
}

function setVar(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) return content.replace(pattern, line);
  return `${content.trimEnd()}\n${line}\n`.replace(/^\n+/, "");
}

/* ------------------------------------------------------------------- api */

function api(pathname, apiSecret, init = {}) {
  const auth = `Basic ${Buffer.from(`${API_KEY}:${apiSecret}`).toString("base64")}`;
  return fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}${pathname}`, {
    ...init,
    headers: { authorization: auth, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function sign(params, apiSecret) {
  const base = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return crypto.createHash("sha1").update(base + apiSecret).digest("hex");
}

/* ------------------------------------------------------------------ flow */

async function main() {
  log("DYNAMIC · Cloudinary bağlantısı\n");

  let apiSecret = argValue("--secret");
  if (!apiSecret) {
    apiSecret = (await askSecret("Cloudinary API secret (görünmez): ")).trim();
  }
  if (!apiSecret) fail("API secret girilmedi.");
  if (/[<>]/.test(apiSecret)) fail("Placeholder değer girildi (<API_SECRET> gibi).");

  // 1 — verify the credential
  const usage = await api("/usage", apiSecret);
  if (!usage.ok) {
    const body = await usage.text();
    fail(`Cloudinary kimlik doğrulaması başarısız (${usage.status}). ${body.slice(0, 200)}`);
  }
  const plan = await usage.json();
  log(`✓ Kimlik doğrulandı — cloud: ${CLOUD_NAME}, plan: ${plan.plan ?? "unknown"}`);

  // 2 — media upload token (reuse the one already in .dev.vars, if any)
  const existingToken = /^\s*MEDIA_UPLOAD_TOKEN=(.+)$/m.exec(readDevVars())?.[1]?.trim();
  const token =
    existingToken && !/[<>]/.test(existingToken)
      ? existingToken
      : crypto.randomBytes(24).toString("hex");
  let devVars = readDevVars();
  if (!devVars.includes("CLOUDINARY_URL=")) {
    devVars = `CLOUDINARY_URL=cloudinary://${API_KEY}:${apiSecret}@${CLOUD_NAME}\n${devVars}`;
  } else {
    devVars = setVar(devVars, "CLOUDINARY_URL", `cloudinary://${API_KEY}:${apiSecret}@${CLOUD_NAME}`);
  }
  devVars = setVar(devVars, "MEDIA_UPLOAD_TOKEN", token);
  fs.writeFileSync(DEV_VARS, devVars.endsWith("\n") ? devVars : `${devVars}\n`);
  log(`✓ .dev.vars yazıldı (CLOUDINARY_URL + MEDIA_UPLOAD_TOKEN)`);

  // 3 — worker secrets
  for (const [key, value] of [
    ["CLOUDINARY_URL", `cloudinary://${API_KEY}:${apiSecret}@${CLOUD_NAME}`],
    ["MEDIA_UPLOAD_TOKEN", token],
  ]) {
    const result = spawnSync("npx", ["wrangler", "secret", "put", key], {
      input: `${value}\n`,
      encoding: "utf8",
      shell: true,
    });
    if (result.status !== 0) {
      fail(`wrangler secret put ${key} başarısız: ${(result.stderr || result.stdout || "").slice(0, 300)}`);
    }
    log(`✓ Worker secret: ${key}`);
  }

  // 4 — unsigned upload preset
  const presetBody = {
    name: UPLOAD_PRESET,
    unsigned: true,
    folder: UPLOAD_FOLDER,
    allowed_formats: "jpg,jpeg,png,webp,avif,svg",
    max_file_size: MAX_FILE_SIZE,
    tags: ["dynamic", "media"],
    context: { alt: "dynamic", caption: "dynamic" },
  };
  const created = await api("/upload_presets", apiSecret, {
    method: "POST",
    body: JSON.stringify(presetBody),
  });
  if (created.ok) {
    log(`✓ Upload preset oluşturuldu: ${UPLOAD_PRESET}`);
  } else {
    const body = await created.json().catch(() => ({}));
    const exists = body?.error?.message?.toLowerCase().includes("already exists");
    const updated = exists
      ? await api(`/upload_presets/${UPLOAD_PRESET}`, apiSecret, {
          method: "PUT",
          body: JSON.stringify(presetBody),
        })
      : null;
    if (updated?.ok) log(`✓ Upload preset güncellendi: ${UPLOAD_PRESET}`);
    else fail(`Upload preset işlemi başarısız: ${JSON.stringify(body).slice(0, 200)}`);
  }

  // 5 — brand assets
  for (const asset of BRAND_ASSETS) {
    const check = await api(`/resources/image/${asset.publicId}`, apiSecret);
    if (check.ok) {
      log(`✓ ${asset.publicId} — medya kütüphanesinde`);
      continue;
    }
    const file = path.join(ROOT, "images", "png-to-webp", asset.file);
    if (!fs.existsSync(file)) {
      log(`• ${asset.publicId} — bulunamadı ve ${asset.file} yok, atlandı`);
      continue;
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const params = { folder: BRAND_FOLDER, timestamp, public_id: asset.publicId };
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(file)]), asset.file);
    form.append("api_key", API_KEY);
    form.append("timestamp", String(timestamp));
    form.append("folder", BRAND_FOLDER);
    form.append("public_id", asset.publicId);
    form.append("signature", sign(params, apiSecret));
    const upload = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: form,
    });
    if (upload.ok) log(`✓ ${asset.publicId} — yüklendi`);
    else log(`• ${asset.publicId} — yüklenemedi (${upload.status})`);
  }

  log("\nCloudinary hazır. Kontrol:");
  log(`  • Worker:  https://dynamic.crty-dev.com/api/media/config  → enabled: true`);
  log(`  • Yerel:   npx wrangler dev  → /api/media/config`);
  log(`  • Token:  .dev.vars içindeki MEDIA_UPLOAD_TOKEN (gizli, paylaşmayın)`);
}

await main();
