/**
 * Cloudinary delivery helpers.
 *
 * The cloud name and the upload key are public by design (the browser needs
 * them for a signed upload); the API secret never leaves the Worker.
 */

export const CLOUDINARY_CLOUD_NAME = "di9c12gg6";
export const CLOUDINARY_UPLOAD_KEY = "657115753521274";

export const CLOUDINARY_DELIVERY_BASE = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload`;

/** Folders used by the DYNAMIC media library. */
export const CLOUDINARY_FOLDERS = {
  brand: "dynamic/brand",
  uploads: "dynamic/uploads",
  social: "dynamic/social",
} as const;

/**
 * Brand assets that live in Cloudinary (public ids, without the version
 * prefix). The same files are bundled locally as a fallback, so a CDN
 * hiccup never breaks the brand mark.
 */
export const CLOUDINARY_ASSETS = {
  logo: "logo-removebg-preview_dnbcty",
  analytics: "DYNAMIC_Analytics-removebg-preview_jiuqiw",
  rum: "DYNAMIC_RUM-removebg-preview_xmrfrg",
  sdk: "DYNAMIC_SDK-removebg-preview_mriaab",
  console: "DYNAMIC_Console-removebg-preview_machdd",
} as const;

export type CloudinaryAssetKey = keyof typeof CLOUDINARY_ASSETS;

export type CloudinaryTransform = {
  width?: number;
  height?: number;
  crop?: "fill" | "fit" | "scale" | "limit" | "thumb";
  gravity?: "auto" | "center" | "face";
  quality?: "auto" | number;
  format?: "auto" | "webp" | "avif" | "png" | "jpg";
  dpr?: "auto" | number;
};

/** Builds a delivery URL for a public id, e.g. "dynamic/brand/logo". */
export function cloudinaryUrl(publicId: string, transform: CloudinaryTransform = {}): string {
  const parts: string[] = [];

  if (transform.width) parts.push(`w_${transform.width}`);
  if (transform.height) parts.push(`h_${transform.height}`);
  if (transform.crop) parts.push(`c_${transform.crop}`);
  if (transform.gravity) parts.push(`g_${transform.gravity}`);
  if (transform.dpr) parts.push(`dpr_${transform.dpr}`);
  if (transform.quality) parts.push(`q_${transform.quality}`);
  if (transform.format) parts.push(`f_${transform.format}`);

  // Sensible defaults: automatic format + quality, capped width.
  if (!transform.quality) parts.push("q_auto");
  if (!transform.format) parts.push("f_auto");
  if (!transform.width && !transform.height) parts.push("w_2000");

  const path = parts.length ? `${parts.join(",")}/` : "";
  return `${CLOUDINARY_DELIVERY_BASE}/${path}${publicId}`;
}

export type MediaConfig = {
  enabled: boolean;
  cloudName: string | null;
  uploadKey: string | null;
  deliveryBase: string | null;
  folder: string;
};

/** Reads the public media configuration from the Worker. */
export async function fetchMediaConfig(signal?: AbortSignal): Promise<MediaConfig> {
  const response = await fetch("/api/media/config", { signal });
  if (!response.ok) throw new Error(`media_config_failed_${response.status}`);
  return (await response.json()) as MediaConfig;
}

export type SignedUploadParams = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  signature: string;
};

/** Requests signed upload parameters (requires the media upload token). */
export async function requestUploadSignature(
  token: string,
  signal?: AbortSignal,
): Promise<SignedUploadParams> {
  const response = await fetch("/api/media/signature", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    signal,
  });
  if (!response.ok) throw new Error(`media_signature_failed_${response.status}`);
  return (await response.json()) as SignedUploadParams;
}
