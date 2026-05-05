import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ListingMedia } from "@/components/listing-media";
import {
  Carousel,
  CarouselApi,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

const STAY_FALLBACK_IMAGE = "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=1200";

type StayMediaCarouselProps = {
  stay: {
    id: string;
    title: string;
    imageUrl?: string | null;
    galleryUrls?: string[] | null;
    mediaType?: string | null;
  };
  className?: string;
  aspectClassName?: string;
  imageClassName?: string;
  thumbnailPlacement?: "overlay" | "below";
};

function getStayGalleryImages(stay: StayMediaCarouselProps["stay"]) {
  const galleryImages = [stay.imageUrl, ...(stay.galleryUrls ?? [])].filter(
    (imageUrl, index, allImages): imageUrl is string => !!imageUrl && allImages.indexOf(imageUrl) === index,
  );

  return galleryImages.length > 0 ? galleryImages : [STAY_FALLBACK_IMAGE];
}

export function StayMediaCarousel({
  stay,
  className,
  aspectClassName = "aspect-[16/10]",
  imageClassName,
  thumbnailPlacement = "overlay",
}: StayMediaCarouselProps) {
  const galleryImages = React.useMemo(() => getStayGalleryImages(stay), [stay]);
  const [carouselApi, setCarouselApi] = React.useState<CarouselApi>();
  const [activeIndex, setActiveIndex] = React.useState(0);
  const visibleThumbs = thumbnailPlacement === "overlay" ? galleryImages.slice(0, 3) : galleryImages;

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

  return (
    <div className={cn("space-y-4", className)}>
      <div className="relative overflow-hidden rounded-[1.6rem] bg-muted">
        <Carousel className="overflow-hidden" opts={{ loop: galleryImages.length > 1 }} setApi={setCarouselApi}>
          <CarouselContent className="ml-0">
            {galleryImages.map((imageUrl, index) => (
              <CarouselItem key={`${stay.id}-image-${index}`} className="pl-0">
                <div className={cn("overflow-hidden bg-muted", aspectClassName)}>
                  <ListingMedia
                    src={imageUrl}
                    alt={`${stay.title} photo ${index + 1}`}
                    mediaType={stay.mediaType}
                    className={cn("h-full w-full object-cover", imageClassName)}
                    loading={index === 0 ? "eager" : "lazy"}
                  />
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>

        {galleryImages.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous stay photo"
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
              aria-label="Next stay photo"
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
                  key={`${stay.id}-thumb-${index}`}
                  type="button"
                  aria-label={`View stay photo ${index + 1}`}
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
            <p className="text-sm font-medium text-foreground">
              Browse photos
            </p>
            <p className="text-sm text-muted-foreground">
              {activeIndex + 1} of {galleryImages.length}
            </p>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {visibleThumbs.map((imageUrl, index) => (
              <button
                key={`${stay.id}-detail-thumb-${index}`}
                type="button"
                aria-label={`View stay photo ${index + 1}`}
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
    </div>
  );
}
