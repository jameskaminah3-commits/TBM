import { useState } from "react";
import type React from "react";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";
import { photoSrcSet } from "@shared/photo-variants";

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
  /** Called once if the photo can't be loaded, so a gallery can leave it out. */
  onLoadError?: () => void;
};

// A phone downloads a copy of the photo its own size, never the full upload.
// Our server keeps those copies (shared/photo-variants.ts); Supabase's own
// resizing, on its paid plans, is used instead when
// VITE_SUPABASE_IMAGE_TRANSFORMS=true.
const SUPABASE_PUBLIC_OBJECT_PATH = "/storage/v1/object/public/";
const SUPABASE_RENDER_PATH = "/storage/v1/render/image/public/";
const RESIZED_WIDTHS = [480, 800, 1200, 1600];
const imageTransformsEnabled = import.meta.env.VITE_SUPABASE_IMAGE_TRANSFORMS === "true";

function getResizedSrcSet(src: string) {
  if (!imageTransformsEnabled || !src.includes(SUPABASE_PUBLIC_OBJECT_PATH)) return photoSrcSet(src);
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
  onLoadError,
}: ListingMediaProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  // If a smaller copy can't be had, the original is tried before giving up.
  const [originalOnly, setOriginalOnly] = useState(false);

  if (!src || errored) {
    // No photo: a quiet branded panel, never a broken-image icon.
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.14),transparent_55%),linear-gradient(160deg,hsl(var(--muted)),hsl(var(--card)))]",
          className,
        )}
        style={style}
        role="img"
        aria-label={alt}
      >
        <span aria-hidden="true"><BrandMark className="h-8 opacity-40" /></span>
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

  const srcSet = originalOnly ? undefined : getResizedSrcSet(src);
  // The first photos a page shows load first and appear at once; the rest fade in.
  const priority = loading === "eager";
  return (
    <img
      src={src}
      alt={alt}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      className={cn(!priority && "transition-opacity duration-300", !priority && !loaded && "opacity-0", className)}
      style={style}
      loading={loading}
      decoding={decoding}
      // React 18 passes the attribute through only in lowercase.
      {...(priority ? { fetchpriority: "high" } : {})}
      onLoad={() => setLoaded(true)}
      onError={() => {
        if (srcSet) {
          setOriginalOnly(true);
          return;
        }
        setErrored(true);
        onLoadError?.();
      }}
    />
  );
}
