// Reviews of the provider's listings, and one reply to each. A reply is public
// once TBM approves it; until then the provider can change or remove it.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock3, MessageSquareReply, Star } from "lucide-react";
import { ProviderLayout } from "@/components/provider-layout";
import { HubPageHeader, HubPanel } from "@/components/provider-hub/hub-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { REVIEW_REPLY_MAX, canEditReviewReply, reviewReplyGuidance, reviewReplyStatusLabels, type ReviewReplyStatus } from "@shared/review-replies";
import { RATING_MIN_REVIEWS } from "@shared/review-eligibility";

type HubReview = {
  id: string;
  listingName: string;
  listingPath: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  guestName: string;
  reply: { text: string; status: ReviewReplyStatus; at: string | null; note: string | null } | null;
};
type ReviewsResponse = { reviews: HubReview[]; rating: { average: number; count: number } | null; count: number };

const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1");
const monthYear = (value: string) => new Date(value).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, index) => (
        <Star key={index} aria-hidden="true" className={cn("h-3.5 w-3.5", index < rating ? "fill-amber-400 text-amber-400" : "text-stone-300")} />
      ))}
    </span>
  );
}

function ReviewCard({ review }: { review: HubReview }) {
  const { toast } = useToast();
  const editable = canEditReviewReply(review.reply?.status);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.reply?.text ?? "");
  useEffect(() => setText(review.reply?.text ?? ""), [review.reply?.text]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/provider/reviews"] });
  const save = useMutation({
    mutationFn: async () => apiRequest("PUT", `/api/provider/reviews/${review.id}/reply`, { text }),
    onSuccess: () => {
      refresh();
      setEditing(false);
      toast({ title: "Reply sent to TBM", description: "It shows with the review once TBM has checked it." });
    },
    onError: (error: Error) => toast({ title: "Couldn't send your reply", description: errorText(error), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/provider/reviews/${review.id}/reply`),
    onSuccess: () => {
      refresh();
      setText("");
      toast({ title: "Reply removed" });
    },
    onError: (error: Error) => toast({ title: "Couldn't remove it", description: errorText(error), variant: "destructive" }),
  });

  const showForm = editable && (editing || !review.reply);
  return (
    <li className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4" data-testid={`hub-review-${review.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-medium text-stone-950">{review.guestName}</span>
          <span className="text-sm text-muted-foreground"> · {monthYear(review.createdAt)}</span>
        </div>
        <Stars rating={review.rating} />
      </div>
      <Link href={review.listingPath} className="text-xs text-teal-800 underline-offset-4 hover:underline">{review.listingName}</Link>
      {review.comment ? <p className="text-sm leading-6 text-stone-700">{review.comment}</p> : <p className="text-sm text-muted-foreground">No comment, just a rating.</p>}

      {review.reply && !showForm ? (
        <div className="space-y-2 rounded-xl bg-stone-50 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">Your reply</span>
            <Badge variant={review.reply.status === "approved" ? "default" : "secondary"} className={cn("rounded-full", review.reply.status === "rejected" && "bg-rose-100 text-rose-900")} data-testid={`reply-status-${review.id}`}>
              {review.reply.status === "pending" ? <Clock3 className="mr-1 h-3 w-3" aria-hidden="true" /> : null}
              {reviewReplyStatusLabels[review.reply.status]}
            </Badge>
          </div>
          <p className="whitespace-pre-line leading-6 text-stone-700">{review.reply.text}</p>
          {review.reply.status === "rejected" && review.reply.note ? <p className="text-rose-900">TBM: {review.reply.note}</p> : null}
          {editable ? (
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => setEditing(true)}>Change it</Button>
              <Button type="button" size="sm" variant="ghost" className="rounded-full text-rose-700" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showForm ? (
        <div className="space-y-2">
          <Textarea
            rows={3}
            maxLength={REVIEW_REPLY_MAX}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={`Asante ${review.guestName.split(" ")[0]}! …`}
            aria-label={`Reply to ${review.guestName}`}
            data-testid={`input-reply-${review.id}`}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{text.trim().length}/{REVIEW_REPLY_MAX}</span>
            <div className="flex gap-2">
              {editing ? <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => { setEditing(false); setText(review.reply?.text ?? ""); }}>Cancel</Button> : null}
              <Button type="button" size="sm" className="rounded-full" disabled={save.isPending || text.trim().length < 2} onClick={() => save.mutate()} data-testid={`button-send-reply-${review.id}`}>
                <MessageSquareReply className="mr-1.5 h-4 w-4" aria-hidden="true" />Send reply to TBM
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default function ProviderReviewsPage() {
  const { data, isLoading } = useQuery<ReviewsResponse>({ queryKey: ["/api/provider/reviews"] });
  const reviews = data?.reviews ?? [];

  return (
    <ProviderLayout title="Reviews">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <HubPageHeader
          eyebrow="Reviews"
          title="What guests said"
          description="Reviews from guests who booked through TBM. You can reply once to each; your reply shows with the review after TBM has checked it."
        />
        <HubPanel>
          <div className="flex flex-wrap items-center gap-3" data-testid="hub-rating-summary">
            {data?.rating ? (
              <>
                <Star className="h-6 w-6 fill-amber-400 text-amber-400" aria-hidden="true" />
                <span className="text-2xl font-semibold tabular-nums">{data.rating.average.toFixed(1)}</span>
                <span className="text-muted-foreground">from {data.rating.count} reviews</span>
              </>
            ) : (
              <span className="text-stone-700">
                {reviews.length
                  ? `${reviews.length} review${reviews.length === 1 ? "" : "s"} so far. Your rating shows from ${RATING_MIN_REVIEWS} reviews; until then your page says "New on TBM".`
                  : `No reviews yet. Your page says "New on TBM" until you have ${RATING_MIN_REVIEWS}.`}
              </span>
            )}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Only reviews from completed bookings count. TBM never hides a review for being negative; it hides one only for abuse, personal details or the wrong booking.
          </p>
        </HubPanel>
        <p className="text-sm text-stone-600">{reviewReplyGuidance}</p>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading reviews…</p> : null}
        <ul className="space-y-3" data-testid="hub-reviews">
          {reviews.map((review) => <ReviewCard key={review.id} review={review} />)}
        </ul>
      </div>
    </ProviderLayout>
  );
}
