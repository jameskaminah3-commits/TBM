import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Star } from "lucide-react";
import { useState } from "react";
import type { Review, ReviewTargetType } from "@shared/schema";

type PublicReview = Review & {
  guestName?: string | null;
};

function formatReviewDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatGuestName(value?: string | null) {
  return value?.trim() || "Verified Guest";
}

export function PublicReviewPreview({
  targetType,
  targetId,
  variant = "compact",
  maxItems = 2,
}: {
  targetType: ReviewTargetType;
  targetId: string;
  variant?: "compact" | "full";
  maxItems?: number;
}) {
  const [open, setOpen] = useState(false);
  const { data: reviews = [] } = useQuery<PublicReview[]>({
    queryKey: ["/api/reviews", targetType, targetId],
    queryFn: async () => {
      const response = await fetch(`/api/reviews/${targetType}/${targetId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch public reviews");
      }
      return response.json();
    },
  });

  const commentReviews = reviews.filter((review) => review.comment?.trim());
  const visibleReviews = commentReviews.slice(0, maxItems);
  const averageRating = reviews.length
    ? (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1)
    : "5.0";

  if (visibleReviews.length === 0) {
    return null;
  }

  if (variant === "full") {
    return (
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="surface-card rounded-[28px] border p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, index) => (
                <Star key={index} className={`h-4 w-4 ${index < Math.round(Number(averageRating)) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/35"}`} />
              ))}
            </div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Rated {averageRating}/5 by verified guests</div>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="rounded-full border-border/70 bg-background/72 hover:bg-background/90">
              {open ? "Hide Full Reviews" : "View Full Reviews"}
              <ChevronDown className={`ml-2 h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="pt-5">
          <div className="max-h-[24rem] overflow-y-auto pr-2">
            <div className="space-y-4">
              {visibleReviews.map((review) => (
                <div key={review.id} className="rounded-[22px] border border-border/60 bg-background/58 p-5 shadow-[0_16px_30px_-28px_rgba(15,23,42,0.22)]">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Star key={index} className={`h-4 w-4 ${index < review.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/35"}`} />
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">{formatReviewDate(review.createdAt)}</div>
                  </div>
                  <div className="mb-2 text-sm font-medium text-foreground">{formatGuestName(review.guestName)}</div>
                  <p className="text-sm leading-7 text-muted-foreground">"{review.comment?.trim()}"</p>
                </div>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  const topReview = visibleReviews[0];
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="surface-card rounded-[20px] border p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, index) => (
              <Star key={index} className={`h-4 w-4 ${index < topReview.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/35"}`} />
            ))}
          </div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Rated {averageRating}/5 by verified guests</div>
        </div>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="rounded-full border-border/70 bg-background/72 hover:bg-background/90">
            {open ? "Hide Full Reviews" : "View Full Reviews"}
            <ChevronDown className={`ml-2 h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="pt-3">
        <div className="max-h-40 overflow-y-auto pr-3">
          <div className="space-y-3">
            {visibleReviews.map((review) => (
              <div key={review.id} className="rounded-2xl border border-border/60 bg-background/55 px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star key={index} className={`h-3.5 w-3.5 ${index < review.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/35"}`} />
                    ))}
                  </div>
                  <span className="text-[11px] text-muted-foreground">{formatReviewDate(review.createdAt)}</span>
                </div>
                <div className="mb-2 text-sm font-medium text-foreground">{formatGuestName(review.guestName)}</div>
                <p className="text-sm leading-6 text-muted-foreground">"{review.comment?.trim()}"</p>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
