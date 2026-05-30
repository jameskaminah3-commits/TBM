import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Calendar, MapPin, Users, Car, ChefHat, ShoppingBag, Compass, CheckCircle2, UserRound, Clock3, ShieldCheck, Phone, Mail, Star, Download, Smartphone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InboxCenter } from "@/components/inbox-center";
import { ListingMedia } from "@/components/listing-media";
import { CurrencyAmount } from "@/components/currency-amount";
import { useCurrency } from "@/lib/currency";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BookingThread } from "@/components/booking-thread";
import { BookingServiceDetails } from "@/components/booking-service-details";
import { RequestBriefAccordion } from "@/components/request-brief-accordion";
import { CheckoutPaymentPreview, CheckoutPaymentSheet, getPaymentChoiceForProvider } from "@/components/payment-provider-picker";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  getBookingAmountPaid,
  getBookingCheckoutAmount,
  getBookingOutstandingAmount,
  hasLockedInBookingDeposit,
  isFullPaymentOnlyBooking,
  isBookingFullyPaid,
  supportsBookingDeposit,
} from "@shared/booking-payments";
import { customServiceRequestFeeUsd } from "@shared/custom-service";
import type { Booking, BookingWithMarketing, Stay, Car as CarType, Cook, Errand, Experience, Review, CustomerPaymentMethod } from "@shared/schema";

type ReviewTarget = { targetType: "stay" | "car" | "cook" | "errand" | "experience"; targetId: string; label: string };

const TEMP_MPESA_SEND_MONEY_NUMBER = "0718475264";

const getBookingPromoLabel = (booking: BookingWithMarketing) =>
  booking.marketingAttribution?.promoName
  || booking.marketingAttribution?.promoCode
  || "Promo";

const isHistoryBookingStatus = (status: string) => status === "completed" || status === "cancelled";
const isBookingPaid = (booking: Pick<Booking, "totalPrice" | "paymentStatus" | "paymentAmountPaid">) => isBookingFullyPaid(booking);
const hasBookingDepositRequirement = (booking: Pick<Booking, "serviceMode" | "paymentDepositAmount">) =>
  supportsBookingDeposit(booking) && typeof booking.paymentDepositAmount === "number" && booking.paymentDepositAmount > 0;
const canRetryBookingPayment = (booking: Booking) =>
  getBookingCheckoutAmount(booking) > 0
  && !isBookingPaid(booking)
  && booking.status !== "cancelled"
  && booking.status !== "completed";
const getBookingPaymentStatusLabel = (booking: Booking) => {
  if (booking.paymentProvider === "mpesa-manual" && booking.paymentStatus === "processing") {
    return hasLockedInBookingDeposit(booking) ? "Manual M-Pesa submitted - balance review" : "Manual M-Pesa submitted";
  }

  if (hasLockedInBookingDeposit(booking)) {
    if (booking.paymentStatus === "failed") {
      return "Balance payment failed";
    }
    if (booking.paymentStatus === "cancelled") {
      return "Balance checkout cancelled";
    }
    if (booking.paymentStatus === "processing") {
      return "Balance processing";
    }
    return "Deposit paid - balance due";
  }

  switch (booking.paymentStatus) {
    case "paid":
      return "Paid";
    case "processing":
      return "Processing";
    case "failed":
      return "Payment failed";
    case "cancelled":
      return "Checkout cancelled";
    case "refunded":
      return "Refunded";
    default:
      return hasBookingDepositRequirement(booking) ? "Deposit due" : "Payment pending";
  }
};
const getBookingDueLabel = (booking: Booking) => {
  if (isBookingPaid(booking)) {
    return "Total paid";
  }
  if (hasLockedInBookingDeposit(booking)) {
    return "Balance due";
  }
  if (hasBookingDepositRequirement(booking)) {
    return "Deposit due now";
  }
  return "Amount due";
};

const getBookingStatusLabel = (status: string) => status === "late"
  ? "Needs attention"
  : status === "in-progress"
    ? "In progress"
    : status === "pending-payment"
      ? "Pending payment"
      : status === "pending"
        ? "Pending"
        : status === "completed"
          ? "Completed"
          : status === "cancelled"
            ? "Cancelled"
            : "Upcoming";
