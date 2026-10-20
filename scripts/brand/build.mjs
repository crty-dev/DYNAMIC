#!/usr/bin/env node
/**
 * DYNAMIC brand pipeline — single source of truth.
 *
 * Generates every brand asset (SVG masters + raster derivatives) from one
 * geometric definition of the DYNAMIC "D" mark, using Montserrat & JetBrains
 * Mono (both SIL OFL — see assets/brand/fonts/) converted to outlines so all
 * files are font-independent.
 *
 * Run:  npm run brand
 *
 * Outputs:
 *   assets/brand/svg/**                    — vector masters (logo family)
 *   assets/brand/raster/**                 — favicons, app icons, banners
 *   public/favicon.ico, public/brand/**    — files actually used by the site
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import { Resvg } from "@resvg/resvg-js";
import pngToIco from "png-to-ico";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const BRAND = path.join(ROOT, "assets", "brand");
const DIR = {
  svg: path.join(BRAND, "svg"),
  products: path.join(BRAND, "svg", "products"),
  banners: path.join(BRAND, "svg", "banners"),
  favicons: path.join(BRAND, "raster", "favicons"),
  app: path.join(BRAND, "raster", "app"),
  bannersRaster: path.join(BRAND, "raster", "banners"),
  pub: path.join(ROOT, "public"),
  pubBrand: path.join(ROOT, "public", "brand"),
};
for (const d of Object.values(DIR)) fs.mkdirSync(d, { recursive: true });

/* ------------------------------------------------------------------ *
 * Palette — 2026 site refresh. The blue/cyan/teal/ink values are the
 * brand owner's authoritative set; the remaining tokens are derived
 * support shades used only inside generated assets.
 * ------------------------------------------------------------------ */
const C = {
  blue: "#1d70fd",
  blue2: "#1e87f1",
  teal: "#23d8ca",
  cyan: "#20a9de",
  deep: "#0f515d",
  sky: "#22bad6",
  ink: "#0b1d2f",
  navy: "#0b1d2f",
  azure: "#1f97e8",
  /** near-white text used on dark surfaces */
  inkText: "#eaf4ff",
};

/* ------------------------------------------------------------------ *
 * The D mark — one geometry, shared by the whole family.
 * Design grid: 1000 × 1200.
 *   - rectangular stem (x 0..250) + semicircular bowl (r 600, cx 420)
 *   - counter (half-disc hole, r 360, flat edge on the stem)
 *   - main mark adds a diagonal "current" slash through the stem
 *     and a matching notch on the left edge
 * ------------------------------------------------------------------ */
const OUTER = "M 0,0 H 420 A 600,600 0 0 1 420,1200 H 0 Z";
const HOLE = "M 250,240 A 360,360 0 0 1 250,960 Z";
const SLASH = "M 245,390 L 297,432 L 25,745 L -25,703 Z";
const NOTCH = "M 0,752 L 120,905 L 0,1018 Z";
const MAIN_D = [OUTER, HOLE, SLASH, NOTCH].join(" ");
const PLAIN_D = [OUTER, HOLE].join(" ");

/* Product glyphs — same grid, same gradient, same stroke discipline. */
const RUM_WAVE = "M -90,600 H 300 L 356,468 L 428,706 L 474,568 L 514,600 H 1010";

/** Brand gradient: teal (top-right) → cyan → blue (bottom-left). */
const DEFS = `
  <defs>
    <linearGradient id="dg" x1="1000" y1="40" x2="60" y2="1170" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.teal}"/>
      <stop offset="0.5" stop-color="${C.cyan}"/>
      <stop offset="1" stop-color="${C.blue}"/>
    </linearGradient>
    <radialGradient id="tileGlow" cx="0.85" cy="0.08" r="1">
      <stop offset="0" stop-color="${C.blue}" stop-opacity="0.30"/>
      <stop offset="0.5" stop-color="${C.teal}" stop-opacity="0.06"/>
      <stop offset="1" stop-color="${C.teal}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="holeClip"><path d="${HOLE}"/></clipPath>
    <mask id="rumCut" maskUnits="userSpaceOnUse" x="-200" y="-200" width="1400" height="1600">
      <rect x="-200" y="-200" width="1400" height="1600" fill="#fff"/>
      <path d="${RUM_WAVE}" fill="none" stroke="#000" stroke-width="92" stroke-linecap="round" stroke-linejoin="round"/>
    </mask>
  </defs>`;

