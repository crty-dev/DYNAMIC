import { Cloudinary } from "@cloudinary/url-gen";
import { fit } from "@cloudinary/url-gen/actions/resize";
import { CLOUDINARY_CLOUD_NAME } from "@/lib/cloudinary";

const cloudinary = new Cloudinary({ cloud: { cloudName: CLOUDINARY_CLOUD_NAME } });

export interface CloudinaryImageProps {
  publicId: string;
  alt?: string;
  className?: string;
  width?: number;
  height?: number;
  /** `sizes` attribute for the srcset; defaults to a fixed pixel width. */
  sizes?: string;
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
