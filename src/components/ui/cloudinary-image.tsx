import { Cloudinary } from "@cloudinary/url-gen";
import { fit } from "@cloudinary/url-gen/actions/resize";
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_DISABLED } from "@/lib/cloudinary";

/**
 * Cloudinary-backed image with a local fallback.
 *
 * The URL is built with the official SDK (`@cloudinary/url-gen`), so delivery
 * gets `f_auto` / `q_auto` and the requested box. A `srcset` with a 1× and a
 * 2× candidate lets the browser pick the right file for the device pixel
 * ratio (Lighthouse flags oversized images otherwise). If Cloudinary is
 * unreachable the component falls back to the bundled file, so the brand
 * marks never disappear.
 *
 * With `VITE_CLOUDINARY_DISABLED=1` the CDN is skipped entirely and the
 * bundled file is served from the site's own origin — the safe default for a
 * self-hosted fork.
 */
const cloudinary = new Cloudinary({ cloud: { cloudName: CLOUDINARY_CLOUD_NAME } });

export interface CloudinaryImageProps {
  /** Public id in the DYNAMIC media library. */
  publicId: string;
  alt?: string;
  className?: string;
  /** Displayed width in CSS pixels. The 2× candidate is generated from it. */
  width?: number;
  height?: number;
  /** `sizes` attribute for the srcset; defaults to a fixed pixel width. */
  sizes?: string;
  /** Local file used when the CDN is unreachable. */
  fallbackSrc?: string;
  loading?: "eager" | "lazy";
  decoding?: "async" | "sync" | "auto";
}

export function CloudinaryImage({
  publicId,
  alt = "",
  className,
  width,
  height,
  sizes,
  fallbackSrc,
  loading = "lazy",
  decoding = "async",
}: CloudinaryImageProps) {
  const build = (targetWidth: number) => {
    const image = cloudinary.image(publicId).format("auto").quality("auto");
    const box = height ? fit().width(targetWidth).height(height) : fit().width(targetWidth);
    return image.resize(box);
  };

  const base = build(width ?? 512);
  const candidates = width ? [width, width * 2] : [];
  const srcSet = candidates
    .map((candidate) => `${build(candidate).toURL()} ${candidate}w`)
    .join(", ");

  // Disabled mode: serve the bundled file, never contact a third party.
  if (CLOUDINARY_DISABLED && fallbackSrc) {
    return (
      <img
        className={className}
        src={fallbackSrc}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        decoding={decoding}
      />
    );
  }

  return (
    <img
      className={className}
      src={base.toURL()}
      srcSet={srcSet || undefined}
      sizes={sizes ?? (width ? `${width}px` : undefined)}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding={decoding}
      onError={
        fallbackSrc
          ? (event: React.SyntheticEvent<HTMLImageElement>) => {
              const element = event.currentTarget;
              if (element.src !== fallbackSrc) {
                element.srcset = "";
                element.src = fallbackSrc;
              }
            }
          : undefined
      }
    />
  );
}

export default CloudinaryImage;
