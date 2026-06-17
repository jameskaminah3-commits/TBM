import React from "react";
import { PremiumMediaGallery } from "@/components/premium-media-gallery";

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
  containerClassName?: string;
  aspectClassName?: string;
  imageClassName?: string;
  thumbnailPlacement?: "overlay" | "below";
  eagerFirstImage?: boolean;
  showArrows?: boolean;
};

export function StayMediaCarousel({
  stay,
  className,
  containerClassName,
  aspectClassName = "aspect-[16/10]",
  imageClassName,
  thumbnailPlacement = "overlay",
  eagerFirstImage = true,
  showArrows,
}: StayMediaCarouselProps) {
  const item = React.useMemo(() => {
    const hasGalleryMedia = Boolean(stay.imageUrl || (stay.galleryUrls && stay.galleryUrls.length > 0));

    return {
      ...stay,
      imageUrl: hasGalleryMedia ? stay.imageUrl : STAY_FALLBACK_IMAGE,
      galleryUrls: hasGalleryMedia ? stay.galleryUrls : [],
    };
  }, [stay]);

  return (
    <PremiumMediaGallery
      item={item}
      title={stay.title}
      className={className}
      containerClassName={containerClassName}
      aspectClassName={aspectClassName}
      imageClassName={imageClassName}
      thumbnailPlacement={thumbnailPlacement}
      eagerFirstImage={eagerFirstImage}
      zoomLabel="Tap to zoom"
      showArrows={showArrows}
    />
  );
}
