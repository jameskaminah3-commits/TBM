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
  /** How wide the photo shows, for picking a smaller copy: "(min-width: 1024px) 33vw, 100vw". */
  sizes?: string;
};

// Supabase can serve a photo resized (image transformations, on its paid
// plans). Switched on with VITE_SUPABASE_IMAGE_TRANSFORMS=true, a phone then
// downloads a copy its own size instead of the full upload.
const SUPABASE_PUBLIC_OBJECT_PATH = "/storage/v1/object/public/";
const SUPABASE_RENDER_PATH = "/storage/v1/render/image/public/";
const RESIZED_WIDTHS = [480, 800, 1200, 1600];
const imageTransformsEnabled = import.meta.env.VITE_SUPABASE_IMAGE_TRANSFORMS === "true";

function getResizedSrcSet(src: string) {
  if (!imageTransformsEnabled || !src.includes(SUPABASE_PUBLIC_OBJECT_PATH)) return undefined;
  const base = src.replace(SUPABASE_PUBLIC_OBJECT_PATH, SUPABASE_RENDER_PATH);
  const joiner = base.includes("?") ? "&" : "?";
  return RESIZED_WIDTHS.map((width) => `${base}${joiner}width=${width}&quality=72 ${width}w`).join(", ");
}

export function ListingMedia({
  src,
  alt,
  mediaType = "image",
  className,
  style,
  loading = "lazy",
  decoding = "async",
  sizes = "100vw",
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
      srcSet={getResizedSrcSet(src)}
      sizes={getResizedSrcSet(src) ? sizes : undefined}
      className={cn("transition-opacity duration-300", !loaded && "opacity-0", className)}
      style={style}
      loading={loading}
      decoding={decoding}
      onLoad={() => setLoaded(true)}
      onError={() => setErrored(true)}
    />
  );
}