const GLYPHS = {
  /* ascending bars + trend arrow, clipped to the counter */
  analytics: `<g clip-path="url(#holeClip)">
      <rect x="286" y="766" width="40" height="150" rx="8" fill="url(#dg)"/>
      <rect x="354" y="626" width="40" height="290" rx="8" fill="url(#dg)"/>
      <rect x="422" y="701" width="40" height="215" rx="8" fill="url(#dg)"/>
      <rect x="490" y="516" width="40" height="400" rx="8" fill="url(#dg)"/>
      <path d="M 286,726 L 360,610 L 420,650 L 539,518" fill="none" stroke="url(#dg)" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M 575,470 L 565,537 L 513,499 Z" fill="url(#dg)"/>
    </g>`,
  /* pulse line: cuts a channel through the mark, gradient pulse inside */
  rum: `<path d="${RUM_WAVE}" fill="none" stroke="url(#dg)" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>`,
  /* code brackets </> in the counter */
  sdk: `<path d="M 322,506 L 246,600 L 322,694" fill="none" stroke="url(#dg)" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M 478,506 L 554,600 L 478,694" fill="none" stroke="url(#dg)" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M 452,450 L 360,750" fill="none" stroke="url(#dg)" stroke-width="56" stroke-linecap="round"/>`,
};

/**
 * Inner content of the mark (in 1000×1200 user space).
 * @param {object} o
 * @param {string} o.fill        fill for the D body
 * @param {boolean} o.slash      main "current" slash (main brand only)
 * @param {null|"analytics"|"rum"|"sdk"} o.product
 */
function symbolInner({ fill = "url(#dg)", slash = false, product = null } = {}) {
  const d = slash ? MAIN_D : PLAIN_D;
  if (product === "rum") {
    // the pulse cuts through the mark itself
    return `<g mask="url(#rumCut)"><path fill="${fill}" fill-rule="evenodd" d="${d}"/></g>\n  ${GLYPHS.rum}`;
  }
  return `<path fill="${fill}" fill-rule="evenodd" d="${d}"/>${product ? `\n  ${GLYPHS[product]}` : ""}`;
}

