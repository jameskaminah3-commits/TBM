import type React from "react";

type ListingMediaProps = {
  src?: string | null;
  alt: string;
  mediaType?: string | null;
  className?: string;
  style?: React.CSSProperties;
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
};

export function ListingMedia({
  src,
  alt,
  mediaType = "image",
  className,
  style,
  loading = "lazy",
  decoding = "async",
}: ListingMediaProps) {
  if (!src) {
    return <div className={className} />;
  }

  if (mediaType === "video") {
    return (
      <video
        src={src}
        className={className}
        style={style}
        controls
        preload="metadata"
        playsInline
      />
    );
  }

  return <img src={src} alt={alt} className={className} style={style} loading={loading} decoding={decoding} />;
}