const getBookingScheduleSlots = (booking: Booking) => (booking.serviceScheduleSlots || []).filter((slot): slot is { date: string; note: string } => !!slot?.date).sort((a, b) => a.date.localeCompare(b.date));
const getBookingThreadInitialLabel = (booking: Booking) => {
  if (booking.serviceMode === "errand-shopping") return "Shopping List";
  if (booking.serviceMode === "errand-childcare") return "Family Care Notes";
  return "Request";
};
const getReviewTone = (rating: number) => rating === 5 ? "Exceptional" : rating === 4 ? "Excellent" : rating === 3 ? "Good" : rating === 2 ? "Fair" : "Needs attention";
const formatTimelineLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
const getRequestPreview = (details?: string | null) => {
  if (!details) {
    return "No details shared.";
  }

  const flattened = details
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  if (!flattened) {
    return "No details shared.";
  }

  return flattened.length > 180 ? `${flattened.slice(0, 177)}...` : flattened;
};
const formatTimelineDateRange = (start: string, end: string) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const sameDay = start === end;

  if (sameDay) {
    return startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();

  if (sameMonth) {
    return `${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${endDate.toLocaleDateString("en-US", { day: "numeric", year: "numeric" })}`;
  }

  if (sameYear) {
    return `${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }

  return `${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} - ${endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
};

function BookingTimeline({ booking }: { booking: Booking }) {
  const items = [
    {
      title: "Requested",
      detail: formatTimelineLabel(booking.createdAt) ?? "Booking created",
      active: true,
    },
    {
      title: booking.serviceMode === "cook-custom-menu" ? "Chef Quote" : booking.serviceMode === "experience-custom-offer" ? "Custom Offer" : "Confirmed",
      detail:
        booking.serviceMode === "cook-custom-menu"
          ? booking.customMenuProposalStatus === "proposed"
            ? "Quote ready"
            : booking.customMenuProposalStatus === "pending-admin-approval"
              ? "Under admin review"
              : "Waiting for chef response"
          : booking.serviceMode === "experience-custom-offer"
            ? booking.experienceCustomOfferStatus === "proposed"
              ? "Offer ready"
              : booking.experienceCustomOfferStatus === "pending-admin-approval"
                ? "Under admin review"
                : "Waiting for partner response"
            : "Confirmed",
      active:
        booking.serviceMode === "cook-custom-menu"
          ? booking.customMenuProposalStatus !== "pending"
          : booking.serviceMode === "experience-custom-offer"
            ? booking.experienceCustomOfferStatus !== "pending"
            : true,
    },
    {
      title: "Schedule",
      detail: formatTimelineDateRange(booking.checkIn, booking.checkOut),
      active: booking.status === "upcoming" || booking.status === "pending-payment" || booking.status === "in-progress" || booking.status === "late" || booking.status === "completed",
    },
    {
      title: booking.status === "cancelled" ? "Closed" : "Completed",
      detail: booking.status === "completed" ? "Service complete" : booking.status === "cancelled" ? "Booking closed" : "Awaiting completion",
      active: booking.status === "completed" || booking.status === "cancelled",
    },
  ];

  return (
    <div className="overflow-hidden rounded-[24px] border border-border/60 bg-background/90 p-5 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.28)]">
      <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Progress</div>
          <div className="mt-1 text-lg font-semibold tracking-tight text-foreground">Where this booking stands</div>
        </div>
        <Badge variant={booking.status === "completed" ? "secondary" : booking.status === "cancelled" ? "outline" : "default"} className="rounded-full">
          {getBookingStatusLabel(booking.status)}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item, index) => (
          <div
            key={`${item.title}-${index}`}
            className={cn(
              "rounded-[20px] border px-4 py-3",
              item.active ? "border-border/70 bg-muted/35" : "border-dashed border-border/60 bg-background/70",
            )}
          >
            <div className="flex items-start gap-3">
              <div className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                item.active ? "border-primary/25 bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground",
              )}>
                <span>{index + 1}</span>
              </div>
              <div className="min-w-0">
                <div className={cn("text-[11px] font-semibold uppercase tracking-[0.2em]", item.active ? "text-muted-foreground" : "text-muted-foreground/70")}>
                  {item.title}
                </div>
                <div className={cn("mt-1 text-sm leading-6", item.active ? "text-foreground" : "text-muted-foreground")}>
                  {item.detail}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BookingReviewSection({ booking, targets }: { booking: Booking; targets: ReviewTarget[] }) {
  const { toast } = useToast();
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  const [rating, setRating] = useState("5");
  const [comment, setComment] = useState("");
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  const { data: reviews = [] } = useQuery<Review[]>({
    queryKey: ["/api/bookings", booking.id, "reviews"],
    enabled: booking.status === "completed",
    queryFn: async () => {
      const response = await fetch(`/api/bookings/${booking.id}/reviews`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load reviews");
      return response.json();
    },
  });

  const submitReviewMutation = useMutation({
    mutationFn: async (payload: { targetType: string; targetId: string; rating: number; comment: string }) => apiRequest("POST", `/api/bookings/${booking.id}/reviews`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", booking.id, "reviews"] });
      toast({ title: "Review saved", description: "Thanks for sharing your feedback." });
      setRating("5");
      setComment("");
      setHoverRating(null);
    },
    onError: (error: Error) => toast({ title: "Could not save review", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  if (booking.status !== "completed" || targets.length === 0) return null;

  const openTargetId = activeTargetId
    ?? targets.find((target) => !reviews.some((review) => review.targetType === target.targetType && review.targetId === target.targetId))?.targetId
    ?? targets[0]?.targetId
    ?? null;
  const completedReviewCount = targets.filter((target) =>
    reviews.some((review) => review.targetType === target.targetType && review.targetId === target.targetId),
  ).length;
  const allTargetsRated = completedReviewCount === targets.length;
  const activeRating = Math.min(5, Math.max(1, hoverRating ?? (Number(rating) || 5)));

  return (
    <div className="mt-4 overflow-hidden rounded-[28px] border border-amber-200/60 bg-[linear-gradient(135deg,rgba(255,251,235,0.92),rgba(255,255,255,0.96),rgba(245,247,250,0.92))] p-5 shadow-[0_22px_50px_-34px_rgba(120,53,15,0.24)]">
      <div className="mb-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700/80">Feedback</div>
          <div className="mt-1 text-lg font-semibold tracking-tight text-stone-950">Reviews</div>
        </div>
        <Badge variant={allTargetsRated ? "secondary" : "outline"} className="rounded-full border-amber-200 bg-white/80">
          {completedReviewCount}/{targets.length} submitted
        </Badge>
      </div>
      <p className="mb-4 text-sm leading-6 text-stone-600">
        Each completed item can be reviewed once.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {targets.map((target) => {
          const existingReview = reviews.find((review) => review.targetType === target.targetType && review.targetId === target.targetId);
          return (
            <Button
              key={target.targetId}
              type="button"
              variant={openTargetId === target.targetId ? "default" : "outline"}
              size="sm"
              className="rounded-full"
              onClick={() => {
                setActiveTargetId(target.targetId);
                setRating("5");
                setComment("");
                setHoverRating(null);
              }}
            >
              {target.label}
              {existingReview ? ` - ${existingReview.rating}/5` : " - pending"}
            </Button>
          );
        })}
      </div>
      {targets.filter((target) => target.targetId === openTargetId).map((target) => {
        const existingReview = reviews.find((review) => review.targetType === target.targetType && review.targetId === target.targetId);
        return (
          <div key={target.targetId} className="space-y-4 rounded-[24px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,252,247,0.92))] p-5 shadow-[0_18px_36px_-30px_rgba(28,25,23,0.2)]">
            {existingReview ? (
              <>
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-stone-950">{target.label}</div>
                    <div className="text-sm text-stone-500">Review saved</div>
                  </div>
                  <div className="flex items-center gap-3 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5">
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Star
                          key={index}
                          className={`h-4 w-4 ${index < existingReview.rating ? "fill-amber-400 text-amber-400" : "text-amber-200"}`}
                        />
                      ))}
                    </div>
                    <span className="text-sm font-medium text-amber-900">{getReviewTone(existingReview.rating)}</span>
                  </div>
                </div>
                <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
                  {existingReview.comment?.trim() ? existingReview.comment : "No comment added."}
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-stone-950">Review {target.label}</div>
                    <div className="mt-1 text-sm text-stone-500">Share what stood out.</div>
                  </div>
                  <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900">
                    {getReviewTone(activeRating)}
                  </div>
                </div>
                <div className="rounded-[22px] border border-amber-100 bg-[linear-gradient(180deg,rgba(255,251,235,0.76),rgba(255,255,255,0.94))] p-4">
                  <div
                    className="flex flex-wrap items-center gap-2"
                    onMouseLeave={() => setHoverRating(null)}
                  >
                    {Array.from({ length: 5 }).map((_, index) => {
                      const value = index + 1;
                      const isActive = value <= activeRating;
                      return (
                        <button
                          key={value}
                          type="button"
                          className={`group rounded-full border px-3 py-2 transition-all duration-200 ${isActive ? "border-amber-300 bg-white shadow-[0_14px_24px_-22px_rgba(180,83,9,0.45)]" : "border-transparent bg-white/70 hover:border-amber-200 hover:bg-white"}`}
                          onMouseEnter={() => setHoverRating(value)}
                          onFocus={() => setHoverRating(value)}
                          onClick={() => {
                            setRating(String(value));
                            setHoverRating(value);
                          }}
                          aria-label={`Rate ${value} star${value === 1 ? "" : "s"}`}
                        >
                          <div className="flex items-center gap-2">
                            <Star className={`h-5 w-5 ${isActive ? "fill-amber-400 text-amber-400" : "text-stone-300 group-hover:text-amber-300"}`} />
                            <span className={`text-sm font-medium ${isActive ? "text-stone-950" : "text-stone-500"}`}>{value}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">Comment</div>
                  <Textarea
                    rows={4}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="What worked well? What should improve?"
                    className="rounded-[20px] border-stone-200 bg-white/90"
                  />
                </div>
                <Button
                  type="button"
                  onClick={() => submitReviewMutation.mutate({
                    targetType: target.targetType,
                    targetId: target.targetId,
                    rating: activeRating,
                    comment: comment.trim(),
                  })}
                  disabled={submitReviewMutation.isPending}
                  className="rounded-full px-6"
                >
                  {submitReviewMutation.isPending ? "Saving..." : "Submit Review"}
                </Button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function readBookingsPageIntent(search: string) {
  const params = new URLSearchParams(search);
  const requestedTab = params.get("tab");
  const activeTab: "overview" | "active" | "history" | "profile" = requestedTab === "active" || requestedTab === "history" || requestedTab === "profile"
    ? requestedTab
    : "active";

  return {
    activeTab,
    bookingId: params.get("bookingId"),
    openThread: params.get("openThread") === "1",
  };
}

export default function Bookings() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { formatAmount } = useCurrency();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [profileForm, setProfileForm] = useState({ firstName: "", lastName: "", phone: "" });
  const pageIntent = useMemo(() => readBookingsPageIntent(search), [search]);
  const [activeTab, setActiveTab] = useState<"overview" | "active" | "history" | "profile">(pageIntent.activeTab);
  const [retryCheckoutBooking, setRetryCheckoutBooking] = useState<Booking | null>(null);
  const [retryPaymentMethod, setRetryPaymentMethod] = useState<CustomerPaymentMethod>("card");
  const [manualMpesaBookingId, setManualMpesaBookingId] = useState<string | null>(null);
  const [manualMpesaCode, setManualMpesaCode] = useState("");
  const [manualMpesaSenderPhone, setManualMpesaSenderPhone] = useState("");
  const [manualMpesaNote, setManualMpesaNote] = useState("");

  useEffect(() => {
    setProfileForm({ firstName: user?.firstName ?? "", lastName: user?.lastName ?? "", phone: user?.phone ?? "" });
  }, [user?.firstName, user?.lastName, user?.phone]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation("/auth?next=/bookings");
    }
  }, [authLoading, isAuthenticated, setLocation]);

  const { data: bookings, isLoading } = useQuery<BookingWithMarketing[]>({ queryKey: ["/api/bookings"], enabled: isAuthenticated });
  const { data: stays } = useQuery<Stay[]>({ queryKey: ["/api/stays"] });
  const { data: cars } = useQuery<CarType[]>({ queryKey: ["/api/cars"] });
  const { data: cooks } = useQuery<Cook[]>({ queryKey: ["/api/cooks"] });
  const { data: errands } = useQuery<Errand[]>({ queryKey: ["/api/errands"] });
  const { data: experiences } = useQuery<Experience[]>({ queryKey: ["/api/experiences"] });

  const updateProfileMutation = useMutation({
    mutationFn: async (payload: typeof profileForm) => apiRequest("PATCH", "/api/auth/user", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Profile updated", description: "Your account details have been saved." });
    },
    onError: (error: Error) => toast({ title: "Could not update profile", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  const startPaymentMutation = useMutation({
    mutationFn: async ({ bookingId, paymentMethod }: { bookingId: string; paymentMethod: CustomerPaymentMethod }) => {
      const response = await apiRequest("POST", `/api/bookings/${bookingId}/payments/session`, { paymentMethod });
      return response.json() as Promise<{ payment?: { redirectUrl?: string | null } | null }>;
    },
    onSuccess: (result) => {
      setRetryCheckoutBooking(null);
      if (result?.payment?.redirectUrl) {
        window.location.assign(result.payment.redirectUrl);
        return;
      }
      toast({
        title: "Secure checkout ready",
        description: "If the checkout does not open, return here and try again.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
    },
    onError: (error: Error) => toast({
      title: "Could not start payment",
      description: error.message.replace(/^\d+:\s*/, ""),
      variant: "destructive",
    }),
  });

  const manualMpesaMutation = useMutation({
    mutationFn: async ({
      bookingId,
      transactionCode,
      senderPhone,
      note,
    }: {
      bookingId: string;
      transactionCode: string;
      senderPhone?: string;
      note?: string;
    }) => {
      const response = await apiRequest("POST", `/api/bookings/${bookingId}/payments/manual-mpesa`, {
        transactionCode,
        senderPhone,
        note,
      });
      return {
        bookingId,
        booking: await response.json() as Booking,
      };
    },
    onSuccess: ({ bookingId }) => {
      setManualMpesaBookingId(null);
      setManualMpesaCode("");
      setManualMpesaSenderPhone("");
      setManualMpesaNote("");
      toast({
        title: "M-Pesa payment submitted",
        description: "We have received the transaction code and will confirm this payment shortly.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", bookingId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
    onError: (error: Error) => toast({
      title: "Could not submit M-Pesa payment",
      description: error.message.replace(/^\d+:\s*/, ""),
      variant: "destructive",
    }),
  });

  const sortedBookings = useMemo(() => [...(bookings ?? [])].sort((a, b) => a.checkIn.localeCompare(b.checkIn)), [bookings]);
  const activeBookings = useMemo(() => sortedBookings.filter((booking) => !isHistoryBookingStatus(booking.status)), [sortedBookings]);
  const historyBookings = useMemo(
    () => sortedBookings.filter((booking) => isHistoryBookingStatus(booking.status)).sort((a, b) => b.checkIn.localeCompare(a.checkIn)),
    [sortedBookings],
  );

  const openRetryCheckout = (booking: Booking) => {
    setRetryCheckoutBooking(booking);
    setRetryPaymentMethod(getPaymentChoiceForProvider(booking.paymentProvider));
  };

  const openManualMpesaForm = (booking: Booking) => {
    setManualMpesaBookingId(booking.id);
    setManualMpesaCode("");
    setManualMpesaSenderPhone(user?.phone ?? "");
    setManualMpesaNote("");
  };

  const downloadReceipt = (booking: BookingWithMarketing) => {
    const amountPaid = getBookingAmountPaid(booking);
    if (amountPaid <= 0 || typeof window === "undefined") {
      toast({
        title: "Receipt not ready",
        description: "A downloadable receipt appears after a payment has been recorded.",
        variant: "destructive",
      });
      return;
    }

    const bookingReference = booking.id.slice(0, 8).toUpperCase();
    const receiptUrl = `/api/bookings/${encodeURIComponent(booking.id)}/receipt`;
    const link = document.createElement("a");
    link.href = receiptUrl;
    link.download = `tembea-bila-matata-receipt-${bookingReference}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  useEffect(() => {
    if (!pageIntent.bookingId) {
      setActiveTab(pageIntent.activeTab);
      return;
    }

    const matchedBooking = sortedBookings.find((booking) => booking.id === pageIntent.bookingId);
    if (!matchedBooking) {
      return;
    }

    const targetTab = isHistoryBookingStatus(matchedBooking.status) ? "history" : "active";
    setActiveTab(targetTab);

    if (typeof window === "undefined") {
      return;
    }

    const timer = window.setTimeout(() => {
      document.getElementById(`booking-card-${pageIntent.bookingId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 140);

    return () => window.clearTimeout(timer);
  }, [pageIntent.activeTab, pageIntent.bookingId, sortedBookings]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(search);
    const paymentResult = params.get("payment");
    if (!paymentResult) {
      return;
    }

    if (paymentResult === "success") {
      toast({ title: "Payment confirmed", description: "Your booking payment was received and the booking has been updated." });
    } else if (paymentResult === "pending") {
      toast({ title: "Payment still processing", description: "We are still waiting for the gateway to confirm this payment." });
    } else if (paymentResult === "cancelled") {
      toast({ title: "Checkout cancelled", description: "You can restart payment from this booking any time." });
    } else {
      toast({ title: "Payment not completed", description: "Retry with Paystack or Pesapal when you are ready.", variant: "destructive" });
    }

    params.delete("payment");
    const nextSearch = params.toString();
    window.history.replaceState({}, "", nextSearch ? `/bookings?${nextSearch}` : "/bookings");
  }, [search, toast]);

  const getStay = (id: string | null) => (!id ? null : stays?.find((stay) => stay.id === id));
  const getServiceItem = (id: string) => cars?.find((item) => item.id === id) || cooks?.find((item) => item.id === id) || errands?.find((item) => item.id === id) || experiences?.find((item) => item.id === id);
  const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const formatTime = (timeString?: string | null) => !timeString ? null : new Date(`2000-01-01T${timeString}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const getStatusBadge = (status: string) => status === "upcoming"
    ? <Badge>Upcoming</Badge>
    : status === "in-progress"
      ? <Badge className="bg-green-600">In progress</Badge>
      : status === "pending-payment"
        ? <Badge className="bg-amber-600">Pending Payment</Badge>
        : status === "pending"
          ? <Badge className="bg-amber-600">Pending</Badge>
      : status === "completed"
        ? <Badge variant="secondary">Completed</Badge>
        : status === "late"
          ? <Badge className="bg-amber-600">Needs attention</Badge>
          : status === "cancelled"
            ? <Badge variant="outline">Cancelled</Badge>
            : <Badge variant="outline">{status}</Badge>;
  const getStageState = (booking: Booking, stage: "booked" | "offer" | "active" | "completed") => {
    if (stage === "booked") return true;
    if (stage === "offer") return booking.serviceMode === "cook-custom-menu" || booking.serviceMode === "experience-custom-offer";
    if (stage === "active") return booking.status === "in-progress" || booking.status === "late";
    if (stage === "completed") return booking.status === "completed";
    return false;
  };
  const getCustomMenuFee = (booking: Booking) => (
    booking.serviceRequestFee
    || (booking.serviceRequestFeeKes ? Math.max(1, Math.ceil((booking.serviceRequestFeeKes ?? 0) / 130)) : 0)
    || (booking.serviceMode === "experience-custom-offer" ? customServiceRequestFeeUsd : 0)
  );
  const getCustomMenuBalanceDue = (booking: Booking) => Math.max(0, (booking.customMenuProposedAmount ?? 0) - getCustomMenuFee(booking));
  const getExperienceBalanceDue = (booking: Booking) => Math.max(0, (booking.experienceCustomOfferAmount ?? 0) - getCustomMenuFee(booking));
  const getCustomRequestLabel = (booking: Booking) => booking.serviceMode === "cook-custom-menu"
    ? "Custom Menu"
    : booking.selectedServices.length === 0
      ? "Custom Service"
      : "Custom Experience";
  const getCustomMenuBadgeLabel = (booking: Booking) => {
    if (isHistoryBookingStatus(booking.status)) return booking.status === "cancelled" ? "Cancelled" : "Completed";
    if (booking.customMenuClientDecision === "accepted") return "Accepted";
    if (booking.customMenuClientDecision === "declined" || booking.customMenuProposalStatus === "declined") return "Declined";
    if (booking.customMenuProposalStatus === "proposed") return "Ready";
    if (booking.customMenuProposalStatus === "pending-admin-approval") return "Review";
    return "Pending";
  };
  const getCustomMenuStatusText = (booking: Booking) => {
    if (isHistoryBookingStatus(booking.status)) {
      return booking.status === "cancelled"
        ? "Booking cancelled by admin. Quote actions are locked."
        : "Booking completed by admin. Quote actions are locked.";
    }
    if (booking.customMenuClientDecision === "accepted") return "Quote accepted.";
    if (booking.customMenuClientDecision === "declined") return "Quote declined.";
    if (booking.customMenuProposalStatus === "declined") return "Request declined.";
    if (booking.customMenuProposalStatus === "proposed") return "Ready for your approval.";
    if (booking.customMenuProposalStatus === "pending-admin-approval") return "Under review.";
    return "Waiting for quote.";
  };
  const customMenuReady = (booking: Booking) =>
    !isHistoryBookingStatus(booking.status)
    && booking.serviceMode === "cook-custom-menu"
    && booking.customMenuProposalStatus === "proposed"
    && booking.customMenuClientDecision === "pending";
  const experienceOfferReady = (booking: Booking) =>
    !isHistoryBookingStatus(booking.status)
    && booking.serviceMode === "experience-custom-offer"
    && booking.experienceCustomOfferStatus === "proposed"
    && booking.experienceCustomOfferClientDecision === "pending";
  const getExperienceOfferBadgeLabel = (booking: Booking) => {
    if (isHistoryBookingStatus(booking.status)) return booking.status === "cancelled" ? "Cancelled" : "Completed";
    if (booking.experienceCustomOfferClientDecision === "accepted") return "Accepted";
    if (booking.experienceCustomOfferClientDecision === "declined" || booking.experienceCustomOfferStatus === "declined") return "Declined";
    if (booking.experienceCustomOfferStatus === "proposed") return "Ready";
    if (booking.experienceCustomOfferStatus === "pending-admin-approval") return "Reviewing";
    return "Pending";
  };
  const getExperienceOfferStatusText = (booking: Booking) => {
    if (isHistoryBookingStatus(booking.status)) {
      return booking.status === "cancelled"
        ? "Booking cancelled by admin. Offer actions are locked."
        : "Booking completed by admin. Offer actions are locked.";
    }
    if (booking.experienceCustomOfferClientDecision === "accepted") return "Offer accepted.";
    if (booking.experienceCustomOfferClientDecision === "declined") return "Offer declined.";
    if (booking.experienceCustomOfferStatus === "declined") return "Request declined.";
    if (booking.experienceCustomOfferStatus === "proposed") return "Offer ready.";
    if (booking.experienceCustomOfferStatus === "pending-admin-approval") return "Under review.";
    return "Waiting for an offer.";
  };

  const customMenuDecisionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "accept" | "decline" }) => apiRequest("PATCH", `/api/bookings/${id}/custom-menu-decision`, { action }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      toast({
        title: variables.action === "accept" ? "Chef quote accepted" : "Chef quote declined",
        description: variables.action === "accept" ? "Your balance is now ready below. Complete payment to lock it in." : "The quote has been closed.",
      });
    },
    onError: (error: Error) => toast({ title: "Could not update quote", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  const experienceOfferDecisionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "accept" | "decline" }) => apiRequest("PATCH", `/api/bookings/${id}/experience-custom-offer-decision`, { action }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      toast({
        title: variables.action === "accept" ? "Offer accepted" : "Offer declined",
        description: variables.action === "accept" ? "Your balance is ready below. Complete payment to confirm the experience." : "The offer has been closed.",
      });
    },
    onError: (error: Error) => toast({ title: "Could not update offer", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  const getReviewTargets = (booking: Booking): ReviewTarget[] => {
    const targets: ReviewTarget[] = [];
    if (booking.accommodationId) {
      const stay = getStay(booking.accommodationId);
      if (stay) targets.push({ targetType: "stay", targetId: stay.id, label: stay.title });
    }
    booking.selectedServices.forEach((serviceId) => {
      const service = getServiceItem(serviceId);
      if (!service) return;
      if ("model" in service) targets.push({ targetType: "car", targetId: service.id, label: service.model });
      else if ("speciality" in service) targets.push({ targetType: "cook", targetId: service.id, label: service.title });
      else if ("experienceType" in service) targets.push({ targetType: "experience", targetId: service.id, label: service.title });
      else targets.push({ targetType: "errand", targetId: service.id, label: service.serviceName });
    });
    return targets;
  };
  const attentionBookingsCount = useMemo(
    () => sortedBookings.filter((booking) =>
      booking.status === "late"
      || canRetryBookingPayment(booking)
      || customMenuReady(booking)
      || experienceOfferReady(booking),
    ).length,
    [sortedBookings],
  );

  const renderBookingCard = (booking: BookingWithMarketing) => {
    const stay = getStay(booking.accommodationId);
    const primaryService = booking.selectedServices[0] ? getServiceItem(booking.selectedServices[0]) : null;
    const serviceTitle = !primaryService ? "Service Booking" : "model" in primaryService ? primaryService.model : "title" in primaryService ? primaryService.title : primaryService.serviceName;
    const bookingTitle = stay?.title ?? serviceTitle;
    const bookingType = stay ? "Stay" : "Service";
    const bookingLocation = stay?.location ?? booking.serviceLocation ?? booking.servicePickupLocation ?? booking.serviceReturnLocation ?? null;
    const bookingDates = formatTimelineDateRange(booking.checkIn, booking.checkOut);
    const checkoutAmountDue = getBookingCheckoutAmount(booking);
    const amountPaid = getBookingAmountPaid(booking);
    const outstandingAmount = getBookingOutstandingAmount(booking);
    const fullPaymentOnlyBooking = isFullPaymentOnlyBooking(booking);
    const hasDepositRule = hasBookingDepositRequirement(booking);
    const bookingStatusText = getBookingStatusLabel(booking.status);
    const serviceLabels = booking.selectedServices
      .map((serviceId) => {
        const service = getServiceItem(serviceId);
        if (!service) return null;
        return "model" in service ? service.model : "title" in service ? service.title : service.serviceName;
      })
      .filter((label): label is string => !!label);
    const isCustomFlow = booking.serviceMode === "cook-custom-menu" || booking.serviceMode === "experience-custom-offer";
    const showStandaloneRequestBrief = Boolean(booking.serviceRequestDetails?.trim()) && !isCustomFlow;
    const summaryLine = serviceLabels.length > 0
      ? `${serviceLabels.slice(0, 2).join(" / ")}${serviceLabels.length > 2 ? ` / +${serviceLabels.length - 2} more` : ""}`
      : stay
        ? "Accommodation only"
        : "Direct service booking";
    const manualMpesaPending = booking.paymentProvider === "mpesa-manual" && booking.paymentStatus === "processing";
    const renderHero = (className?: string) =>
      stay ? (
        <ListingMedia
          src={stay.imageUrl || "/placeholder-image.jpg"}
          alt={stay.title}
          mediaType={stay.mediaType}
          className={cn("h-full w-full object-cover", className)}
        />
      ) : (
        <div className={cn("flex h-full items-center justify-center bg-[linear-gradient(135deg,rgba(15,23,42,0.08),rgba(13,148,136,0.18))] text-primary", className)}>
          {!primaryService || "model" in primaryService ? <Car className="h-8 w-8" /> : "speciality" in primaryService ? <ChefHat className="h-8 w-8" /> : "experienceType" in primaryService ? <Compass className="h-8 w-8" /> : <ShoppingBag className="h-8 w-8" />}
        </div>
      );

    return (
      <AccordionItem
        key={booking.id}
        id={`booking-card-${booking.id}`}
        value={booking.id}
        className={cn(
          "overflow-hidden rounded-[28px] border border-border/60 shadow-[0_22px_50px_-34px_rgba(15,23,42,0.45)] transition-all duration-300 data-[state=open]:shadow-[0_28px_58px_-34px_rgba(15,23,42,0.52)]",
          isHistoryBookingStatus(booking.status)
            ? "bg-[linear-gradient(180deg,rgba(250,250,249,0.98),rgba(244,244,245,0.92))]"
            : "bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,248,250,0.92))]",
        )}
        data-testid={`booking-${booking.id}`}
      >
        <AccordionTrigger className="items-start gap-3 px-4 py-4 text-left hover:no-underline sm:gap-4 sm:px-5 sm:py-4 lg:px-6">
          <div className="flex min-w-0 flex-1 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3 sm:gap-4">
              <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-[20px] border border-black/5 bg-stone-950 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.45)] sm:h-28 sm:w-36 sm:rounded-[22px]">
                {renderHero()}
                {stay ? <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(12,10,9,0.04),rgba(12,10,9,0.42))]" /> : null}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {getStatusBadge(booking.status)}
                  <Badge variant={isBookingPaid(booking) ? "secondary" : "outline"} className="rounded-full">
                    {getBookingPaymentStatusLabel(booking)}
                  </Badge>
                  {booking.serviceMode === "cook-custom-menu" ? <Badge variant="outline" className="rounded-full">Chef quote</Badge> : null}
                  {booking.serviceMode === "experience-custom-offer" ? <Badge variant="outline" className="rounded-full">Custom offer</Badge> : null}
                  {booking.marketingAttribution ? (
                    <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-800">
                      Promo applied
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">{bookingType}</div>
                <h3 className="mt-1 text-base font-semibold leading-snug tracking-tight text-foreground sm:text-xl">{bookingTitle}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1"><Calendar className="h-4 w-4" />{bookingDates}</span>
                  {bookingLocation ? <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{bookingLocation}</span> : null}
                  <span className="flex items-center gap-1"><Users className="h-4 w-4" />{booking.guests} guest{booking.guests === 1 ? "" : "s"}</span>
                </div>
                <div className="mt-3 text-sm text-muted-foreground">{summaryLine}</div>
              </div>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-3 rounded-[20px] border border-white/70 bg-white/75 px-4 py-3 text-left shadow-[0_16px_30px_-24px_rgba(15,23,42,0.34)] sm:rounded-[22px] lg:min-w-[190px] lg:w-auto lg:items-end lg:text-right">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{getBookingDueLabel(booking)}</div>
                {booking.marketingAttribution ? (
                  <div className="mt-1 text-xs text-muted-foreground line-through">
                    {formatAmount(booking.marketingAttribution.originalSubtotal)}
                  </div>
                ) : null}
                <div className="mt-1 text-xl font-semibold tracking-tight text-foreground">
                  {formatAmount(isBookingPaid(booking) ? booking.totalPrice : checkoutAmountDue)}
                </div>
                {!isBookingPaid(booking) && checkoutAmountDue !== booking.totalPrice ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Booking total {formatAmount(booking.totalPrice)}
                  </div>
                ) : null}
                {booking.marketingAttribution ? (
                  <div className="mt-1 text-xs font-medium text-emerald-700">
                    Saved {formatAmount(booking.marketingAttribution.discountAmount)} with {getBookingPromoLabel(booking)}
                  </div>
                ) : null}
              </div>
              <div className="space-y-1 text-sm">
                <div className="font-medium text-foreground">{bookingStatusText}</div>
                <div className="text-muted-foreground">{getBookingPaymentStatusLabel(booking)}</div>
                <div className="text-muted-foreground">Booking ID {booking.id.slice(0, 8).toUpperCase()}</div>
                <div className="text-xs text-muted-foreground">Open details</div>
              </div>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-6 pt-0 sm:px-5 lg:px-6">
          <div className="border-t border-border/60 pt-6">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">

            <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[24px] border border-border/60 bg-background/85 p-5 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.3)]">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Overview</div>
                <div className="flex flex-wrap gap-2">
                  {getStatusBadge(booking.status)}
                  <Badge variant={getStageState(booking, "booked") ? "default" : "outline"} className="rounded-full">Booked</Badge>
                  {(booking.serviceMode === "cook-custom-menu" || booking.serviceMode === "experience-custom-offer") ? (
                    <Badge variant={getStageState(booking, "offer") ? "secondary" : "outline"} className="rounded-full">Offer</Badge>
                  ) : null}
                  <Badge variant={getStageState(booking, "active") ? "default" : "outline"} className={`rounded-full ${getStageState(booking, "active") ? "bg-green-600" : ""}`}>Active</Badge>
                  <Badge variant={getStageState(booking, "completed") ? "secondary" : "outline"} className="rounded-full">Complete</Badge>
                </div>
                {primaryService && !stay ? <div className="mt-4 rounded-[20px] bg-muted/40 p-4 text-sm text-muted-foreground">{primaryService.description}</div> : null}
                {serviceLabels.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {serviceLabels.map((label) => (
                      <Badge key={label} variant="secondary" className="rounded-full">{label}</Badge>
                    ))}
                  </div>
                ) : null}
                <div className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                  <div className="flex items-center gap-2 rounded-2xl bg-muted/35 px-4 py-3">
                    <Calendar className="h-4 w-4 text-primary" />
                    <span>{bookingDates}</span>
                  </div>
                  {bookingLocation ? (
                    <div className="flex items-center gap-2 rounded-2xl bg-muted/35 px-4 py-3">
                      <MapPin className="h-4 w-4 text-primary" />
                      <span>{bookingLocation}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-[24px] border border-border/60 bg-background/85 p-5 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.3)]">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Schedule</div>
                {getBookingScheduleSlots(booking).length > 0 ? (
                  <div className="space-y-2 text-sm text-muted-foreground">
                    {getBookingScheduleSlots(booking).map((slot, index) => <div key={`${slot.date}-${index}`}>{formatDate(slot.date)}{slot.note?.trim() ? ` - ${slot.note.trim()}` : ""}</div>)}
                  </div>
                ) : (
                  <div className="grid gap-3 text-sm text-muted-foreground">
                    <div className="flex flex-col gap-1 rounded-2xl bg-muted/35 px-4 py-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                      <span>Check-in</span>
                      <span className="font-medium text-foreground">{formatDate(booking.checkIn)}</span>
                    </div>
                    <div className="flex flex-col gap-1 rounded-2xl bg-muted/35 px-4 py-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                      <span>Check-out</span>
                      <span className="font-medium text-foreground">{formatDate(booking.checkOut)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {booking.serviceMode === "cook-custom-menu" ? (
              <div className="rounded-[24px] border border-amber-200/80 bg-[linear-gradient(180deg,rgba(255,251,235,0.96),rgba(255,247,219,0.92))] p-5 shadow-[0_18px_38px_-30px_rgba(146,64,14,0.32)]">
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-amber-900">Chef quote</div>
                    <div className="text-sm text-amber-800">{getCustomMenuStatusText(booking)}</div>
                  </div>
                  <Badge variant="outline" className="rounded-full border-amber-300 bg-white text-amber-900">
                    {getCustomMenuBadgeLabel(booking)}
                  </Badge>
                </div>
                {booking.serviceRequestDetails ? (
                  <RequestBriefAccordion
                    id={`guest-cook-brief-${booking.id}`}
                    title={`Chef request #${booking.id.slice(0, 8).toUpperCase()}`}
                    summary={getRequestPreview(booking.serviceRequestDetails)}
                    content={booking.serviceRequestDetails}
                    accent="amber"
                    className="mt-4 bg-white/70"
                  />
                ) : null}
                {booking.customMenuProposalStatus === "proposed" && booking.customMenuProposedAmount ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl bg-white p-3 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)]">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Quote</div>
                      <div className="mt-1 font-semibold">{formatAmount(booking.customMenuProposedAmount)}</div>
                    </div>
                    <div className="rounded-2xl bg-white p-3 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)]">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Fee credit</div>
                      <div className="mt-1 font-semibold">-{formatAmount(getCustomMenuFee(booking))}</div>
                    </div>
                    <div className="rounded-2xl bg-white p-3 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)]">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Balance</div>
                      <div className="mt-1 font-semibold">{formatAmount(getCustomMenuBalanceDue(booking))}</div>
                    </div>
                  </div>
                ) : null}
                {booking.customMenuProposalMessage ? <div className="mt-3 rounded-2xl bg-white p-4 text-sm text-muted-foreground shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)]">{booking.customMenuProposalMessage}</div> : null}
                {customMenuReady(booking) ? (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Button size="sm" className="w-full sm:w-auto" disabled={customMenuDecisionMutation.isPending} onClick={() => customMenuDecisionMutation.mutate({ id: booking.id, action: "accept" })}>
                      {customMenuDecisionMutation.isPending ? "Updating..." : "Accept quote"}
                    </Button>
                    <Button size="sm" variant="outline" className="w-full sm:w-auto" disabled={customMenuDecisionMutation.isPending} onClick={() => customMenuDecisionMutation.mutate({ id: booking.id, action: "decline" })}>
                      Decline
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {booking.serviceMode === "experience-custom-offer" ? (
              <div className="rounded-[24px] border border-sky-200/80 bg-[linear-gradient(180deg,rgba(240,249,255,0.97),rgba(224,242,254,0.9))] p-5 shadow-[0_18px_38px_-30px_rgba(3,105,161,0.28)]">
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-sky-950">Custom offer</div>
                    <div className="text-sm text-sky-900">{getExperienceOfferStatusText(booking)}</div>
                  </div>
                  <Badge variant="outline" className="rounded-full border-sky-300 bg-white text-sky-950">
                    {getExperienceOfferBadgeLabel(booking)}
                  </Badge>
                </div>
                {booking.serviceRequestDetails ? (
                  <RequestBriefAccordion
                    id={`guest-experience-brief-${booking.id}`}
                    title={`Request #${booking.id.slice(0, 8).toUpperCase()}`}
                    summary={getRequestPreview(booking.serviceRequestDetails)}
                    content={booking.serviceRequestDetails}
                    accent="sky"
                    className="mt-4 bg-white/70"
                  />
                ) : null}
                {booking.experienceCustomOfferStatus === "proposed" && booking.experienceCustomOfferAmount ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl bg-white p-3 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)]">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Offer</div>
                      <div className="mt-1 font-semibold">{formatAmount(booking.experienceCustomOfferAmount)}</div>
                    </div>
                    <div className="rounded-2xl bg-white p-3 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)]">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Fee credit</div>
                      <div className="mt-1 font-semibold">-{formatAmount(getCustomMenuFee(booking))}</div>
                    </div>
                    <div className="rounded-2xl bg-white p-3 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)]">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Balance</div>
                      <div className="mt-1 font-semibold">{formatAmount(getExperienceBalanceDue(booking))}</div>
                    </div>
                  </div>
                ) : null}
                {booking.experienceCustomOfferMessage ? (
                  <div className="mt-3 rounded-2xl border border-sky-100 bg-white p-4 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)]">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-sky-700">Note</div>
                    <div className="mt-2 text-sm text-muted-foreground">{booking.experienceCustomOfferMessage}</div>
                  </div>
                ) : null}
                {experienceOfferReady(booking) ? (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Button size="sm" className="w-full sm:w-auto" disabled={experienceOfferDecisionMutation.isPending} onClick={() => experienceOfferDecisionMutation.mutate({ id: booking.id, action: "accept" })}>
                      {experienceOfferDecisionMutation.isPending ? "Updating..." : "Accept offer"}
                    </Button>
                    <Button size="sm" variant="outline" className="w-full sm:w-auto" disabled={experienceOfferDecisionMutation.isPending} onClick={() => experienceOfferDecisionMutation.mutate({ id: booking.id, action: "decline" })}>
                      Decline
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {showStandaloneRequestBrief ? (
              <RequestBriefAccordion
                id={`guest-request-${booking.id}`}
                title={`Booking request #${booking.id.slice(0, 8).toUpperCase()}`}
                summary={getRequestPreview(booking.serviceRequestDetails)}
                content={booking.serviceRequestDetails ?? ""}
                accent="stone"
                className="bg-background/85"
              />
            ) : null}
            <BookingTimeline booking={booking} />
            <BookingServiceDetails
              booking={booking}
              getServiceById={(serviceId) => getServiceItem(serviceId) || null}
              formatAmount={formatAmount}
              formatTime={formatTime}
              hideRequestDetails={showStandaloneRequestBrief || isCustomFlow}
            />
            <BookingThread
              bookingId={booking.id}
              title="Messages"
              initialMessage={showStandaloneRequestBrief || isCustomFlow ? null : booking.serviceRequestDetails}
              initialMessageLabel={getBookingThreadInitialLabel(booking)}
              composerPlaceholder="Send a message..."
              defaultOpen={pageIntent.openThread && pageIntent.bookingId === booking.id}
            />
          </div>
          <div className="space-y-4">
            <div className="rounded-[28px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,252,247,0.98),rgba(247,243,236,0.92))] p-5 shadow-[0_18px_40px_-30px_rgba(28,25,23,0.32)]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">Next step</div>
                <div className="mt-2 text-sm font-medium text-stone-900">{bookingStatusText}</div>
                <div className="mt-1 text-sm text-stone-600">
                  {canRetryBookingPayment(booking)
                    ? "Finish payment from here whenever you're ready."
                    : isHistoryBookingStatus(booking.status)
                      ? "This booking is closed, but the record and messages stay available."
                      : "Everything tied to this booking stays organized here."}
                </div>
                <div className="mt-4">
                  <div className="mb-1 text-xs uppercase tracking-[0.16em] text-stone-500">{getBookingDueLabel(booking)}</div>
                  {booking.marketingAttribution ? (
                    <div className="mb-2 text-sm text-stone-500 line-through">
                      {formatAmount(booking.marketingAttribution.originalSubtotal)}
                    </div>
                  ) : null}
                  <CurrencyAmount
                    amountUsd={isBookingPaid(booking) ? booking.totalPrice : checkoutAmountDue}
                    variant="stacked"
                    primaryClassName="text-3xl font-semibold tracking-tight text-stone-900"
                    secondaryClassName="text-sm text-stone-500"
                  />
                </div>
                <div className="mt-5 space-y-3 text-sm">
                  {booking.marketingAttribution ? (
                    <>
                      <div className="flex flex-col gap-1 rounded-2xl bg-emerald-50 px-4 py-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                        <span className="text-emerald-800">Promo</span>
                        <span className="font-medium text-emerald-950">
                          {getBookingPromoLabel(booking)}
                          {booking.marketingAttribution.promoCode ? ` (${booking.marketingAttribution.promoCode})` : ""}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1 rounded-2xl bg-emerald-50 px-4 py-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                        <span className="text-emerald-800">You saved</span>
                        <span className="font-medium text-emerald-950">{formatAmount(booking.marketingAttribution.discountAmount)}</span>
                      </div>
                    </>
                  ) : null}
                  <div className="flex flex-col gap-1 rounded-2xl bg-white/80 px-4 py-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                    <span className="text-stone-500">Booking ID</span>
                    <span className="font-medium text-stone-900">{booking.id.slice(0, 8)}</span>
                </div>
                  <div className="flex flex-col gap-1 rounded-2xl bg-white/80 px-4 py-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                    <span className="text-stone-500">Payment</span>
                    <span className="font-medium text-stone-900">{getBookingPaymentStatusLabel(booking)}</span>
                </div>
                {!isBookingPaid(booking) ? (
                  <div className="flex flex-col gap-1 rounded-2xl bg-white/80 px-4 py-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                    <span className="text-stone-500">Booking total</span>
                    <span className="font-medium text-stone-900">{formatAmount(booking.totalPrice)}</span>
                  </div>
                ) : null}
                {amountPaid > 0 && !isBookingPaid(booking) ? (
                  <div className="flex flex-col gap-1 rounded-2xl bg-white/80 px-4 py-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                    <span className="text-stone-500">Already paid</span>
                    <span className="font-medium text-stone-900">{formatAmount(amountPaid)}</span>
                  </div>
                ) : null}
                {outstandingAmount > 0 && !isBookingPaid(booking) ? (
                  <div className="flex flex-col gap-1 rounded-2xl bg-white/80 px-4 py-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                    <span className="text-stone-500">Still outstanding</span>
                    <span className="font-medium text-stone-900">{formatAmount(outstandingAmount)}</span>
                  </div>
                ) : null}
                <div className="flex flex-col gap-1 rounded-2xl bg-white/80 px-4 py-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                  <span className="text-stone-500">Guests</span>
                  <span className="font-medium text-stone-900">{booking.guests}</span>
                </div>
              </div>
            </div>
            {canRetryBookingPayment(booking) ? (
              <div className="rounded-[24px] border border-amber-200/70 bg-[linear-gradient(180deg,rgba(255,251,235,0.96),rgba(255,255,255,0.95))] p-4 shadow-[0_16px_36px_-30px_rgba(146,64,14,0.24)]">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700">Payment</div>
                <div className="text-sm leading-6 text-stone-700">
                  {manualMpesaPending
                    ? "We have your temporary M-Pesa submission and are confirming it now. If you need to, you can still reopen secure checkout below."
                    : hasLockedInBookingDeposit(booking)
                    ? booking.paymentStatus === "failed"
                      ? "Your deposit is safe, but the remaining balance payment did not complete. Reopen checkout to finish it."
                      : booking.paymentStatus === "cancelled"
                        ? "Your dates are still locked by the deposit. Reopen checkout when you're ready to pay the remaining balance."
                        : `Your dates are locked. Pay the remaining ${formatAmount(outstandingAmount)} when you're ready.`
                    : booking.paymentStatus === "failed"
                      ? fullPaymentOnlyBooking
                        ? "The last checkout did not complete. Reopen it to pay the full amount."
                        : "The last checkout did not complete. Reopen checkout and choose the payment method there."
                      : booking.paymentStatus === "cancelled"
                        ? fullPaymentOnlyBooking
                          ? "Checkout was cancelled. Reopen it whenever you're ready to pay the full amount."
                          : "Checkout was cancelled. You can restart it here in a cleaner payment flow."
                        : hasDepositRule
                          ? `Pay the deposit of ${formatAmount(checkoutAmountDue)} now to lock these dates.`
                          : fullPaymentOnlyBooking
                            ? amountPaid > 0
                              ? `You still have ${formatAmount(outstandingAmount)} left to settle in full.`
                              : "This booking moves forward on full payment. Open checkout whenever you're ready."
                            : "This booking is saved. Open payment whenever you're ready."}
                </div>
                <CheckoutPaymentPreview
                  className="mt-4 bg-white/90 shadow-none"
                  title={manualMpesaPending
                    ? "Manual M-Pesa under review"
                    : hasLockedInBookingDeposit(booking)
                    ? "Pay the remaining balance"
                    : fullPaymentOnlyBooking
                      ? amountPaid > 0
                        ? "Pay remaining balance"
                        : "Pay in full"
                      : hasDepositRule
                      ? "Pay deposit to lock dates"
                      : "Open payment when you're ready"}
                  description={manualMpesaPending
                    ? "Your temporary send-money payment has been submitted. Secure checkout is still available if you need it."
                    : hasLockedInBookingDeposit(booking)
                    ? "Choose your payment method and finish the outstanding balance."
                    : fullPaymentOnlyBooking
                      ? amountPaid > 0
                        ? "Choose your payment method and settle the remaining balance."
                        : "Choose your payment method and settle the full amount in one step."
                      : hasDepositRule
                      ? "Choose your payment method and pay the deposit first."
                      : "Choose your payment method whenever you're ready to continue."}
                />
                <Button
                  className="mt-4 w-full"
                  disabled={startPaymentMutation.isPending}
                  onClick={() => openRetryCheckout(booking)}
                >
                  {manualMpesaPending
                    ? "Open secure payment options"
                    : hasLockedInBookingDeposit(booking)
                    ? "Pay remaining balance"
                    : fullPaymentOnlyBooking
                      ? amountPaid > 0
                        ? "Pay remaining balance"
                        : "Pay in full"
                      : hasDepositRule
                      ? "Pay deposit"
                      : "Open payment options"}
                </Button>
                <Button
                  variant="outline"
                  className="mt-3 w-full"
                  disabled={manualMpesaMutation.isPending}
                  onClick={() => manualMpesaBookingId === booking.id ? setManualMpesaBookingId(null) : openManualMpesaForm(booking)}
                >
                  <Smartphone className="mr-2 h-4 w-4" />
                  {manualMpesaBookingId === booking.id ? "Hide temporary M-Pesa" : "Temporary M-Pesa send money"}
                </Button>
                {manualMpesaBookingId === booking.id ? (
                  <div className="mt-4 rounded-[22px] border border-emerald-200 bg-emerald-50/80 p-4">
                    <div className="text-sm font-semibold text-emerald-950">Temporary M-Pesa instructions</div>
                    <div className="mt-2 text-sm leading-6 text-emerald-900">
                      Send <span className="font-semibold">{formatAmount(checkoutAmountDue)}</span> to <span className="font-semibold">{TEMP_MPESA_SEND_MONEY_NUMBER}</span>, then submit the M-Pesa code below for confirmation.
                    </div>
                    <div className="mt-4 space-y-3">
                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">M-Pesa code</div>
                        <Input
                          value={manualMpesaCode}
                          onChange={(event) => setManualMpesaCode(event.target.value.toUpperCase())}
                          placeholder="e.g. QJD7X8Y9Z"
                          className="bg-white"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Sender phone</div>
                        <Input
                          value={manualMpesaSenderPhone}
                          onChange={(event) => setManualMpesaSenderPhone(event.target.value)}
                          placeholder="e.g. 0718475264"
                          className="bg-white"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Note</div>
                        <Textarea
                          rows={3}
                          value={manualMpesaNote}
                          onChange={(event) => setManualMpesaNote(event.target.value)}
                          placeholder="Optional note for the team"
                          className="bg-white"
                        />
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          className="w-full sm:flex-1"
                          disabled={manualMpesaMutation.isPending}
                          onClick={() => manualMpesaMutation.mutate({
                            bookingId: booking.id,
                            transactionCode: manualMpesaCode.trim(),
                            senderPhone: manualMpesaSenderPhone.trim(),
                            note: manualMpesaNote.trim(),
                          })}
                        >
                          {manualMpesaMutation.isPending ? "Submitting..." : "I've sent the money"}
                        </Button>
                        <Button
                          variant="ghost"
                          className="w-full sm:w-auto"
                          disabled={manualMpesaMutation.isPending}
                          onClick={() => setManualMpesaBookingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="rounded-[24px] border border-border/60 bg-background/85 p-4 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.3)]">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Links</div>
              <div className="space-y-3">
                {booking.accommodationId ? <Button variant="outline" className="w-full rounded-full" onClick={() => setLocation(`/accommodation/${booking.accommodationId}`)}>View stay</Button> : null}
                {amountPaid > 0 ? (
                  <Button variant="outline" className="w-full rounded-full" onClick={() => downloadReceipt(booking)}>
                    <Download className="mr-2 h-4 w-4" />
                    Download receipt
                  </Button>
                ) : null}
              </div>
            </div>
            </div>
            <BookingReviewSection booking={booking} targets={getReviewTargets(booking)} />
          </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    );
  };

  const renderBookingsList = (items: BookingWithMarketing[], emptyTitle: string, emptyDescription: string) => items.length ? (
    <div className="space-y-3">
      <div className="rounded-[22px] border border-border/60 bg-white/75 px-4 py-3 text-sm text-muted-foreground shadow-[0_16px_36px_-30px_rgba(15,23,42,0.24)]">
        Open one booking at a time to check payment, messages, and the next step without the page feeling crowded.
      </div>
      <Accordion
        key={`${pageIntent.bookingId ?? "default"}-${items[0]?.id ?? "empty"}`}
        type="single"
        collapsible
        defaultValue={
          pageIntent.bookingId && items.some((booking) => booking.id === pageIntent.bookingId)
            ? pageIntent.bookingId
            : items[0]
              ? items[0].id
              : undefined
        }
        className="space-y-4"
      >
        {items.map(renderBookingCard)}
      </Accordion>
    </div>
  ) : <Card className="border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,249,251,0.9))] p-8 text-center shadow-[0_18px_44px_-32px_rgba(15,23,42,0.35)] sm:p-12"><div className="mx-auto max-w-md"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted"><Calendar className="h-8 w-8 text-muted-foreground" /></div><h3 className="mb-2 text-xl font-semibold">{emptyTitle}</h3><p className="text-muted-foreground">{emptyDescription}</p></div></Card>;

  if (isLoading) {
    return <div className="min-h-screen py-12"><div className="container mx-auto max-w-6xl px-4 md:px-8"><Skeleton className="mb-8 h-12 w-64" /><div className="space-y-4">{[1, 2, 3].map((i) => <Card key={i} className="p-6"><Skeleton className="h-32 w-full" /></Card>)}</div></div></div>;
  }

  if (!authLoading && !isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(13,148,136,0.12),transparent_26%),radial-gradient(circle_at_85%_12%,rgba(251,146,60,0.12),transparent_22%),linear-gradient(180deg,rgba(255,252,248,0.95),rgba(246,248,250,1))] py-12">
      <div className="container mx-auto max-w-6xl px-4 md:px-8">
        <div className="relative mb-8 overflow-hidden rounded-[32px] border border-border/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(245,247,250,0.94))] p-6 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.55)] md:p-8">
          <div className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
          <div className="pointer-events-none absolute -left-8 bottom-0 h-28 w-28 rounded-full bg-accent/10 blur-2xl" />
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3">
              <Badge variant="outline" className="rounded-full bg-background/85 px-3 py-1">Bookings</Badge>
              <div>
                <h1 className="font-serif text-3xl font-semibold tracking-tight leading-tight sm:text-4xl md:text-5xl">{user?.firstName ? `${user.firstName}, your bookings` : "Your bookings"}</h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">See what needs attention, reopen any booking, and keep your trip details in one calmer place.</p>
              </div>
              <Button variant="outline" className="rounded-full bg-background/85" onClick={() => setLocation("/inbox")}>Open Inbox Center</Button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:min-w-[460px] xl:grid-cols-3">
              <Card className="border-border/60 bg-background/85 shadow-[0_18px_36px_-30px_rgba(15,23,42,0.4)]"><CardContent className="p-4"><div className="text-sm text-muted-foreground">Open</div><div className="mt-1 text-2xl font-semibold">{activeBookings.length}</div></CardContent></Card>
              <Card className="border-border/60 bg-background/85 shadow-[0_18px_36px_-30px_rgba(15,23,42,0.4)]"><CardContent className="p-4"><div className="text-sm text-muted-foreground">Needs action</div><div className="mt-1 text-2xl font-semibold">{attentionBookingsCount}</div></CardContent></Card>
              <Card className="border-border/60 bg-background/85 shadow-[0_18px_36px_-30px_rgba(15,23,42,0.4)]"><CardContent className="p-4"><div className="text-sm text-muted-foreground">Past</div><div className="mt-1 text-2xl font-semibold">{historyBookings.length}</div></CardContent></Card>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "overview" | "active" | "history" | "profile")} className="space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-2 rounded-[22px] border border-border/60 bg-background/85 p-1 shadow-[0_16px_36px_-28px_rgba(15,23,42,0.34)] sm:grid-cols-4">
            <TabsTrigger value="active" className="min-h-11">Open</TabsTrigger>
            <TabsTrigger value="history" className="min-h-11">Past</TabsTrigger>
            <TabsTrigger value="overview" className="min-h-11">Overview</TabsTrigger>
            <TabsTrigger value="profile" className="min-h-11">Profile</TabsTrigger>
          </TabsList>

          <TabsContent value="active">{renderBookingsList(activeBookings, "No open bookings", "Upcoming and in-progress bookings appear here.")}</TabsContent>
          <TabsContent value="history">{renderBookingsList(historyBookings, "No past bookings", "Completed and cancelled bookings appear here.")}</TabsContent>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border-border/60 bg-background/85 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.34)]"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4" />Open</CardTitle><CardDescription>Upcoming and in progress.</CardDescription></CardHeader><CardContent><div className="text-3xl font-semibold">{activeBookings.length}</div></CardContent></Card>
              <Card className="border-border/60 bg-background/85 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.34)]"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4" />Completed</CardTitle><CardDescription>Finished bookings.</CardDescription></CardHeader><CardContent><div className="text-3xl font-semibold">{historyBookings.filter((booking) => booking.status === "completed").length}</div></CardContent></Card>
              <Card className="border-border/60 bg-background/85 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.34)]"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" />Account</CardTitle><CardDescription>Contact details on file.</CardDescription></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex items-start gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-all">{user?.email ?? "No email saved"}</span></div><div className="flex items-start gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{user?.phone ?? "Add phone number"}</span></div></CardContent></Card>
            </div>
            <InboxCenter
              mode="compact"
              enabled={isAuthenticated}
              userRole={user?.role}
              title="Travel inbox"
              description="Booking replies and important updates stay here so your trip messages do not get lost."
              initialView={pageIntent.openThread ? "messages" : "all"}
              focus={{
                bookingId: pageIntent.bookingId,
                threadKey: pageIntent.bookingId ? `booking:${pageIntent.bookingId}` : null,
              }}
            />
            {renderBookingsList(activeBookings.slice(0, 2), "No open bookings", "Upcoming and in-progress bookings appear here.")}
          </TabsContent>

          <TabsContent value="profile" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <Card className="border-border/60">
                <CardHeader><CardTitle>Profile</CardTitle><CardDescription>Keep your details up to date.</CardDescription></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2"><div className="text-sm font-medium">First Name</div><Input value={profileForm.firstName} onChange={(event) => setProfileForm((current) => ({ ...current, firstName: event.target.value }))} /></div>
                    <div className="space-y-2"><div className="text-sm font-medium">Last Name</div><Input value={profileForm.lastName} onChange={(event) => setProfileForm((current) => ({ ...current, lastName: event.target.value }))} /></div>
                  </div>
                  <div className="space-y-2"><div className="text-sm font-medium">Email</div><Input value={user?.email ?? ""} disabled /><p className="text-xs text-muted-foreground">Used for sign-in.</p></div>
                  <div className="space-y-2"><div className="text-sm font-medium">Phone Number</div><Input value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} /></div>
                  <Button className="w-full sm:w-auto" onClick={() => updateProfileMutation.mutate(profileForm)} disabled={updateProfileMutation.isPending}>{updateProfileMutation.isPending ? "Saving..." : "Save Changes"}</Button>
                </CardContent>
              </Card>
              <Card className="border-border/60">
                <CardHeader><CardTitle>Preview</CardTitle><CardDescription>Shown to support.</CardDescription></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3 rounded-2xl bg-muted/40 p-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="h-5 w-5" /></div><div className="min-w-0"><div className="font-medium">{[profileForm.firstName, profileForm.lastName].filter(Boolean).join(" ") || "Customer"}</div><div className="text-sm text-muted-foreground">Main traveler</div></div></div>
                  <div className="space-y-2 text-sm"><div className="flex items-start gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-all">{user?.email ?? "No email saved"}</span></div><div className="flex items-start gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{profileForm.phone || "No phone saved"}</span></div></div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      <CheckoutPaymentSheet
        open={!!retryCheckoutBooking}
        onOpenChange={(open) => {
          if (!startPaymentMutation.isPending && !open) {
            setRetryCheckoutBooking(null);
          }
        }}
        value={retryPaymentMethod}
        onChange={setRetryPaymentMethod}
        amount={retryCheckoutBooking ? <CurrencyAmount amountUsd={getBookingCheckoutAmount(retryCheckoutBooking)} /> : undefined}
        title="Finish your payment"
        description={retryCheckoutBooking && hasLockedInBookingDeposit(retryCheckoutBooking)
          ? "Select one to settle the remaining balance."
          : retryCheckoutBooking && isFullPaymentOnlyBooking(retryCheckoutBooking)
            ? getBookingAmountPaid(retryCheckoutBooking) > 0
              ? "Select one to settle the remaining balance."
              : "Select one to pay the full amount in one step."
            : retryCheckoutBooking && hasBookingDepositRequirement(retryCheckoutBooking)
            ? "Select one to pay the deposit and lock the dates."
            : "Select one to continue."}
        onConfirm={() => {
          if (!retryCheckoutBooking) return;
          startPaymentMutation.mutate({
            bookingId: retryCheckoutBooking.id,
            paymentMethod: retryPaymentMethod,
          });
        }}
        isSubmitting={startPaymentMutation.isPending}
      />
    </div>
  );
}