function symbolSvg({ product = null, slash = false, fill = "url(#dg)" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1200">${DEFS}
  ${symbolInner({ fill, slash, product })}
</svg>`;
}

/* ------------------------------------------------------------------ *
 * Type — Montserrat & JetBrains Mono converted to real outlines with
 * fontkit (font-independent output). Text is emitted as a group of
 * glyph paths; the caller supplies the fill.
 * ------------------------------------------------------------------ */
const FONT_FILES = {
  500: "Montserrat-Medium.ttf",
  600: "Montserrat-SemiBold.ttf",
  700: "Montserrat-Bold.ttf",
  800: "Montserrat-ExtraBold.ttf",
  mono400: "JetBrainsMono-Regular.ttf",
  mono500: "JetBrainsMono-Medium.ttf",
};
const fonts = {};
for (const [k, f] of Object.entries(FONT_FILES)) {
  fonts[k] = fontkit.openSync(path.join(BRAND, "fonts", f));
}
const capCache = {};
function capUnits(key) {
  if (!capCache[key]) {
    const os2 = fonts[key]["OS/2"];
    capCache[key] = os2 && os2.sCapHeight ? os2.sCapHeight : 700;
  }
  return capCache[key];
}
const round = (n) => Math.round(n * 1000) / 1000;

/** Outline `text` at cap height `capTarget` px (baseline at y=0, y-up flipped). */
function textD(text, key, capTarget, tracking = 0) {
  const f = fonts[key];
  const run = f.layout(text);
  const upm = f.unitsPerEm;
  const s = capTarget / capUnits(key);
  const parts = [];
  let pen = 0;
  run.glyphs.forEach((glyph, i) => {
    const pos = run.positions[i];
    const d = glyph.path.toSVG();
    parts.push(
      `<path d="${d}" transform="translate(${round(pen + pos.xOffset * s)},0) scale(${round(s)},${round(-s)})"/>`,
    );
    pen += pos.xAdvance * s + tracking;
  });
  if (parts.length) pen -= tracking; // no trailing tracking
  return { d: parts.join(""), w: pen };
}

/**
 * Place a text path group. `y` = baseline. Returns the element + width.
 * Anchor places the box horizontally around `x`.
 */
function T(text, key, capTarget, x, y, fill, { anchor = "start", tracking = 0 } = {}) {
  const m = textD(text, key, capTarget, tracking);
  const tx = anchor === "middle" ? x - m.w / 2 : anchor === "end" ? x - m.w : x;
  return {
    el: `<g fill="${fill}" transform="translate(${round(tx)},${round(y)})">${m.d}</g>`,
    w: m.w,
  };
}

/* ------------------------------------------------------------------ *
 * Logo lockups — symbol + wordmark (+ optional product name)
 * ------------------------------------------------------------------ */
function lockup({ product = null, productName = null, onDark = true, slash = !product } = {}) {
  const H = product ? 72 : 120;
  const symH = product ? 60 : 80;
  const capsH = product ? 30 : 44;
  const track = product ? 0 : 2;
  const ink = onDark ? C.inkText : C.ink;
  const sub = onDark ? "rgba(234,244,255,0.66)" : "rgba(11,29,47,0.62)";
  const scale = symH / 1200;
  const symW = 1000 * scale;
  const baseline = H / 2 + capsH / 2;
  const parts = [];
  parts.push(
    `<g transform="translate(0,${round((H - symH) / 2)}) scale(${round(scale)})">${symbolInner({ slash, product })}</g>`,
  );
  const wm = textD("DYNAMIC", 700, capsH, track);
  const wmX = symW + symH * 0.34;
  parts.push(`<g fill="${ink}" transform="translate(${round(wmX)},${round(baseline)})">${wm.d}</g>`);
  let w = wmX + wm.w;
  if (product) {
    const lineX = w + symH * 0.28;
    parts.push(
      `<line x1="${round(lineX)}" y1="${round((H - capsH) / 2)}" x2="${round(lineX)}" y2="${round((H + capsH) / 2)}" stroke="${onDark ? "rgba(234,244,255,0.25)" : "rgba(11,29,47,0.22)"}" stroke-width="2"/>`,
    );
    const pn = textD(productName || product, 500, capsH, 0.6);
    const pnX = lineX + symH * 0.28;
    parts.push(`<g fill="${sub}" transform="translate(${round(pnX)},${round(baseline)})">${pn.d}</g>`);
    w = pnX + pn.w + 2;
  }
  return { content: parts.join("\n  "), w: Math.ceil(w + 4), h: H };
}

function lockupSvg(opts) {
  const L = lockup(opts);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.w} ${L.h}" width="${L.w}" height="${L.h}">${DEFS}
  ${L.content}
</svg>`;
}

/* ------------------------------------------------------------------ *
 * Favicon / app-icon tile
 * ------------------------------------------------------------------ */
function tileSvg({ rx = 112, dScale = 0.3167 } = {}) {
  const w = 1000 * dScale;
  const h = 1200 * dScale;
  const x = (512 - w) / 2;
  const y = (512 - h) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${DEFS}
  <rect width="512" height="512" rx="${rx}" fill="#081827"/>
  <rect width="512" height="512" rx="${rx}" fill="url(#tileGlow)"/>
  <g transform="translate(${round(x)},${round(y)}) scale(${dScale})"><path fill="url(#dg)" fill-rule="evenodd" d="${PLAIN_D}"/></g>
  ${rx ? `<rect x="2" y="2" width="508" height="508" rx="${rx - 2}" fill="none" stroke="#20a9de" stroke-opacity="0.12" stroke-width="3"/>` : ""}
</svg>`;
}

/* ------------------------------------------------------------------ *
 * Banners
 * ------------------------------------------------------------------ */
function bannerBase(w, h) {
  const grid = [];
  for (let x = 120; x < w; x += 120) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#9ecbff" stroke-opacity="0.045"/>`);
  for (let y = 120; y < h; y += 120) grid.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#9ecbff" stroke-opacity="0.045"/>`);
  return `
  <rect width="${w}" height="${h}" fill="url(#bgbg)"/>
  <rect width="${w}" height="${h}" fill="url(#glowT)"/>
  <rect width="${w}" height="${h}" fill="url(#glowB)"/>
  <g>${grid.join("")}</g>`;
}
const BANNER_DEFS = `
  <defs>
    <linearGradient id="bgbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#081827"/>
      <stop offset="1" stop-color="${C.ink}"/>
    </linearGradient>
    <radialGradient id="glowT" cx="0.85" cy="0.02" r="0.8">
      <stop offset="0" stop-color="${C.teal}" stop-opacity="0.26"/>
      <stop offset="1" stop-color="${C.teal}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0.06" cy="1" r="0.85">
      <stop offset="0" stop-color="${C.blue}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${C.blue}" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

function domainPill(cx, y, { w = 400, h = 56, text = "dynamic.crty-dev.com" } = {}) {
  const t = T(text, 600, 20, cx, y + h / 2 + 7, C.sky, { anchor: "middle" });
  return `<rect x="${round(cx - w / 2)}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="rgba(35,216,202,0.07)" stroke="rgba(35,216,202,0.38)" stroke-width="1.5"/>${t.el}`;
}

