import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Maximize2, RotateCcw, X } from "lucide-react";
import { Carousel, CarouselApi, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { ListingMedia } from "@/components/listing-media";
import { cn } from "@/lib/utils";

type GallerySource = {
  id: string;
  imageUrl?: string | null;
  galleryUrls?: string[] | null;
  mediaType?: string | null;
};

type PremiumMediaGalleryProps = {
  item: GallerySource;
  title: string;
  className?: string;
  aspectClassName?: string;
  imageClassName?: string;
  thumbnailPlacement?: "overlay" | "below";
  eagerFirstImage?: boolean;
  zoomLabel?: string;
};

function getGalleryImages(item: GallerySource) {
  return [item.imageUrl, ...(item.galleryUrls ?? [])].filter(
    (imageUrl, index, allImages): imageUrl is string => !!imageUrl && allImages.indexOf(imageUrl) === index,
  );
}

export function PremiumMediaGallery({
  item,
  title,
  className,
  aspectClassName = "aspect-[16/10]",
  imageClassName,
  thumbnailPlacement = "overlay",
  eagerFirstImage = true,
  zoomLabel = "Tap to zoom",
}: PremiumMediaGalleryProps) {
  const galleryImages = React.useMemo(() => getGalleryImages(item), [item]);
  const [carouselApi, setCarouselApi] = React.useState<CarouselApi>();
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const [lightboxIndex, setLightboxIndex] = React.useState(0);
  const [zoom, setZoom] = React.useState(1);
  const lastTapRef = React.useRef(0);
  const thumbnailRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const visibleThumbs = thumbnailPlacement === "overlay" ? galleryImages.slice(0, 3) : galleryImages;
  const showZoomControls = item.mediaType !== "video";

  React.useEffect(() => {
    if (!carouselApi) {
      return;
    }

    carouselApi.scrollTo(0, true);
    setActiveIndex(0);

    const syncSelection = () => {
      setActiveIndex(carouselApi.selectedScrollSnap());
    };

    syncSelection();
    carouselApi.on("select", syncSelection);
    carouselApi.on("reInit", syncSelection);

    return () => {
      carouselApi.off("select", syncSelection);
      carouselApi.off("reInit", syncSelection);
    };
  }, [carouselApi, galleryImages.length]);

  React.useEffect(() => {
    if (thumbnailPlacement !== "below") {
      return;
    }

    thumbnailRefs.current[activeIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeIndex, thumbnailPlacement]);

  React.useEffect(() => {
    if (!lightboxOpen) {
      setZoom(1);
    }
  }, [lightboxOpen]);

  React.useEffect(() => {
    if (!lightboxOpen || galleryImages.length === 0) {
      return;
    }

    setLightboxIndex(activeIndex);
  }, [activeIndex, galleryImages.length, lightboxOpen]);

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setZoom(1);
    setLightboxOpen(true);
  };

  const toggleZoom = () => {
    if (!showZoomControls) {
      return;
    }

    setZoom((current) => (current > 1 ? 1 : 1.85));
  };

  const handleImageTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      toggleZoom();
    }
    lastTapRef.current = now;
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="relative overflow-hidden rounded-[1.6rem] bg-muted">
        {galleryImages.length > 0 ? (
          <Carousel className="overflow-hidden" opts={{ loop: galleryImages.length > 1 }} setApi={setCarouselApi}>
            <CarouselContent className="ml-0">
              {galleryImages.map((imageUrl, index) => (
                <CarouselItem key={`${item.id}-image-${index}`} className="pl-0">
                  <button
                    type="button"
                    className={cn("group relative block w-full overflow-hidden bg-muted text-left", aspectClassName)}
                    onClick={() => openLightbox(index)}
                    aria-label={`${zoomLabel} ${index + 1} for ${title}`}
                  >
                    <ListingMedia
                      src={imageUrl}
                      alt={`${title} photo ${index + 1}`}
                      mediaType={item.mediaType}
                      className={cn(
                        "h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]",
                        imageClassName,
                      )}
                      loading={eagerFirstImage && index === 0 ? "eager" : "lazy"}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-900/10 to-transparent" />
                    <div className="absolute left-4 top-4 flex items-center gap-2">
                      <div className="rounded-full border border-white/15 bg-black/35 px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-white/90 backdrop-blur-md">
                        {index + 1}/{galleryImages.length}
                      </div>
                    </div>
                    <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 py-2 text-xs font-medium text-white backdrop-blur-md">
                        <Maximize2 className="h-3.5 w-3.5" />
                        {zoomLabel}
                      </div>
                      {galleryImages.length > 1 ? (
                        <div className="hidden rounded-full border border-white/15 bg-black/35 px-3 py-2 text-xs font-medium text-white backdrop-blur-md sm:inline-flex">
                          Swipe for more
                        </div>
                      ) : null}
                    </div>
                  </button>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
        ) : (
          <div className={cn("flex items-center justify-center bg-muted text-sm text-muted-foreground", aspectClassName)}>
            Photos coming soon
          </div>
        )}

        {galleryImages.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white backdrop-blur-md transition hover:bg-black/50"
              onClick={(event) => {
                event.stopPropagation();
                carouselApi?.scrollPrev();
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white backdrop-blur-md transition hover:bg-black/50"
              onClick={(event) => {
                event.stopPropagation();
                carouselApi?.scrollNext();
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        ) : null}

        {thumbnailPlacement === "overlay" && galleryImages.length > 1 ? (
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
            <div className="flex items-center gap-2">
              {visibleThumbs.map((imageUrl, index) => (
                <button
                  key={`${item.id}-thumb-${index}`}
                  type="button"
                  aria-label={`View photo ${index + 1}`}
                  className={cn(
                    "h-11 w-11 overflow-hidden rounded-2xl border border-white/15 shadow-lg backdrop-blur-md transition",
                    activeIndex === index ? "scale-105 border-white/70" : "opacity-80 hover:opacity-100",
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    carouselApi?.scrollTo(index);
                  }}
                >
                  <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
              ))}
              {galleryImages.length > visibleThumbs.length ? (
                <div className="flex h-11 min-w-11 items-center justify-center rounded-2xl border border-white/15 bg-black/35 px-3 text-xs font-semibold text-white backdrop-blur-md">
                  +{galleryImages.length - visibleThumbs.length}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {thumbnailPlacement === "below" && galleryImages.length > 1 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-foreground">Browse photos</p>
            <p className="text-sm text-muted-foreground">
              {activeIndex + 1} of {galleryImages.length}
            </p>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {visibleThumbs.map((imageUrl, index) => (
              <button
                key={`${item.id}-detail-thumb-${index}`}
                ref={(node) => {
                  thumbnailRefs.current[index] = node;
                }}
                type="button"
                aria-label={`View photo ${index + 1}`}
                aria-current={activeIndex === index ? "true" : undefined}
                className={cn(
                  "h-20 w-28 flex-shrink-0 overflow-hidden rounded-2xl border bg-muted shadow-sm transition",
                  activeIndex === index
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border/60 opacity-80 hover:opacity-100",
                )}
                onClick={() => carouselApi?.scrollTo(index)}
              >
                <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <DialogPrimitive.Root
        open={lightboxOpen}
        onOpenChange={(nextOpen) => {
          setLightboxOpen(nextOpen);
          if (!nextOpen) {
            setZoom(1);
          }
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm" />
          <DialogPrimitive.Content
            className="fixed inset-0 z-50 flex h-[100dvh] w-[100dvw] flex-col border-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.14),rgba(2,6,23,0.98)_68%)] p-0 text-white shadow-none outline-none"
          >
            <div className="flex items-center justify-between gap-3 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-6">
              <div className="min-w-0">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-white/55">
                  Gallery
                </p>
                <DialogPrimitive.Title asChild>
                  <h2 className="truncate text-base font-semibold text-white sm:text-lg">
                    {title}
                  </h2>
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">
                  Browse the listing photos, move between images, and zoom the current image if needed.
                </DialogPrimitive.Description>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur-md">
                  {lightboxIndex + 1} of {galleryImages.length}
                </div>
                <DialogPrimitive.Close className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30">
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close gallery</span>
                </DialogPrimitive.Close>
              </div>
            </div>

            <div className="flex flex-1 items-center justify-center px-3 pb-4 pt-1 sm:px-6">
              <div className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-black/30 shadow-[0_40px_120px_rgba(0,0,0,0.4)]">
                {galleryImages.length > 1 ? (
                  <>
                    <button
                      type="button"
                      aria-label="Previous photo"
                      className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur-md transition hover:bg-black/55"
                      onClick={() => setLightboxIndex((current) => (current - 1 + galleryImages.length) % galleryImages.length)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next photo"
                      className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur-md transition hover:bg-black/55"
                      onClick={() => setLightboxIndex((current) => (current + 1) % galleryImages.length)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                ) : null}

                <div className="relative flex flex-1 items-center justify-center overflow-auto px-3 py-4 sm:px-6 sm:py-6">
                  {showZoomControls && zoom > 1 ? (
                    <button
                      type="button"
                      aria-label="Reset zoom"
                      className="absolute bottom-4 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white shadow-[0_14px_40px_rgba(0,0,0,0.35)] backdrop-blur-md transition hover:bg-black/55"
                      onClick={() => setZoom(1)}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  ) : null}

                  <div
                    className="flex min-h-full min-w-full items-center justify-center"
                    onClick={handleImageTap}
                  >
                    <div className="flex max-w-full items-center justify-center overflow-auto rounded-[1.5rem]">
                      <ListingMedia
                        src={galleryImages[lightboxIndex]}
                        alt={`${title} photo ${lightboxIndex + 1}`}
                        mediaType={item.mediaType}
                        style={
                          showZoomControls
                            ? {
                                width: `${zoom * 100}%`,
                                maxWidth: "none",
                              }
                            : undefined
                        }
                        className={cn(
                          "block max-h-[72vh] select-none transition-[width] duration-200 ease-out",
                          showZoomControls ? "max-w-none touch-pan-x touch-pan-y" : "max-w-full object-contain",
                        )}
                        loading="eager"
                        decoding="sync"
                      />
                    </div>
                  </div>
                </div>

                {galleryImages.length > 1 ? (
                  <div className="border-t border-white/10 bg-black/25 px-3 py-3 backdrop-blur-xl sm:px-4">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {galleryImages.map((imageUrl, index) => (
                        <button
                          key={`${item.id}-lightbox-thumb-${index}`}
                          type="button"
                          aria-label={`Open photo ${index + 1}`}
                          aria-current={lightboxIndex === index ? "true" : undefined}
                          className={cn(
                            "h-16 w-24 flex-shrink-0 overflow-hidden rounded-xl border bg-white/5 transition",
                            lightboxIndex === index
                              ? "border-white/70 ring-2 ring-white/20"
                              : "border-white/10 opacity-75 hover:opacity-100",
                          )}
                          onClick={() => setLightboxIndex(index)}
                        >
                          <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}
