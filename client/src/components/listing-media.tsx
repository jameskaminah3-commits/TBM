import { useState } from "react";
import type React from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div
        className={cn("flex items-center justify-center bg-muted text-muted-foreground/40", className)}
        style={style}
      >
        <ImageOff className="h-8 w-8" strokeWidth={1.5} />
      </div>
    );
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

  return (
    <img
      src={src}
      alt={alt}
      className={cn("transition-opacity duration-300", !loaded && "opacity-0", className)}
      style={style}
      loading={loading}
      decoding={decoding}
      onLoad={() => setLoaded(true)}
      onError={() => setErrored(true)}
    />
  );
}