function watermarkD(w, h, { size = 720, x = null, opacity = 0.07, slash = true } = {}) {
  const s = size / 1200;
  const xx = x ?? w - 1000 * s + 60;
  return `<g transform="translate(${round(xx)},${round((h - 1200 * s) / 2)}) scale(${round(s)})" opacity="${opacity}"><path fill="url(#dg)" fill-rule="evenodd" d="${slash ? MAIN_D : PLAIN_D}"/></g>`;
}

/** 1200×630 open-graph banner, centered composition */
function ogSvg({ product = null, titleLines = [], sub = null } = {}) {
  const w = 1200;
  const h = 630;
  const L = lockup({ product, productName: product ? DISPLAY[product] : null, onDark: true, slash: !product });
  const parts = [bannerBase(w, h), watermarkD(w, h)];
  parts.push(`<g transform="translate(${round((w - L.w) / 2)},132)">${L.content}</g>`);
  let y = 132 + L.h + 100;
  for (const line of titleLines) {
    parts.push(T(line, 700, 46, w / 2, y, C.inkText, { anchor: "middle" }).el);
    y += 64;
  }
  if (sub) {
    y += 18;
    // Long subtitles step down a size so every banner keeps ≥80px side margins.
    const subSize = sub.length > 60 ? 22 : 26;
    parts.push(T(sub, 500, subSize, w / 2, y, "rgba(234,244,255,0.66)", { anchor: "middle" }).el);
  }
  parts.push(domainPill(w / 2, h - 56 - 62));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${BANNER_DEFS}${DEFS}
  ${parts.join("\n  ")}
</svg>`;
}

/** 1500×500 social cover */
function coverSvg() {
  const w = 1500;
  const h = 500;
  const L = lockup({ onDark: true, slash: true, symH: 88, capsH: 40 });
  const parts = [
    bannerBase(w, h),
    watermarkD(w, h, { size: 620, x: -140, opacity: 0.06 }),
    watermarkD(w, h, { size: 620, x: w - 620 * 1000 / 1200 + 140, opacity: 0.06 }),
    `<g transform="translate(${round((w - L.w) / 2)},118)">${L.content}</g>`,
    T("Privacy-first analytics & RUM for the open web", 500, 27, w / 2, 118 + L.h + 84, "rgba(234,244,255,0.68)", { anchor: "middle" }).el,
    domainPill(w / 2, h - 48 - 52, { w: 360, h: 48 }),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${BANNER_DEFS}${DEFS}
  ${parts.join("\n  ")}
</svg>`;
}

