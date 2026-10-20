import { AdvancedImage } from "@cloudinary/react";
import { Cloudinary } from "@cloudinary/url-gen";
import { fit } from "@cloudinary/url-gen/actions/resize";
import { CLOUDINARY_CLOUD_NAME } from "@/lib/cloudinary";

/**
 * Cloudinary-backed image with a local fallback.
 *
 * The URL is built with the official SDK (`@cloudinary/url-gen`), so the
 * delivery gets `f_auto` / `q_auto` and the requested box. If Cloudinary is
 * unreachable the component falls back to the bundled file, so the brand
 * marks never disappear.
 */
const cloudinary = new Cloudinary({ cloud: { cloudName: CLOUDINARY_CLOUD_NAME } });

export interface CloudinaryImageProps {
  /** Public id in the DYNAMIC media library. */
  publicId: string;
  alt?: string;
  className?: string;
  width?: number;
  height?: number;
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
  fallbackSrc,
  loading = "lazy",
  decoding = "async",
}: CloudinaryImageProps) {
  let image = cloudinary.image(publicId).format("auto").quality("auto");
  if (width && height) image = image.resize(fit().width(width).height(height));
  else if (width) image = image.resize(fit().width(width));
  else if (height) image = image.resize(fit().height(height));

  return (
    <AdvancedImage
      cldImg={image}
      className={className}
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
