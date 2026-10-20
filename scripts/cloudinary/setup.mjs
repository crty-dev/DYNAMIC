#!/usr/bin/env node
/**
 * Cloudinary setup for DYNAMIC.
 *
 * Reads CLOUDINARY_URL (process env or .dev.vars), verifies the account,
 * creates the unsigned upload preset used by the media library and (with
 * --upload) pushes the brand images to the `dynamic/brand` folder.
 *
 *   node scripts/cloudinary/setup.mjs            # verify + preset
 *   node scripts/cloudinary/setup.mjs --upload   # also upload brand images
 *   node scripts/cloudinary/setup.mjs --upload --all  # every file in images/
 *
 * The API secret never leaves this machine: it is read from the env and used
 * only to sign requests.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const IMAGES = path.join(ROOT, "images");

const UPLOAD_PRESET = "dynamic_uploads";
const UPLOAD_FOLDER = "dynamic/uploads";
const BRAND_FOLDER = "dynamic/brand";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const argv = new Set(process.argv.slice(2));
const wantUpload = argv.has("--upload");
const wantAll = argv.has("--all");

/** .dev.vars lines: KEY=value */
function readDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...readDotEnv(path.join(ROOT, ".dev.vars")), ...process.env };
const cloudinaryUrl = env.CLOUDINARY_URL;

if (!cloudinaryUrl) {
  console.error("CLOUDINARY_URL bulunamadı.");
  console.error("  .dev.vars içine şu satırı ekleyin:");
  console.error("  CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@di9c12gg6");
  process.exit(1);
}

const parsed = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(cloudinaryUrl.trim());
if (!parsed) {
  console.error("CLOUDINARY_URL biçimi geçersiz. Beklenen: cloudinary://key:secret@cloud");
  process.exit(1);
}

const apiKey = decodeURIComponent(parsed[1]);
const apiSecret = decodeURIComponent(parsed[2]);
const cloudName = parsed[3];

if (/[<>]/.test(apiKey) || /[<>]/.test(apiSecret)) {
  console.error("CLOUDINARY_URL içinde placeholder var (<API_SECRET> gibi).");
  console.error("Cloudinary console → API Keys → DYNAMIC → API Secret değerini yapıştırın.");
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;

function sign(params) {
  const base = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return crypto.createHash("sha1").update(base + apiSecret).digest("hex");
}

async function api(pathname, init = {}) {
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}${pathname}`, {
    ...init,
    headers: { authorization: auth, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { ok: response.ok, status: response.status, body };
}

/* 1 — verify the account ------------------------------------------------- */
const usage = await api("/usage");
if (!usage.ok) {
  console.error(`Cloudinary kimlik doğrulaması başarısız (${usage.status}).`, usage.body);
  process.exit(1);
}
console.log(`cloud: ${cloudName}`);
console.log(`plan:  ${usage.body.plan ?? "unknown"}`);
console.log(
  `kullanım: ${usage.body.usage?.last_updated ? new Date(usage.body.usage.last_updated).toISOString() : "n/a"}`,
);

/* 2 — unsigned upload preset --------------------------------------------- */
const presetBody = {
  name: UPLOAD_PRESET,
  unsigned: true,
  folder: UPLOAD_FOLDER,
  allowed_formats: "jpg,jpeg,png,webp,avif,svg",
  max_file_size: MAX_FILE_SIZE,
  tags: ["dynamic", "media"],
  context: { alt: "dynamic", caption: "dynamic" },
};

const created = await api("/upload_presets", {
  method: "POST",
  body: JSON.stringify(presetBody),
});
let presetState = "created";
if (created.status === 409 || created.body?.error?.message?.includes("already exists")) {
  const updated = await api(`/upload_presets/${UPLOAD_PRESET}`, {
    method: "PUT",
    body: JSON.stringify(presetBody),
  });
  presetState = updated.ok ? "updated" : `update failed (${updated.status})`;
} else if (!created.ok) {
  presetState = `failed (${created.status}) ${JSON.stringify(created.body)}`;
}
console.log(`upload preset "${UPLOAD_PRESET}": ${presetState}`);

/* 3 — optional brand upload ---------------------------------------------- */
if (wantUpload) {
  const targets = wantAll
    ? fs
        .readdirSync(IMAGES)
        .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
        .map((f) => path.join(IMAGES, f))
    : [
        path.join(IMAGES, "logo-removebg-preview.png"),
        path.join(IMAGES, "DYNAMIC_Analytics-removebg-preview.png"),
        path.join(IMAGES, "DYNAMIC_RUM-removebg-preview.png"),
        path.join(IMAGES, "DYNAMIC_SDK-removebg-preview.png"),
        path.join(IMAGES, "DYNAMIC_Console-removebg-preview.png"),
      ].filter((f) => fs.existsSync(f));

  const results = [];
  for (const file of targets) {
    const base = path.basename(file).replace(/\.[^.]+$/, "");
    const publicId = base.replace(/-removebg-preview$/i, "").toLowerCase();
    const timestamp = Math.floor(Date.now() / 1000);
    const params = { folder: BRAND_FOLDER, timestamp, public_id: publicId };
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(file)]), path.basename(file));
    form.append("api_key", apiKey);
    form.append("timestamp", String(timestamp));
    form.append("folder", BRAND_FOLDER);
    form.append("public_id", publicId);
    form.append("signature", sign(params));

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: "POST",
      body: form,
    });
    const payload = await response.json();
    if (!response.ok) {
      console.error(`  ✗ ${path.basename(file)}: ${JSON.stringify(payload.error ?? payload)}`);
      continue;
    }
    const delivery = `https://res.cloudinary.com/${cloudName}/image/upload/f_auto,q_auto/${payload.public_id}`;
    results.push({ file: path.basename(file), publicId: payload.public_id, delivery });
    console.log(`  ✓ ${path.basename(file)} → ${delivery}`);
  }

  const outFile = path.join(ROOT, "assets", "brand", "cloudinary.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify({ cloudName, assets: results }, null, 2)}\n`);
  console.log(`\nliste yazıldı: ${path.relative(ROOT, outFile)}`);
}

console.log("\nCloudinary hazır.");