/** 1600×900 announcement banner */
function announceSvg() {
  const w = 1600;
  const h = 900;
  const L = lockup({ onDark: true, slash: true, symH: 150, capsH: 66 });
  const badge = T("NOW OPEN SOURCE  ·  MIT LICENSE", 600, 22, w / 2, 470, C.teal, { anchor: "middle" });
  const parts = [
    bannerBase(w, h),
    watermarkD(w, h, { size: 700, x: 80, opacity: 0.06 }),
    watermarkD(w, h, { size: 700, x: w - 700 * 1000 / 1200 - 80, opacity: 0.06 }),
    `<g transform="translate(${round((w - L.w) / 2)},210)">${L.content}</g>`,
    `<rect x="${round(w / 2 - badge.w / 2 - 36)}" y="430" width="${round(badge.w + 72)}" height="64" rx="32" fill="rgba(35,216,202,0.08)" stroke="rgba(35,216,202,0.4)" stroke-width="1.5"/>`,
    badge.el,
    T("Privacy-first analytics & RUM — free forever, on Cloudflare's free tier.", 500, 30, w / 2, 582, "rgba(234,244,255,0.7)", { anchor: "middle" }).el,
    domainPill(w / 2, 640, { w: 420, h: 56 }),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${BANNER_DEFS}${DEFS}
  ${parts.join("\n  ")}
</svg>`;
}

/* ------------------------------------------------------------------ *
 * Emit + raster helpers
 * ------------------------------------------------------------------ */
function emit(file, svg) {
  fs.writeFileSync(file, svg.trimStart().replace(/^\n/, ""));
  console.log("svg  ", path.relative(ROOT, file));
}
function raster(svgString, width, out) {
  const r = new Resvg(svgString, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false },
  });
  fs.writeFileSync(out, r.render().asPng());
  console.log("png  ", path.relative(ROOT, out));
}
const copy = (from, to) => {
  fs.copyFileSync(from, to);
  console.log("copy ", path.relative(ROOT, to));
};

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */
// -- main mark -------------------------------------------------------
emit(path.join(DIR.svg, "dynamic-symbol.svg"), symbolSvg({ slash: true }));
emit(path.join(DIR.svg, "dynamic-symbol-on-dark.svg"), symbolSvg({ slash: true, fill: C.inkText }));
emit(path.join(DIR.svg, "dynamic-symbol-on-light.svg"), symbolSvg({ slash: true, fill: C.ink }));
emit(path.join(DIR.svg, "dynamic-logo-horizontal-on-dark.svg"), lockupSvg({ onDark: true, slash: true }));
emit(path.join(DIR.svg, "dynamic-logo-horizontal-on-light.svg"), lockupSvg({ onDark: false, slash: true }));

// -- product marks ---------------------------------------------------
const DISPLAY = { analytics: "Analytics", rum: "RUM", sdk: "SDK", console: "Console" };
const PRODUCTS = ["analytics", "rum", "sdk", "console"];
for (const p of PRODUCTS) {
  const iconSvg = p === "console" ? symbolSvg({}) : symbolSvg({ product: p });
  emit(path.join(DIR.products, `${p}-icon.svg`), iconSvg);
  emit(path.join(DIR.products, `${p}-logo-horizontal-on-dark.svg`), lockupSvg({ product: p, productName: DISPLAY[p] }));
}

// -- favicon / app tiles ---------------------------------------------
const tile = tileSvg();
const tileBleed = tileSvg({ rx: 0 });
const tileFile = path.join(DIR.favicons, "tile.svg");
const tileBleedFile = path.join(DIR.favicons, "tile-bleed.svg");
emit(tileFile, tile);
emit(tileBleedFile, tileBleed);

const favFiles = {};
for (const size of [16, 32, 48]) {
  const out = path.join(DIR.favicons, `favicon-${size}x${size}.png`);
  raster(tile, size, out);
  favFiles[size] = out;
}
raster(tile, 192, path.join(DIR.app, "icon-192.png"));
raster(tile, 512, path.join(DIR.app, "icon-512.png"));
raster(tileBleed, 512, path.join(DIR.app, "icon-maskable-512.png"));
raster(tileBleed, 180, path.join(DIR.app, "apple-touch-icon-180.png"));

const ico = await pngToIco([favFiles[16], favFiles[32], favFiles[48]]);
fs.writeFileSync(path.join(DIR.pub, "favicon.ico"), ico);
console.log("png  ", "public/favicon.ico");

// -- banners ----------------------------------------------------------
const og = {
  "og-dynamic": ogSvg({
    titleLines: ["Privacy-first analytics", "& RUM for the open web"],
    sub: "Open source under MIT · Runs on Cloudflare's free tier",
  }),
  "og-analytics": ogSvg({
    product: "analytics",
    titleLines: ["Cookieless web analytics"],
    sub: "Pageviews · referrers · devices · goals — no personal data, ever.",
  }),
  "og-rum": ogSvg({
    product: "rum",
    titleLines: ["Real-user monitoring"],
    sub: "Core Web Vitals from real visitors — LCP · INP · CLS.",
  }),
  "og-sdk": ogSvg({
    product: "sdk",
    titleLines: ["The tiny analytics SDK"],
    sub: "One <script> tag — typed, dependency-free, cookieless.",
  }),
};
for (const [name, svg] of Object.entries(og)) {
  emit(path.join(DIR.banners, `${name}.svg`), svg);
  raster(svg, 1200, path.join(DIR.bannersRaster, `${name}.png`));
}
emit(path.join(DIR.banners, "social-cover.svg"), coverSvg());
raster(coverSvg(), 1500, path.join(DIR.bannersRaster, "social-cover.png"));
emit(path.join(DIR.banners, "announce.svg"), announceSvg());
raster(announceSvg(), 1600, path.join(DIR.bannersRaster, "announce.png"));

// -- preview rasters (README + eyeball QA) ---------------------------
/** Raster with an opaque backdrop so light/dark artwork is visible in previews. */
function preview(svgString, width, out, bg) {
  const r = new Resvg(svgString, {
    fitTo: { mode: "width", value: width },
    background: bg,
    font: { loadSystemFonts: false },
  });
  fs.writeFileSync(out, r.render().asPng());
  console.log("png  ", path.relative(ROOT, out));
}
const PREVIEW = path.join(BRAND, "raster", "preview");
fs.mkdirSync(PREVIEW, { recursive: true });
preview(symbolSvg({ slash: true }), 800, path.join(BRAND, "raster", "dynamic-symbol-800.png"), C.ink);
preview(lockupSvg({ onDark: true, slash: true }), 900, path.join(PREVIEW, "logo-horizontal-dark.png"), C.ink);
preview(lockupSvg({ onDark: false, slash: true }), 900, path.join(PREVIEW, "logo-horizontal-light.png"), "#ffffff");
preview(symbolSvg({ slash: true, fill: C.inkText }), 640, path.join(PREVIEW, "symbol-on-dark.png"), C.ink);
preview(symbolSvg({ slash: true, fill: C.ink }), 640, path.join(PREVIEW, "symbol-on-light.png"), "#ffffff");
for (const p of PRODUCTS) {
  const svg = p === "console" ? symbolSvg({}) : symbolSvg({ product: p });
  preview(svg, 320, path.join(BRAND, "raster", `${p}-icon-320.png`), C.ink);
  if (p !== "console") {
    preview(lockupSvg({ product: p, productName: DISPLAY[p], onDark: true }), 1000, path.join(PREVIEW, `${p}-logo-dark.png`), C.ink);
  }
}

// -- public/ (files the site actually serves) ------------------------
copyFavicons();
function copyFavicons() {
  fs.copyFileSync(path.join(DIR.app, "apple-touch-icon-180.png"), path.join(DIR.pub, "apple-touch-icon.png"));
  console.log("copy  public/apple-touch-icon.png");
  for (const size of [16, 32, 48]) {
    fs.copyFileSync(
      path.join(DIR.favicons, `favicon-${size}x${size}.png`),
      path.join(DIR.pubBrand, `favicon-${size}x${size}.png`),
    );
    console.log("copy ", `public/brand/favicon-${size}x${size}.png`);
  }
  fs.copyFileSync(path.join(DIR.app, "icon-192.png"), path.join(DIR.pubBrand, "icon-192.png"));
  fs.copyFileSync(path.join(DIR.app, "icon-512.png"), path.join(DIR.pubBrand, "icon-512.png"));
  console.log("copy ", "public/brand/icon-{192,512}.png");
  fs.copyFileSync(path.join(DIR.bannersRaster, "og-dynamic.png"), path.join(DIR.pub, "og-dynamic.png"));
  console.log("copy ", "public/og-dynamic.png");
}

fs.writeFileSync(
  path.join(DIR.pub, "site.webmanifest"),
  JSON.stringify(
    {
      name: "DYNAMIC — Privacy-first analytics & RUM",
      short_name: "DYNAMIC",
      description: "Open-source, privacy-first web analytics and real-user monitoring on Cloudflare Workers.",
      start_url: "/",
      display: "standalone",
      background_color: C.ink,
      theme_color: C.ink,
      icons: [
        { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log("write", "public/site.webmanifest");
console.log("\nBrand build complete.");
