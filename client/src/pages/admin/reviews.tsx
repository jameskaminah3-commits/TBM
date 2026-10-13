// TBM's review moderation: approve or turn down providers' replies, and hide
// a review only for abuse, personal details or the wrong booking (never for
// being negative). Reviewers show as first name and initial.
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EyeOff, Star } from "lucide-react";
import { AdminLayout } from "@/components/admin-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { reviewHideReasonLabels, reviewHideReasons, type ReviewHideReason } from "@shared/review-eligibility";
import { reviewReplyStatusLabels, type ReviewReplyStatus } from "@shared/review-replies";

type AdminReview = {
  id: string;
  listingName: string;
  listingPath: string;
  providerName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  guestName: string;
  eligible: boolean;
  hidden: { reason: string | null; at: string | null } | null;
  reply: { text: string; status: ReviewReplyStatus; at: string | null; note: string | null } | null;
};

const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1");
const shortDate = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function ReviewRow({ review }: { review: AdminReview }) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<ReviewHideReason | "">("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/reviews"] });
  const decide = useMutation({
    mutationFn: async (decision: "approve" | "reject") => apiRequest("POST", `/api/admin/reviews/${review.id}/reply`, { decision, note: note.trim() || null }),
    onSuccess: (_data, decision) => {
      refresh();
      setNote("");
      toast({ title: decision === "approve" ? "Reply approved" : "Reply turned down" });
    },
    onError: (error: Error) => toast({ title: "Couldn't save", description: errorText(error), variant: "destructive" }),
  });
  const hide = useMutation({
    mutationFn: async (action: "hide" | "unhide") => apiRequest("POST", `/api/admin/reviews/${review.id}/${action}`, action === "hide" ? { reason } : {}),
    onSuccess: (_data, action) => {
      refresh();
      setReason("");
      toast({ title: action === "hide" ? "Review hidden" : "Review shown again" });
    },
    onError: (error: Error) => toast({ title: "Couldn't change it", description: errorText(error), variant: "destructive" }),
  });

  return (
    <li className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4" data-testid={`admin-review-${review.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{review.guestName} · <a href={review.listingPath} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">{review.listingName}</a></div>
          <div className="text-xs text-muted-foreground">{review.providerName} · {shortDate(review.createdAt)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-sm font-medium"><Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />{review.rating}</span>
          {review.hidden ? <Badge variant="secondary" className="rounded-full">Hidden: {reviewHideReasonLabels[review.hidden.reason as ReviewHideReason] ?? review.hidden.reason}</Badge> : null}
          {!review.eligible ? <Badge variant="outline" className="rounded-full">Doesn't count (not a completed booking of theirs)</Badge> : null}
        </div>
      </div>
      {review.comment ? <p className="text-sm leading-6 text-stone-700">{review.comment}</p> : null}

      {review.reply ? (
        <div className={cn("space-y-2 rounded-xl p-3 text-sm", review.reply.status === "pending" ? "bg-amber-50" : "bg-stone-50")}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">Provider's reply</span>
            <Badge variant="outline" className="rounded-full">{reviewReplyStatusLabels[review.reply.status]}</Badge>
          </div>
          <p className="whitespace-pre-line leading-6">{review.reply.text}</p>
          {review.reply.note ? <p className="text-xs text-muted-foreground">Note sent: {review.reply.note}</p> : null}
          {review.reply.status === "pending" ? (
            <div className="space-y-2">
              <Textarea rows={2} value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="Note for the provider (needed to turn it down)" aria-label="Reply review note" />
              <div className="flex gap-2">
                <Button type="button" size="sm" className="rounded-full bg-emerald-700 hover:bg-emerald-800" disabled={decide.isPending} onClick={() => decide.mutate("approve")} data-testid={`button-approve-reply-${review.id}`}>Approve reply</Button>
                <Button type="button" size="sm" variant="outline" className="rounded-full text-rose-700" disabled={decide.isPending || !note.trim()} onClick={() => decide.mutate("reject")} data-testid={`button-reject-reply-${review.id}`}>Turn down</Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
        {review.hidden ? (
          <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={hide.isPending} onClick={() => hide.mutate("unhide")}>Show it again</Button>
        ) : (
          <>
            <Select value={reason} onValueChange={(value) => setReason(value as ReviewHideReason)}>
              <SelectTrigger className="h-9 w-[260px] rounded-full" aria-label="Why hide it" data-testid={`select-hide-reason-${review.id}`}><SelectValue placeholder="Hide only for…" /></SelectTrigger>
              <SelectContent>
                {reviewHideReasons.map((option) => <SelectItem key={option} value={option}>{reviewHideReasonLabels[option]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" variant="ghost" className="rounded-full text-rose-700" disabled={hide.isPending || !reason} onClick={() => hide.mutate("hide")} data-testid={`button-hide-review-${review.id}`}>
              <EyeOff className="mr-1.5 h-4 w-4" aria-hidden="true" />Hide review
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export default function AdminReviews() {
  const [, setLocation] = useLocation();
  const { isLoading: authLoading, isAdmin } = useAuth();
  useEffect(() => {
    if (!authLoading && !isAdmin) setLocation("/auth?next=/admin/reviews");
  }, [authLoading, isAdmin, setLocation]);
  const { data, isLoading } = useQuery<{ reviews: AdminReview[] }>({ queryKey: ["/api/admin/reviews"], enabled: isAdmin });
  const [filter, setFilter] = useState<"replies" | "all" | "hidden">("replies");
  const reviews = data?.reviews ?? [];
  const waiting = reviews.filter((review) => review.reply?.status === "pending");
  const shown = useMemo(() => (filter === "replies" ? waiting : filter === "hidden" ? reviews.filter((review) => review.hidden) : reviews), [filter, reviews, waiting]);

  return (
    <AdminLayout>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
        <Card className="border-stone-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-2xl">Reviews</CardTitle>
            <CardDescription className="leading-6">
              Approve providers' replies before they're public. Hide a review only if it's abusive, contains personal details, or isn't about this booking. Never hide one for being negative; the reason is recorded.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {([["replies", `Replies waiting (${waiting.length})`], ["all", `All reviews (${reviews.length})`], ["hidden", "Hidden"]] as const).map(([value, label]) => (
              <Button key={value} type="button" size="sm" variant={filter === value ? "default" : "outline"} className="rounded-full" onClick={() => setFilter(value)} data-testid={`filter-reviews-${value}`}>{label}</Button>
            ))}
          </CardContent>
        </Card>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading reviews…</p> : null}
        {!isLoading && !shown.length ? <p className="text-sm text-muted-foreground">{filter === "replies" ? "No replies are waiting." : "Nothing here."}</p> : null}
        <ul className="space-y-3">{shown.map((review) => <ReviewRow key={review.id} review={review} />)}</ul>
      </div>
    </AdminLayout>
  );
}
