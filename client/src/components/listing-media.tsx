type ListingMediaProps = {
  src?: string | null;
  alt: string;
  mediaType?: string | null;
  className?: string;
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
};

export function ListingMedia({
  src,
  alt,
  mediaType = "image",
  className,
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
        controls
        preload="metadata"
        playsInline
      />
    );
  }

  return <img src={src} alt={alt} className={className} loading={loading} decoding={decoding} />;
}
