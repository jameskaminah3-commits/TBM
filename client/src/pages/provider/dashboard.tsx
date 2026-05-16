import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  ChevronDown,
  HandCoins,
  Mail,
  Phone,
  Search,
  Share2,
  Star,
  UserRound,
  Wallet,
} from "lucide-react";
import type { Stay, Car, Cook, Errand, Experience, ProviderBookingAssignmentView, ProviderPaymentData } from "@shared/schema";
import { InboxCenter } from "@/components/inbox-center";
import { ProviderLayout } from "@/components/provider-layout";
import { useAuth } from "@/hooks/useAuth";
import { useInbox } from "@/hooks/use-inbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BookingThread } from "@/components/booking-thread";
import { RequestBriefAccordion } from "@/components/request-brief-accordion";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCurrency } from "@/lib/currency";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getShortShareUrl, type ShareServiceType } from "@/lib/share-links";
import { getCookExtraGuestInclusivePrice, getCookExtraGuestServiceFee, getCookMinimumGuests } from "@shared/cook-pricing";
import { getHelpMamaStartingPrice, hasHelpMamaPricing } from "@shared/errand-pricing";

type ProviderAssignments = {
  stays: Stay[];
  cars: Car[];
  cooks: Cook[];
  errands: Errand[];
  experiences: Experience[];
};

function ShareListingButton({
  serviceType,
  id,
  title,
  isPublic,
  className,
}: {
  serviceType: ShareServiceType;
  id: string;
  title: string;
  isPublic: boolean;
  className?: string;
}) {
  const { toast } = useToast();

  const handleShare = async () => {
    if (!isPublic) {
      toast({
        title: "Listing is not public yet",
        description: "Share links start working after admin approval.",
        variant: "destructive",
      });
      return;
    }

    const url = getShortShareUrl(serviceType, id);

    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }

      await navigator.clipboard.writeText(url);
      toast({
        title: "Short link copied",
        description: url,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      toast({
        title: "Could not share link",
        description: "Please try copying it again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("rounded-full bg-white/80", className)}
      onClick={handleShare}
      disabled={!isPublic}
      title={isPublic ? "Share short booking link" : "Available after admin approval"}
    >
      <Share2 className="mr-2 h-4 w-4" />
      Share
    </Button>
  );
}

function mergeUpdatedAssignment(
  currentAssignments: ProviderBookingAssignmentView[] | undefined,
  updatedAssignment: ProviderBookingAssignmentView,
) {
  if (!currentAssignments) {
    return [updatedAssignment];
  }

  return currentAssignments.map((assignment) =>
    assignment.assignment.id === updatedAssignment.assignment.id ? updatedAssignment : assignment,
  );
}

function getAssignmentServiceMode(assignment: ProviderBookingAssignmentView) {
  return assignment.assignment.serviceConfig.serviceMode || assignment.booking.serviceMode;
}

function getAssignmentScheduleSlots(assignment: ProviderBookingAssignmentView) {
  return (assignment.assignment.serviceConfig.serviceScheduleSlots || assignment.booking.serviceScheduleSlots || [])
    .filter((slot): slot is { date: string; note: string } => !!slot?.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getBookingThreadInitialLabel(assignment: ProviderBookingAssignmentView) {
  const mode = getAssignmentServiceMode(assignment);
  if (mode === "errand-shopping") return "Shopping List";
  if (mode === "errand-childcare") return "Family Care Notes";
  return "Request";
}

function getShortBookingReference(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function isArchivedBookingStatus(status: string) {
  return status === "completed" || status === "cancelled";
}

function isFinalizedAssignmentBooking(booking: ProviderBookingAssignmentView) {
  return isArchivedBookingStatus(booking.booking.status);
}

function getDashboardAssignmentStatus(booking: ProviderBookingAssignmentView) {
  if (isFinalizedAssignmentBooking(booking)) {
    return booking.booking.status;
  }

  const mode = getAssignmentServiceMode(booking);

  if (mode === "cook-custom-menu" && booking.booking.customMenuClientDecision !== "accepted") {
    return booking.booking.customMenuClientDecision === "declined" || booking.booking.customMenuProposalStatus === "declined"
      ? "completed"
      : "upcoming";
  }

  if (mode === "experience-custom-offer" && booking.booking.experienceCustomOfferClientDecision !== "accepted") {
    return booking.booking.experienceCustomOfferClientDecision === "declined" || booking.booking.experienceCustomOfferStatus === "declined"
      ? "completed"
      : "upcoming";
  }

  return booking.assignment.status || "upcoming";
}

function isDashboardArchivedBooking(booking: ProviderBookingAssignmentView | undefined) {
  return booking ? isArchivedBookingStatus(getDashboardAssignmentStatus(booking)) : false;
}

function isPendingCustomRequestBooking(assignment: ProviderBookingAssignmentView) {
  if (isFinalizedAssignmentBooking(assignment)) {
    return false;
  }

  if (isDashboardArchivedBooking(assignment)) {
    return false;
  }

  const mode = getAssignmentServiceMode(assignment);
  if (mode === "cook-custom-menu") {
    return assignment.booking.customMenuClientDecision !== "accepted";
  }

  if (mode === "experience-custom-offer") {
    return assignment.booking.experienceCustomOfferClientDecision !== "accepted";
  }

  return false;
}

function hasOpenProviderStatusRequest(booking: ProviderBookingAssignmentView) {
  return Boolean(
    booking.booking.providerStatusRequest
    && !booking.booking.providerStatusReviewedAt
    && !isDashboardArchivedBooking(booking),
  );
}

function hasOpenAdminReviewRequest(booking: ProviderBookingAssignmentView) {
  if (isDashboardArchivedBooking(booking)) {
    return false;
  }

  return booking.booking.customMenuProposalStatus === "pending-admin-approval"
    || booking.booking.experienceCustomOfferStatus === "pending-admin-approval";
}

function sortCustomRequestBookings(bookings: ProviderBookingAssignmentView[]) {
  return [...bookings].sort((a, b) => {
    const archivedDelta = Number(isDashboardArchivedBooking(a)) - Number(isDashboardArchivedBooking(b));
    if (archivedDelta !== 0) {
      return archivedDelta;
    }

    const priority = (booking: ProviderBookingAssignmentView) => {
      if (hasOpenProviderStatusRequest(booking)) {
        return 0;
      }
      if (hasOpenAdminReviewRequest(booking)) {
        return 1;
      }
      return 2;
    };

    const priorityDelta = priority(a) - priority(b);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return a.booking.checkIn.localeCompare(b.booking.checkIn);
  });
}

function isConfirmedOrderBooking(assignment: ProviderBookingAssignmentView) {
  const mode = getAssignmentServiceMode(assignment);
  if (mode === "cook-custom-menu") {
    return assignment.booking.customMenuClientDecision === "accepted";
  }

  if (mode === "experience-custom-offer") {
    return assignment.booking.experienceCustomOfferClientDecision === "accepted";
  }

  return !isArchivedBookingStatus(assignment.assignment.status);
}

function sortProviderBookings(bookings: ProviderBookingAssignmentView[]) {
  return [...bookings].sort((a, b) => {
    const archivedDelta = Number(isDashboardArchivedBooking(a)) - Number(isDashboardArchivedBooking(b));
    if (archivedDelta !== 0) {
      return archivedDelta;
    }

    return a.booking.checkIn.localeCompare(b.booking.checkIn);
  });
}

function shouldShowArchiveHeading(bookings: ProviderBookingAssignmentView[], index: number) {
  if (!isDashboardArchivedBooking(bookings[index])) {
    return false;
  }

  return index === 0 || !isDashboardArchivedBooking(bookings[index - 1]);
}

function getProgressStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "upcoming":
      return "Upcoming";
    case "in-progress":
      return "In Progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Upcoming";
  }
}

function getActiveBookingCount(bookings: ProviderBookingAssignmentView[]) {
  return bookings.filter((booking) => isConfirmedOrderBooking(booking) && !isDashboardArchivedBooking(booking)).length;
}

function getPendingStatusRequests(bookings: ProviderBookingAssignmentView[]) {
  return bookings.filter((booking) => hasOpenProviderStatusRequest(booking)).length;
}

function getPendingProposalCount(bookings: ProviderBookingAssignmentView[]) {
  return bookings.filter((booking) => hasOpenAdminReviewRequest(booking)).length;
}

function getNextProgressAction(status: string) {
  if (status === "upcoming") {
    return { status: "in-progress" as const, label: "Mark In Progress" };
  }

  if (status === "in-progress" || status === "late") {
    return { status: "completed" as const, label: "Mark Completed" };
  }

  return null;
}

function getCustomRequestQueueLabel(assignment: ProviderBookingAssignmentView) {
  if (isFinalizedAssignmentBooking(assignment)) {
    return assignment.booking.status === "cancelled" ? "Cancelled" : "Completed";
  }

  const mode = getAssignmentServiceMode(assignment);
  if (mode === "cook-custom-menu") {
    if (assignment.booking.customMenuProposalStatus === "pending-admin-approval") {
      return "Waiting Admin";
    }

    if (assignment.booking.customMenuProposalStatus === "proposed" || assignment.booking.customMenuProposalStatus === "declined") {
      return "Waiting Client";
    }

    return "Needs Quote";
  }

  if (mode === "experience-custom-offer") {
    if (assignment.booking.experienceCustomOfferStatus === "pending-admin-approval") {
      return "Waiting Admin";
    }

    if (assignment.booking.experienceCustomOfferStatus === "proposed" || assignment.booking.experienceCustomOfferStatus === "declined") {
      return "Waiting Client";
    }

    return "Needs Quote";
  }

  return "Open";
}

function getCustomRequestLabel(assignment: ProviderBookingAssignmentView) {
  const mode = getAssignmentServiceMode(assignment);
  if (mode === "cook-custom-menu") {
    return "Custom Menu";
  }

  if (mode === "experience-custom-offer" && assignment.booking.selectedServices.length === 0) {
    return "Custom Service";
  }

  if (mode === "experience-custom-offer") {
    return "Custom Experience";
  }

  return "Custom Request";
}

function getRequestPreview(details?: string | null) {
  if (!details) {
    return "No request details shared.";
  }

  const flattened = details
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  if (!flattened) {
    return "No request details shared.";
  }

  return flattened.length > 180 ? `${flattened.slice(0, 177)}...` : flattened;
}

function joinMeta(parts: Array<string | null | undefined | false>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" / ");
}

function getAssignmentLocation(assignment: ProviderBookingAssignmentView) {
  return assignment.assignment.serviceConfig.serviceLocation || assignment.booking.serviceLocation;
}

function getAssignmentPickupLocation(assignment: ProviderBookingAssignmentView) {
  return assignment.assignment.serviceConfig.servicePickupLocation || assignment.booking.servicePickupLocation;
}

function getAssignmentReturnLocation(assignment: ProviderBookingAssignmentView) {
  return assignment.assignment.serviceConfig.serviceReturnLocation || assignment.booking.serviceReturnLocation;
}

function getAssignmentGuests(assignment: ProviderBookingAssignmentView) {
  return assignment.assignment.serviceConfig.guests ?? assignment.booking.guests ?? null;
}

function getAssignmentBudgetAmount(assignment: ProviderBookingAssignmentView) {
  return assignment.assignment.serviceConfig.serviceBudgetAmount ?? assignment.booking.serviceBudgetAmount ?? null;
}

function getAssignmentRequestDetails(assignment: ProviderBookingAssignmentView) {
  return assignment.assignment.serviceConfig.serviceRequestDetails || assignment.booking.serviceRequestDetails;
}

function getAssignmentDateRange(assignment: ProviderBookingAssignmentView) {
  if (!assignment.booking.checkIn) {
    return null;
  }

  if (assignment.booking.checkOut && assignment.booking.checkOut !== assignment.booking.checkIn) {
    return `${assignment.booking.checkIn} to ${assignment.booking.checkOut}`;
  }

  return assignment.booking.checkIn;
}

function formatDashboardDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function getBookedOnLabel(assignment: ProviderBookingAssignmentView) {
  return formatDashboardDate(assignment.booking.createdAt);
}

function getCarModeSummary(assignment: ProviderBookingAssignmentView) {
  const serviceMode = getAssignmentServiceMode(assignment);
  const serviceHours = assignment.assignment.serviceConfig.serviceHours ?? assignment.booking.serviceHours ?? null;
  const serviceStartTime = assignment.assignment.serviceConfig.serviceStartTime || assignment.booking.serviceStartTime;
  const serviceEndTime = assignment.assignment.serviceConfig.serviceEndTime || assignment.booking.serviceEndTime;

  if (serviceMode === "car-chauffeur-hourly") {
    return joinMeta([
      serviceHours ? `${serviceHours} hour chauffeur booking` : "Hourly chauffeur booking",
      serviceStartTime && serviceEndTime ? `${serviceStartTime} to ${serviceEndTime}` : null,
    ]);
  }

  if (serviceMode === "car-self-drive-day") {
    return "Self-drive day booking";
  }

  return "Chauffeur day booking";
}

function DashboardSectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      {eyebrow ? <div className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-teal-700">{eyebrow}</div> : null}
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h2>
        {description ? <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

function ProviderOrderCollapsible({
  assignmentId,
  title,
  summary,
  detail,
  statusContent,
  archived = false,
  open,
  onOpenChange,
  children,
}: {
  assignmentId: string;
  title: string;
  summary?: string | null;
  detail?: string | null;
  statusContent?: ReactNode;
  archived?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div
        className={cn(
          "rounded-[1.5rem] border border-stone-200/80 p-4 shadow-sm sm:p-5",
          archived ? "bg-stone-50/70" : "bg-white",
        )}
      >
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-start gap-4 text-left">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-medium text-foreground">{title}</div>
              {summary ? <div className="text-sm text-muted-foreground">{summary}</div> : null}
              {detail ? <div className="text-sm text-muted-foreground">{detail}</div> : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {statusContent ? <div className="flex max-w-[13rem] flex-wrap justify-end gap-2">{statusContent}</div> : null}
              <span className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-600">
                {open ? "Hide details" : "Open details"}
                <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", open ? "rotate-180" : "")} />
              </span>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          <div className="mt-4 space-y-4 border-t border-stone-200/80 pt-4">
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function getAverageListingRating(items: Array<{ rating: number; reviewCount: number }>) {
  const totalReviews = items.reduce((sum, item) => sum + item.reviewCount, 0);
  if (totalReviews === 0) {
    return null;
  }

  const weightedTotal = items.reduce((sum, item) => sum + item.rating * item.reviewCount, 0);
  return Number((weightedTotal / totalReviews).toFixed(1));
}

function matchesDashboardQuery(
  query: string,
  values: Array<string | number | null | undefined>,
) {
  if (!query) {
    return true;
  }

  return values.some((value) => String(value ?? "").toLowerCase().includes(query));
}

const platformServiceFeeHelpText = "This fee covers platform maintenance, secure payment processing, and 24/7 guest support to ensure your booking runs smoothly.";

function formatServiceFeePercentLabel(serviceFeePercents: number[]) {
  if (serviceFeePercents.length === 0) {
    return "0%";
  }

  if (serviceFeePercents.length === 1) {
    return `${serviceFeePercents[0]}%`;
  }

  return `${serviceFeePercents[0]}% - ${serviceFeePercents[serviceFeePercents.length - 1]}%`;
}

function PlatformServiceFeeHint() {
  const hintTriggerClassName = "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-sm font-semibold text-stone-500 shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 sm:h-6 sm:w-6 sm:text-[0.78rem]";
  const hintCardClassName = "w-72 max-w-[calc(100vw-1.5rem)] rounded-[1.35rem] border border-stone-200/90 bg-gradient-to-br from-white via-stone-50 to-teal-50/70 px-4 py-3.5 text-stone-700 shadow-[0_20px_60px_-36px_rgba(92,73,47,0.34)]";

  return (
    <>
      <div className="hidden sm:block">
        <HoverCard openDelay={120} closeDelay={80}>
          <HoverCardTrigger asChild>
            <button type="button" className={hintTriggerClassName} aria-label="What are platform service fees?">
              ?
            </button>
          </HoverCardTrigger>
          <HoverCardContent align="end" className={hintCardClassName}>
            <div className="space-y-2">
              <div className="text-xs font-medium italic text-stone-500">Platform Service Fees</div>
              <p className="text-[0.92rem] leading-6 italic text-stone-700">{platformServiceFeeHelpText}</p>
            </div>
          </HoverCardContent>
        </HoverCard>
      </div>

      <div className="sm:hidden">
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={hintTriggerClassName} aria-label="What are platform service fees?">
              ?
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" side="top" className={hintCardClassName}>
            <div className="space-y-2">
              <div className="text-xs font-medium italic text-stone-500">Platform Service Fees</div>
              <p className="text-[0.92rem] leading-6 italic text-stone-700">{platformServiceFeeHelpText}</p>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}

function readProviderDashboardIntent(search: string) {
  const params = new URLSearchParams(search);
  const requestedTab = params.get("tab");
  const tab: "overview" | "listings" | "custom-requests" | "bookings" = requestedTab === "listings" || requestedTab === "custom-requests" || requestedTab === "bookings"
    ? requestedTab
    : "overview";

  return {
    tab,
    bookingId: params.get("bookingId"),
    assignmentId: params.get("assignmentId"),
    openThread: params.get("openThread") === "1",
  };
}

export default function ProviderDashboard() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { user, isLoading: authLoading, isProvider, isAdmin } = useAuth();
  const { toast } = useToast();
  const { formatAmount, convertToUsd, selectedCurrency } = useCurrency();
  const dashboardIntent = useMemo(() => readProviderDashboardIntent(search), [search]);
  const [activeTab, setActiveTab] = useState<"overview" | "listings" | "custom-requests" | "bookings">("overview");
  const [dashboardQuery, setDashboardQuery] = useState("");
  const [showOnlyActionable, setShowOnlyActionable] = useState(false);
  const [profileForm, setProfileForm] = useState({ firstName: "", lastName: "", phone: "" });
  const [proposalAmounts, setProposalAmounts] = useState<Record<string, string>>({});
  const [proposalMessages, setProposalMessages] = useState<Record<string, string>>({});
  const [declineReasons, setDeclineReasons] = useState<Record<string, string>>({});
  const [activeCustomMenuBookingId, setActiveCustomMenuBookingId] = useState<string | null>(null);
  const [activeExperienceOfferBookingId, setActiveExperienceOfferBookingId] = useState<string | null>(null);
  const [activeStatusBookingId, setActiveStatusBookingId] = useState<string | null>(null);
  const [expandedAssignments, setExpandedAssignments] = useState<Record<string, boolean>>({});

  const setAssignmentExpanded = (assignmentId: string, open: boolean) => {
    setExpandedAssignments((current) => {
      if (current[assignmentId] === open) {
        return current;
      }

      return {
        ...current,
        [assignmentId]: open,
      };
    });
  };

  const openAssignment = (assignmentId: string) => {
    setAssignmentExpanded(assignmentId, true);
  };

  const isAssignmentExpanded = (assignmentId: string) => expandedAssignments[assignmentId] ?? false;

  const getSubmittedProposalAmountUsd = (enteredAmount: string | undefined, existingAmount?: number | null) => {
    const parsedAmount = Number(enteredAmount ?? "");
    if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
      return convertToUsd(parsedAmount);
    }

    return existingAmount ?? 0;
  };

  useEffect(() => {
    if (!authLoading && !isProvider && !isAdmin) {
      setLocation("/auth?next=/provider/dashboard");
    }
  }, [authLoading, isProvider, isAdmin, setLocation]);

  const { data } = useQuery<ProviderAssignments>({
    queryKey: ["/api/provider/assignments"],
  });
  const providerTypes = (user?.providerTypes ?? []) as Array<"stays" | "cars" | "cooks" | "errands" | "experiences">;
  const hasRole = (role: "stays" | "cars" | "cooks" | "errands" | "experiences") => providerTypes.length === 0 || providerTypes.includes(role);
  const { data: providerBookingAssignments = [] } = useQuery<ProviderBookingAssignmentView[]>({
    queryKey: ["/api/provider/booking-assignments"],
  });
  const { unreadCount: unreadNotificationCount } = useInbox({ enabled: isProvider || isAdmin });
  const { data: providerPaymentData } = useQuery<ProviderPaymentData>({
    queryKey: ["/api/provider/payments"],
    enabled: !isAdmin,
  });
  const orderedStayBookings = sortProviderBookings(providerBookingAssignments.filter((item) => item.assignment.providerCategory === "stays"));
  const orderedCarBookings = sortProviderBookings(providerBookingAssignments.filter((item) => item.assignment.providerCategory === "cars"));
  const orderedCookBookings = sortProviderBookings(providerBookingAssignments.filter((item) => item.assignment.providerCategory === "cooks"));
  const orderedErrandBookings = sortProviderBookings(providerBookingAssignments.filter((item) => item.assignment.providerCategory === "errands"));
  const orderedExperienceBookings = sortProviderBookings(providerBookingAssignments.filter((item) => item.assignment.providerCategory === "experiences"));
  const assignedListingCount =
    (data?.stays?.length ?? 0) +
    (data?.cars?.length ?? 0) +
    (data?.cooks?.length ?? 0) +
    (data?.errands?.length ?? 0) +
    (data?.experiences?.length ?? 0);
  const liveBookingCount =
    getActiveBookingCount(orderedStayBookings) +
    getActiveBookingCount(orderedCarBookings) +
    getActiveBookingCount(orderedCookBookings) +
    getActiveBookingCount(orderedErrandBookings) +
    getActiveBookingCount(orderedExperienceBookings);
  const pendingReviewCount =
    (data?.stays?.filter((stay) => !stay.isPublic).length ?? 0) +
    (data?.cars?.filter((car) => !car.isPublic).length ?? 0) +
    (data?.cooks?.filter((cook) => !cook.isPublic).length ?? 0) +
    (data?.errands?.filter((errand) => !errand.isPublic).length ?? 0) +
    (data?.experiences?.filter((experience) => !experience.isPublic).length ?? 0) +
    getPendingStatusRequests(orderedCarBookings) +
    getPendingStatusRequests(orderedCookBookings) +
    getPendingProposalCount(orderedCookBookings) +
    getPendingProposalCount(orderedExperienceBookings);
  const normalizedDashboardQuery = dashboardQuery.trim().toLowerCase();
  const hasDashboardFilters = normalizedDashboardQuery.length > 0 || showOnlyActionable;
  const shouldIncludeListing = (searchValues: Array<string | number | null | undefined>, isPublic: boolean) =>
    matchesDashboardQuery(normalizedDashboardQuery, searchValues) && (!showOnlyActionable || !isPublic);
  const shouldIncludeBooking = (
    booking: ProviderBookingAssignmentView,
    searchValues: Array<string | number | null | undefined>,
    needsAttention = !isDashboardArchivedBooking(booking),
  ) =>
    matchesDashboardQuery(normalizedDashboardQuery, searchValues) &&
    (!showOnlyActionable || needsAttention);
  const visibleStays = (data?.stays ?? []).filter((stay) =>
    shouldIncludeListing([stay.title, stay.location, stay.isPublic ? "public" : "pending review"], stay.isPublic),
  );
  const visibleCars = (data?.cars ?? []).filter((car) =>
    shouldIncludeListing([car.model, car.location, car.isPublic ? "public" : "pending review"], car.isPublic),
  );
  const visibleCooks = (data?.cooks ?? []).filter((cook) =>
    shouldIncludeListing(
      [cook.title, cook.location, cook.speciality, cook.serviceType, cook.isPublic ? "public" : "pending review"],
      cook.isPublic,
    ),
  );
  const visibleErrands = (data?.errands ?? []).filter((errand) =>
    shouldIncludeListing(
      [errand.serviceName, errand.location, errand.isPublic ? "public" : "pending review"],
      errand.isPublic,
    ),
  );
  const visibleExperiences = (data?.experiences ?? []).filter((experience) =>
    shouldIncludeListing(
      [
        experience.title,
        experience.location,
        experience.experienceLocation,
        experience.experienceType,
        experience.isPublic ? "public" : "pending review",
      ],
      experience.isPublic,
    ),
  );
  const visibleStayBookings = orderedStayBookings.filter((booking) => {
    const stay = data?.stays?.find((item) => item.id === booking.assignment.serviceId);
    return shouldIncludeBooking(booking, [
      stay?.title,
      booking.booking.guestName,
      booking.booking.checkIn,
      booking.booking.checkOut,
      getProgressStatusLabel(getDashboardAssignmentStatus(booking)),
    ]);
  });
  const visibleCarBookings = orderedCarBookings.filter((booking) => {
    const car = data?.cars?.find((item) => item.id === booking.assignment.serviceId);
    return shouldIncludeBooking(
      booking,
      [
        car?.model,
        booking.booking.guestName,
        booking.booking.checkIn,
        getAssignmentLocation(booking),
        getAssignmentPickupLocation(booking),
        getAssignmentReturnLocation(booking),
        booking.assignment.serviceConfig.serviceZone,
        getProgressStatusLabel(getDashboardAssignmentStatus(booking)),
      ],
      !!booking.booking.providerStatusRequest || !isDashboardArchivedBooking(booking),
    );
  });
  const visibleCookBookings = orderedCookBookings.filter((booking) => {
    const cook = data?.cooks?.find((item) => item.id === booking.assignment.serviceId);
    return shouldIncludeBooking(
      booking,
      [
        cook?.title,
        booking.booking.guestName,
        booking.booking.checkIn,
        getAssignmentLocation(booking),
        getAssignmentRequestDetails(booking),
        getProgressStatusLabel(getDashboardAssignmentStatus(booking)),
      ],
      !!booking.booking.providerStatusRequest ||
        booking.booking.customMenuProposalStatus === "pending-admin-approval" ||
        !isDashboardArchivedBooking(booking),
    );
  });
  const visibleErrandBookings = orderedErrandBookings.filter((booking) => {
    const errand = data?.errands?.find((item) => item.id === booking.assignment.serviceId);
    return shouldIncludeBooking(
      booking,
      [
        errand?.serviceName,
        booking.booking.guestName,
        getAssignmentLocation(booking),
        getAssignmentRequestDetails(booking),
        getProgressStatusLabel(getDashboardAssignmentStatus(booking)),
      ],
    );
  });
  const visibleExperienceBookings = orderedExperienceBookings.filter((booking) => {
    const experience = data?.experiences?.find((item) => item.id === booking.assignment.serviceId);
    return shouldIncludeBooking(
      booking,
      [
        experience?.title,
        booking.booking.guestName,
        booking.booking.checkIn,
        booking.assignment.serviceConfig.serviceLocation,
        booking.assignment.serviceConfig.serviceRequestDetails,
        getProgressStatusLabel(getDashboardAssignmentStatus(booking)),
      ],
      booking.booking.experienceCustomOfferStatus === "pending-admin-approval" || !isDashboardArchivedBooking(booking),
    );
  });
  const customRequestBookings = sortCustomRequestBookings(
    [...visibleCookBookings, ...visibleExperienceBookings].filter((booking) => isPendingCustomRequestBooking(booking)),
  );
  const bookingTabCookBookings = visibleCookBookings;
  const bookingTabExperienceBookings = visibleExperienceBookings;
  const partnerPendingCustomRequestCount = customRequestBookings.filter(
    (booking) =>
      booking.booking.customMenuProposalStatus === "pending" ||
      booking.booking.experienceCustomOfferStatus === "pending",
  ).length;
  const adminPendingCustomRequestCount = customRequestBookings.filter(
    (booking) =>
      booking.booking.customMenuProposalStatus === "pending-admin-approval" ||
      booking.booking.experienceCustomOfferStatus === "pending-admin-approval",
  ).length;
  const clientPendingCustomRequestCount = customRequestBookings.filter(
    (booking) =>
      booking.booking.customMenuProposalStatus === "proposed" ||
      booking.booking.customMenuProposalStatus === "declined" ||
      booking.booking.experienceCustomOfferStatus === "proposed" ||
      booking.booking.experienceCustomOfferStatus === "declined",
  ).length;
  const allAssignedListings = [
    ...(data?.stays ?? []),
    ...(data?.cars ?? []),
    ...(data?.cooks ?? []),
    ...(data?.errands ?? []),
    ...(data?.experiences ?? []),
  ];
  const publicListingCount = allAssignedListings.filter((item) => item.isPublic).length;
  const underReviewListingCount = allAssignedListings.filter((item) => !item.isPublic).length;
  const allProviderBookings = [
    ...orderedStayBookings,
    ...orderedCarBookings,
    ...orderedCookBookings,
    ...orderedErrandBookings,
    ...orderedExperienceBookings,
  ];
  const requestCount = allProviderBookings.filter((booking) =>
    hasOpenProviderStatusRequest(booking) || hasOpenAdminReviewRequest(booking),
  ).length;
  const completedBookingCount = allProviderBookings.filter((booking) => getDashboardAssignmentStatus(booking) === "completed" && isConfirmedOrderBooking(booking)).length;
  const averageRating = getAverageListingRating(
    [
      ...(data?.stays ?? []),
      ...(data?.cars ?? []),
      ...(data?.cooks ?? []),
      ...(data?.errands ?? []),
      ...(data?.experiences ?? []),
    ].map((item) => ({ rating: item.rating, reviewCount: item.reviewCount })),
  );
  const totalReviewCount = [
    ...(data?.stays ?? []),
    ...(data?.cars ?? []),
    ...(data?.cooks ?? []),
    ...(data?.errands ?? []),
    ...(data?.experiences ?? []),
  ].reduce((sum, item) => sum + item.reviewCount, 0);
  const payoutByAssignmentId = new Map(
    (providerPaymentData?.payouts ?? [])
      .filter((payout) => Boolean(payout.assignmentId))
      .map((payout) => [payout.assignmentId!, payout] as const),
  );
  const projectedNetEarnings = providerPaymentData?.totalProjectedPayouts ?? 0;
  const awaitingPayoutAmount = (providerPaymentData?.totalPendingPayouts ?? 0) + (providerPaymentData?.totalApprovedPayouts ?? 0);
  const paidOutAmount = providerPaymentData?.totalPaidOut ?? 0;
  const platformServiceFeeRateLabel = formatServiceFeePercentLabel(providerPaymentData?.serviceFeePercents ?? []);
  const completedNetEarnings = allProviderBookings
    .filter((booking) => getDashboardAssignmentStatus(booking) === "completed" && isConfirmedOrderBooking(booking))
    .reduce((sum, booking) => sum + (payoutByAssignmentId.get(booking.assignment.id)?.payoutAmount ?? 0), 0);
  const actionableQueueCount = pendingReviewCount + customRequestBookings.length + requestCount + unreadNotificationCount;
  const deepLinkedAssignmentId = useMemo(
    () => dashboardIntent.assignmentId
      || allProviderBookings.find((booking) => booking.booking.id === dashboardIntent.bookingId)?.assignment.id
      || null,
    [allProviderBookings, dashboardIntent.assignmentId, dashboardIntent.bookingId],
  );

  useEffect(() => {
    if (!dashboardIntent.bookingId && !dashboardIntent.assignmentId) {
      if (dashboardIntent.tab !== "overview") {
        setActiveTab(dashboardIntent.tab);
      }
      return;
    }

    setActiveTab(dashboardIntent.tab === "overview" ? "bookings" : dashboardIntent.tab);
    if (deepLinkedAssignmentId) {
      openAssignment(deepLinkedAssignmentId);
    }

    if (typeof window === "undefined" || !deepLinkedAssignmentId) {
      return;
    }

    window.setTimeout(() => {
      document.getElementById(`partner-assignment-${deepLinkedAssignmentId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [dashboardIntent, deepLinkedAssignmentId]);

  useEffect(() => {
    setProfileForm({
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      phone: user?.phone ?? "",
    });
  }, [user?.firstName, user?.lastName, user?.phone]);

  const updateProviderBookingStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "in-progress" | "completed" }) =>
      apiRequest("PATCH", `/api/provider/booking-assignments/${id}/status`, { status }),
    onMutate: ({ id }) => {
      setActiveStatusBookingId(id);
    },
    onSuccess: async (response, variables) => {
      const updatedAssignment = await response.json();
      queryClient.setQueryData<ProviderBookingAssignmentView[] | undefined>(["/api/provider/booking-assignments"], (current) =>
        current ? mergeUpdatedAssignment(current, updatedAssignment) : current,
      );
      queryClient.invalidateQueries({ queryKey: ["/api/provider/booking-assignments"] });

      toast({
        title: "Order updated",
        description: `Marked as ${getProgressStatusLabel(variables.status).toLowerCase()}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update order",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
    onSettled: () => {
      setActiveStatusBookingId(null);
    },
  });

  const reviewCookBookingMutation = useMutation({
    mutationFn: async ({
      assignmentId,
      payload,
    }: {
      assignmentId: string;
      payload: Record<string, unknown>;
    }) => apiRequest("PATCH", `/api/provider/booking-assignments/${assignmentId}/custom-menu-proposal`, payload),
    onMutate: ({ assignmentId }) => {
      setActiveCustomMenuBookingId(assignmentId);
    },
    onSuccess: async (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/booking-assignments"] });
      setProposalAmounts((current) => ({ ...current, [variables.assignmentId]: "" }));
      setProposalMessages((current) => ({ ...current, [variables.assignmentId]: "" }));
      setDeclineReasons((current) => ({ ...current, [variables.assignmentId]: "" }));
      toast({ title: "Submitted for admin review", description: "Your chef response is now waiting for admin approval before the client sees it." });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not review request",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
    onSettled: () => {
      setActiveCustomMenuBookingId(null);
    },
  });

  const reviewExperienceOfferMutation = useMutation({
    mutationFn: async ({
      assignmentId,
      payload,
    }: {
      assignmentId: string;
      payload: Record<string, unknown>;
    }) => apiRequest("PATCH", `/api/provider/booking-assignments/${assignmentId}/experience-custom-offer`, payload),
    onMutate: ({ assignmentId }) => {
      setActiveExperienceOfferBookingId(assignmentId);
    },
    onSuccess: async (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/booking-assignments"] });
      setProposalAmounts((current) => ({ ...current, [variables.assignmentId]: "" }));
      setProposalMessages((current) => ({ ...current, [variables.assignmentId]: "" }));
      setDeclineReasons((current) => ({ ...current, [variables.assignmentId]: "" }));
      toast({ title: "Submitted for admin review", description: "Your custom offer response is now waiting for admin approval before the client sees it." });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update custom offer",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
    onSettled: () => {
      setActiveExperienceOfferBookingId(null);
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (payload: typeof profileForm) => apiRequest("PATCH", "/api/auth/user", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Profile updated",
        description: "Your provider contact details have been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not save profile",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const getCookBookingLabel = (booking: ProviderBookingAssignmentView) => {
    const mode = getAssignmentServiceMode(booking);
    if (mode === "cook-inclusive") {
      return "All-inclusive chef booking";
    }

    if (mode === "cook-custom-menu") {
      return "Custom menu review request";
    }

    return "Chef service booking";
  };

  const getFinalizedWorkflowBadge = (booking: ProviderBookingAssignmentView) => (
    booking.booking.status === "cancelled"
      ? <Badge variant="destructive">Cancelled</Badge>
      : <Badge variant="secondary">Completed</Badge>
  );

  const getProposalBadge = (proposalStatus: string) => {
    switch (proposalStatus) {
      case "pending-admin-approval":
        return <Badge className="bg-blue-600">Submitted</Badge>;
      case "proposed":
        return <Badge className="bg-amber-600">With Client</Badge>;
      case "declined":
        return <Badge variant="destructive">Declined</Badge>;
      default:
        return <Badge variant="outline">Pending Chef Review</Badge>;
    }
  };

  const isClosedCustomMenu = (booking: ProviderBookingAssignmentView) =>
    getAssignmentServiceMode(booking) === "cook-custom-menu" &&
    booking.booking.customMenuClientDecision === "accepted";

  const getCustomMenuWorkflowBadge = (booking: ProviderBookingAssignmentView) => {
    if (isFinalizedAssignmentBooking(booking)) {
      return getFinalizedWorkflowBadge(booking);
    }

    if (isClosedCustomMenu(booking)) {
      return <Badge variant="secondary">Fulfilled</Badge>;
    }

    return getProposalBadge(booking.booking.customMenuProposalStatus);
  };

  const getExperienceOfferBadge = (proposalStatus: string) => {
    switch (proposalStatus) {
      case "pending-admin-approval":
        return <Badge className="bg-blue-600">Submitted</Badge>;
      case "proposed":
        return <Badge className="bg-amber-600">With Client</Badge>;
      case "declined":
        return <Badge variant="destructive">Declined</Badge>;
      default:
        return <Badge variant="outline">Open</Badge>;
    }
  };

  const isClosedExperienceOffer = (booking: ProviderBookingAssignmentView) =>
    getAssignmentServiceMode(booking) === "experience-custom-offer" &&
    booking.booking.experienceCustomOfferClientDecision === "accepted";

  const getExperienceWorkflowBadge = (booking: ProviderBookingAssignmentView) => {
    if (isFinalizedAssignmentBooking(booking)) {
      return getFinalizedWorkflowBadge(booking);
    }

    if (isClosedExperienceOffer(booking)) {
      return <Badge variant="secondary">Fulfilled</Badge>;
    }

    return getExperienceOfferBadge(booking.booking.experienceCustomOfferStatus);
  };

  const getExperienceOfferStatusText = (booking: ProviderBookingAssignmentView) => {
    if (isFinalizedAssignmentBooking(booking)) {
      return booking.booking.status === "cancelled"
        ? "Booking cancelled by admin. Offer actions are locked."
        : "Booking completed by admin. Offer actions are locked.";
    }

    if (isClosedExperienceOffer(booking)) {
      return "Accepted by client.";
    }

    switch (booking.booking.experienceCustomOfferStatus) {
      case "pending-admin-approval":
        return "Submitted for review.";
      case "proposed":
        return "Shared with client.";
      case "declined":
        return "Declined.";
      default:
        return "Ready for pricing.";
    }
  };

  const getPrimaryBookingStatusBadge = (booking: ProviderBookingAssignmentView) => {
    if (getAssignmentServiceMode(booking) === "cook-custom-menu") {
      return getCustomMenuWorkflowBadge(booking);
    }

    if (getAssignmentServiceMode(booking) === "experience-custom-offer") {
      return getExperienceWorkflowBadge(booking);
    }

    return <Badge variant="outline">{getProgressStatusLabel(getDashboardAssignmentStatus(booking))}</Badge>;
  };

  const listingsTabLabel = "Listings";
  const customRequestsTabLabel = customRequestBookings.length > 0 ? `Requests (${customRequestBookings.length})` : "Requests";
  const bookingsTabLabel = liveBookingCount > 0 ? `Bookings (${liveBookingCount})` : "Bookings";
  const customRequestsTabTone =
    customRequestBookings.length > 0
      ? "border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100"
      : "";
  const bookingsTabTone =
    requestCount > 0
      ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
      : liveBookingCount > 0
        ? "border-teal-200 bg-teal-50 text-teal-900 hover:bg-teal-100"
        : "";
  const listingSectionLinks = [
    hasRole("stays") ? { id: "provider-stays", label: "Stays", count: visibleStays.length } : null,
    hasRole("cars") ? { id: "provider-cars", label: "Cars", count: visibleCars.length } : null,
    hasRole("cooks") ? { id: "provider-cooks", label: "Chefs", count: visibleCooks.length } : null,
    hasRole("errands") ? { id: "provider-errands", label: "Errands", count: visibleErrands.length } : null,
    hasRole("experiences") ? { id: "provider-experiences", label: "Experiences", count: visibleExperiences.length } : null,
  ].filter((value): value is { id: string; label: string; count: number } => Boolean(value));
  const bookingSectionLinks = [
    hasRole("stays") ? { id: "provider-stay-bookings", label: "Stays", count: visibleStayBookings.length } : null,
    hasRole("cars") ? { id: "provider-car-bookings", label: "Cars", count: visibleCarBookings.length } : null,
    hasRole("cooks") ? { id: "provider-cook-bookings", label: "Chefs", count: bookingTabCookBookings.length } : null,
    hasRole("errands") ? { id: "provider-errand-bookings", label: "Errands", count: visibleErrandBookings.length } : null,
    hasRole("experiences") ? { id: "provider-experience-bookings", label: "Experiences", count: bookingTabExperienceBookings.length } : null,
  ].filter((value): value is { id: string; label: string; count: number } => Boolean(value));

  const jumpToSection = (id: string) => {
    if (typeof document === "undefined") {
      return;
    }

    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const openCustomRequestWorkspace = (assignmentId: string) => {
    setActiveTab("bookings");
    openAssignment(assignmentId);

    if (typeof window === "undefined") {
      return;
    }

    window.setTimeout(() => {
      document.getElementById(`partner-assignment-${assignmentId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const openBookingWorkspace = (bookingId: string, assignmentId?: string | null) => {
    setActiveTab("bookings");
    const targetAssignmentId = assignmentId || allProviderBookings.find((booking) => booking.booking.id === bookingId)?.assignment.id;
    if (targetAssignmentId) {
      openAssignment(targetAssignmentId);
    }

    if (typeof window === "undefined") {
      return;
    }

    window.setTimeout(() => {
      if (targetAssignmentId) {
        document.getElementById(`partner-assignment-${targetAssignmentId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 80);
  };

  return (
    <ProviderLayout>
      <div className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(20,184,166,0.12),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.12),_transparent_28%),linear-gradient(180deg,_rgba(255,251,245,0.92),_rgba(255,255,255,1))]">
        <div className="container mx-auto space-y-6 px-4 py-5 sm:px-5 md:space-y-8 md:px-6 md:py-8">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "overview" | "listings" | "custom-requests" | "bookings")} className="space-y-6 md:space-y-8">
          <section className="overflow-hidden rounded-[2rem] border border-stone-200/70 bg-white/82 shadow-[0_36px_90px_-48px_rgba(92,73,47,0.38)] backdrop-blur">
            <div className="px-4 py-5 sm:px-6 md:px-8 md:py-8">
              <div className="space-y-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="space-y-2">
                    <div className="inline-flex w-fit items-center gap-2 rounded-full border border-stone-200 bg-stone-50/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5 text-teal-700" />
                      {providerTypes.length ? `${providerTypes.length} workspace${providerTypes.length === 1 ? "" : "s"}` : "Assigned work"}
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl md:text-4xl">
                      Partner dashboard
                    </h1>
                    <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                      Manage listings, requests, and bookings in one place.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:min-w-[22rem]">
                    <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50/70 p-3">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-amber-900">Needs action</div>
                      <div className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">{actionableQueueCount}</div>
                    </div>
                    <div className="rounded-[1.25rem] border border-teal-200 bg-teal-50/70 p-3">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-teal-800">Listings</div>
                      <div className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">{assignedListingCount}</div>
                    </div>
                    <div className="rounded-[1.25rem] border border-sky-200 bg-sky-50/70 p-3">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-sky-800">Requests</div>
                      <div className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">{customRequestBookings.length}</div>
                    </div>
                    <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50/70 p-3">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Live</div>
                      <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{liveBookingCount}</div>
                    </div>
                  </div>
                </div>

                <TabsList className="grid h-auto grid-cols-2 gap-2 rounded-[1.5rem] border border-stone-200/70 bg-white/85 p-2 sm:grid-cols-4">
                  <TabsTrigger value="overview" className="min-h-11 rounded-[1rem] px-3 text-sm">
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="listings" className="min-h-11 rounded-[1rem] px-3 text-sm">
                    {listingsTabLabel}
                  </TabsTrigger>
                  <TabsTrigger value="custom-requests" className={cn("min-h-11 rounded-[1rem] px-3 text-sm", customRequestsTabTone)}>
                    {customRequestsTabLabel}
                  </TabsTrigger>
                  <TabsTrigger value="bookings" className={cn("min-h-11 rounded-[1rem] px-3 text-sm", bookingsTabTone)}>
                    {bookingsTabLabel}
                  </TabsTrigger>
                </TabsList>

                <div className="rounded-[1.5rem] border border-stone-200/70 bg-white/88 p-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={dashboardQuery}
                        onChange={(event) => setDashboardQuery(event.target.value)}
                        placeholder="Search dashboard"
                        className="h-11 rounded-full border-stone-200 bg-white pl-11"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant={!showOnlyActionable ? "default" : "outline"}
                        className="flex-1 rounded-full sm:flex-none"
                        onClick={() => setShowOnlyActionable(false)}
                      >
                        All
                      </Button>
                      <Button
                        type="button"
                        variant={showOnlyActionable ? "default" : "outline"}
                        className="flex-1 rounded-full sm:flex-none"
                        onClick={() => setShowOnlyActionable(true)}
                      >
                        Needs action
                      </Button>
                      {hasDashboardFilters ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="flex-1 rounded-full sm:flex-none"
                          onClick={() => {
                            setDashboardQuery("");
                            setShowOnlyActionable(false);
                          }}
                        >
                          Clear
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

            <TabsContent value="overview" className="space-y-8">
          <section className="space-y-4">
            <DashboardSectionHeader
              title="Overview"
            />
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
              <div className="space-y-6">
                <Card className="border-stone-200/70 bg-white/82 shadow-[0_20px_60px_-42px_rgba(92,73,47,0.34)]">
                  <CardHeader>
                    <CardTitle>Action queue</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50/70 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">Needs Follow-up</div>
                      <div className="mt-2 text-3xl font-semibold tracking-tight text-stone-950">{actionableQueueCount}</div>
                      <Button variant="outline" className="mt-4 w-full rounded-full bg-white/80 sm:w-auto" onClick={() => setActiveTab(customRequestBookings.length > 0 ? "custom-requests" : "bookings")}>
                        Open Queue
                      </Button>
                    </div>
                    <div className="rounded-[1.5rem] border border-teal-200 bg-teal-50/70 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-800">Listings To Update</div>
                      <div className="mt-2 text-3xl font-semibold tracking-tight text-stone-950">{underReviewListingCount}</div>
                      <Button variant="outline" className="mt-4 w-full rounded-full bg-white/80 sm:w-auto" onClick={() => setActiveTab("listings")}>
                        Open Listings
                      </Button>
                    </div>
                    <div className="rounded-[1.5rem] border border-sky-200 bg-sky-50/70 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-800">Custom Requests</div>
                      <div className="mt-2 text-3xl font-semibold tracking-tight text-stone-950">{customRequestBookings.length}</div>
                      <Button variant="outline" className="mt-4 w-full rounded-full bg-white/80 sm:w-auto" onClick={() => setActiveTab("custom-requests")}>
                        Review Requests
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-stone-200/70 bg-white/82 shadow-[0_20px_60px_-42px_rgba(92,73,47,0.34)]">
                  <CardHeader>
                    <CardTitle>Counts</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50/70 p-4"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Listings</div><div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{assignedListingCount}</div></div>
                    <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50/70 p-4"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Public</div><div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{publicListingCount}</div></div>
                    <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50/70 p-4"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Under Review</div><div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{underReviewListingCount}</div></div>
                    <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50/70 p-4"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Bookings</div><div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{allProviderBookings.length}</div></div>
                    <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50/70 p-4"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Requests</div><div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{requestCount}</div></div>
                    <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50/70 p-4"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Completed</div><div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{completedBookingCount}</div></div>
                  </CardContent>
                </Card>

                <Card className="border-stone-200/70 bg-white/82 shadow-[0_20px_60px_-42px_rgba(92,73,47,0.34)]">
                  <CardHeader>
                    <CardTitle>Performance</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50/70 p-4"><div className="flex items-center gap-2 text-amber-800"><Star className="h-4 w-4 fill-amber-400 text-amber-400" /><span className="text-xs font-semibold uppercase tracking-[0.18em]">Rating</span></div><div className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">{averageRating ? averageRating.toFixed(1) : "New"}</div><p className="mt-1 text-sm text-stone-600">{totalReviewCount ? `${totalReviewCount} review${totalReviewCount === 1 ? "" : "s"}` : "No reviews"}</p></div>
                    <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50/70 p-4"><div className="flex items-center gap-2 text-emerald-800"><Wallet className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-[0.18em]">Projected</span></div><div className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">{formatAmount(projectedNetEarnings)}</div></div>
                    <div className="rounded-[1.5rem] border border-teal-200 bg-teal-50/70 p-4"><div className="flex items-center gap-2 text-teal-800"><HandCoins className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-[0.18em]">Completed</span></div><div className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">{formatAmount(completedNetEarnings)}</div></div>
                    <div className="rounded-[1.5rem] border border-sky-200 bg-sky-50/70 p-4"><div className="flex items-center gap-2 text-sky-800"><CalendarClock className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-[0.18em]">Awaiting payout</span></div><div className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">{formatAmount(awaitingPayoutAmount)}</div></div>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card className="border-stone-200/70 bg-white/82 shadow-[0_20px_60px_-42px_rgba(92,73,47,0.34)]">
                  <CardHeader>
                    <CardTitle>Payments</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50/70 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Awaiting Payout</div>
                        <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatAmount(awaitingPayoutAmount)}</div>
                        <p className="mt-1 text-sm text-muted-foreground">{providerPaymentData?.unpaidPayoutCount ?? 0} open</p>
                      </div>
                      <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50/70 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Paid Out</div>
                        <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatAmount(paidOutAmount)}</div>
                        <p className="mt-1 text-sm text-muted-foreground">{providerPaymentData?.paidPayoutCount ?? 0} paid</p>
                      </div>
                      <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50/70 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Platform Service Fees</div>
                          </div>
                          <PlatformServiceFeeHint />
                        </div>
                        <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{platformServiceFeeRateLabel}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-stone-200/70 bg-white/82 shadow-[0_20px_60px_-42px_rgba(92,73,47,0.34)]">
                  <CardHeader>
                    <CardTitle>Profile</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-3 rounded-[1.5rem] border border-stone-200 bg-stone-50/70 p-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700"><UserRound className="h-5 w-5" /></div><div className="min-w-0"><div className="font-medium text-foreground">{[profileForm.firstName, profileForm.lastName].filter(Boolean).join(" ") || "Provider Account"}</div><div className="text-sm text-muted-foreground">Primary provider contact</div></div></div>
                    <div className="grid gap-3">
                      <Input value={profileForm.firstName} onChange={(event) => setProfileForm((current) => ({ ...current, firstName: event.target.value }))} placeholder="First name" />
                      <Input value={profileForm.lastName} onChange={(event) => setProfileForm((current) => ({ ...current, lastName: event.target.value }))} placeholder="Last name" />
                      <Input value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Phone number" />
                    </div>
                    <div className="space-y-2 rounded-[1.5rem] border border-stone-200 bg-stone-50/70 p-4 text-sm text-muted-foreground"><div className="flex items-start gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 break-all">{user?.email ?? "No email saved"}</span></div><div className="flex items-start gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{profileForm.phone || "No phone saved"}</span></div></div>
                    <Button onClick={() => updateProfileMutation.mutate(profileForm)} disabled={updateProfileMutation.isPending} className="w-full rounded-full">{updateProfileMutation.isPending ? "Saving..." : "Save Profile"}</Button>
                  </CardContent>
                </Card>

                <Card className="border-stone-200/70 bg-white/82 shadow-[0_20px_60px_-42px_rgba(92,73,47,0.34)]">
                  <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <CardTitle>Inbox</CardTitle>
                      </div>
                      <Button asChild variant="outline" className="rounded-full bg-white/80">
                        <Link href="/inbox">Open inbox</Link>
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50/70 p-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Unread</div>
                        <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{unreadNotificationCount}</div>
                      </div>
                      <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50/70 p-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Review</div>
                        <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{pendingReviewCount}</div>
                      </div>
                    </div>
                    <InboxCenter
                      mode="compact"
                      title=""
                      description=""
                      enabled={isProvider || isAdmin}
                      userRole={user?.role}
                    />
                    {user?.moderationNote ? (
                      <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50/70 p-4">
                        <div className="font-medium text-amber-900">Admin note</div>
                        <p className="mt-1 text-sm leading-6 text-amber-900/80">{user.moderationNote}</p>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </div>
          </section>
            </TabsContent>

            <TabsContent value="listings" className="space-y-8">
        <section className="space-y-4">
            <DashboardSectionHeader
              title="Listings"
            />
            {listingSectionLinks.length ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {listingSectionLinks.map((section) => (
                  <Button
                    key={section.id}
                    type="button"
                    variant="outline"
                    className="rounded-full whitespace-nowrap bg-white/80"
                    onClick={() => jumpToSection(section.id)}
                  >
                    {section.label} ({section.count})
                  </Button>
                ))}
              </div>
            ) : null}
          </section>

        {hasRole("stays") && (
        <Card id="provider-stays" className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)] scroll-mt-24">
          <CardHeader>
            <CardTitle>Assigned Stays</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-stretch sm:justify-end">
              <Button asChild className="w-full sm:w-auto">
                <Link href="/provider/stays/new">Add Stay</Link>
              </Button>
            </div>
            {visibleStays.length ? visibleStays.map((stay) => (
              <div key={stay.id} className="flex flex-col gap-4 rounded-[1.5rem] border border-stone-200/80 bg-stone-50/65 p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-medium">{stay.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {stay.location} • {stay.isPublic ? "Public" : "Private / Pending review"}
                  </div>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-3">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Management</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary" className="rounded-full">{formatAmount(stay.price)}/night</Badge>
                    <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                      <a href={`/provider/stays/${stay.id}/availability#availability`}>Lock days</a>
                    </Button>
                    <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                      <a href={`/provider/stays/${stay.id}/availability#pricing`}>Update price</a>
                    </Button>
                    <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                      <a href={`/provider/stays/${stay.id}/availability#media`}>Update photo</a>
                    </Button>
                    <ShareListingButton serviceType="stay" id={stay.id} title={stay.title} isPublic={stay.isPublic} />
                  </div>
                </div>
                <Button asChild className="w-full rounded-full md:min-w-48 md:w-auto">
                  <Link href={`/provider/stays/${stay.id}/availability`}>Open Stay Manager</Link>
                </Button>
              </div>
            )) : <p className="text-sm text-muted-foreground">No stays assigned yet.</p>}
          </CardContent>
        </Card>
        )}

        <div className="grid gap-6 xl:grid-cols-2">
          {hasRole("cars") && (
          <Card id="provider-cars" className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)] scroll-mt-24">
            <CardHeader>
              <CardTitle>Cars</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-stretch sm:justify-end">
                <Button asChild className="w-full sm:w-auto">
                  <Link href="/provider/cars/new">Add Car</Link>
                </Button>
              </div>
              {visibleCars.length ? visibleCars.map((car) => (
                <div key={car.id} className="space-y-3 rounded-[1.5rem] border border-stone-200/80 bg-stone-50/65 p-5">
                  <div className="font-medium">{car.model}</div>
                  <div className="text-sm text-muted-foreground">
                    {car.location} • {car.isPublic ? "Public" : "Private / Pending review"}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{formatAmount(car.priceWithDriver)}/day chauffeur</Badge>
                    {car.priceWithDriverHourly && <Badge variant="outline">{formatAmount(car.priceWithDriverHourly)}/hour</Badge>}
                    {car.pricePerDay && <Badge variant="outline">{formatAmount(car.pricePerDay)}/day self-drive</Badge>}
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-3">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Management</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                        <a href={`/provider/cars/${car.id}/availability#availability`}>Lock days</a>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                        <a href={`/provider/cars/${car.id}/availability#pricing`}>Update pricing</a>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                        <a href={`/provider/cars/${car.id}/availability#media`}>Update photos</a>
                      </Button>
                      <ShareListingButton serviceType="car" id={car.id} title={car.model} isPublic={car.isPublic} />
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm" className="w-full rounded-full sm:w-auto">
                    <Link href={`/provider/cars/${car.id}/availability`}>Open Car Manager</Link>
                  </Button>
                </div>
              )) : <p className="text-sm text-muted-foreground">No cars assigned yet.</p>}
            </CardContent>
          </Card>
          )}
          {hasRole("cooks") && (
          <Card id="provider-cooks" className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)] scroll-mt-24">
            <CardHeader>
              <CardTitle>Chefs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-stretch sm:justify-end">
                <Button asChild className="w-full sm:w-auto">
                  <Link href="/provider/cooks/new">Add Chef</Link>
                </Button>
              </div>
              {visibleCooks.length ? visibleCooks.map((cook) => (
                <div key={cook.id} className="space-y-3 rounded-[1.5rem] border border-stone-200/80 bg-stone-50/65 p-5">
                  <div className="font-medium">{cook.serviceType} by {cook.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {cook.location} • {cook.speciality} • base day package for {getCookMinimumGuests(cook)} guests • {cook.isPublic ? "Public" : "Private / Pending review"}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{formatAmount(cook.serviceFee || cook.pricePerSession)} base service fee / day</Badge>
                    <Badge variant="outline">{formatAmount(cook.inclusivePrice || cook.serviceFee || cook.pricePerSession)} base all inclusive / day</Badge>
                    <Badge variant="outline">{formatAmount(getCookExtraGuestServiceFee(cook))} extra guest / day</Badge>
                    <Badge variant="outline">{formatAmount(getCookExtraGuestInclusivePrice(cook))} extra inclusive guest / day</Badge>
                    {cook.customMenuEnabled ? <Badge variant="outline">{formatAmount(cook.customMenuRequestFee || 4)} custom review fee</Badge> : null}
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-3">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Management</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                        <a href={`/provider/cooks/${cook.id}/edit#availability`}>Lock days</a>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                        <a href={`/provider/cooks/${cook.id}/edit#pricing`}>Update pricing</a>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                        <a href={`/provider/cooks/${cook.id}/edit#media`}>Update photos</a>
                      </Button>
                      <ShareListingButton serviceType="cook" id={cook.id} title={`${cook.serviceType} by ${cook.title}`} isPublic={cook.isPublic} />
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm" className="w-full rounded-full sm:w-auto">
                    <Link href={`/provider/cooks/${cook.id}/edit`}>Open Chef Manager</Link>
                  </Button>
                </div>
              )) : <p className="text-sm text-muted-foreground">No chefs assigned yet.</p>}
            </CardContent>
          </Card>
          )}
          {hasRole("errands") && (
          <Card id="provider-errands" className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)] scroll-mt-24">
            <CardHeader>
              <CardTitle>Errands</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-stretch sm:justify-end">
                <Button asChild className="w-full sm:w-auto">
                  <Link href="/provider/errands/new">Add Errand</Link>
                </Button>
              </div>
              {visibleErrands.length ? visibleErrands.map((errand) => (
                <div key={errand.id} className="space-y-3 rounded-[1.5rem] border border-stone-200/80 bg-stone-50/65 p-5">
                  <div className="font-medium">{errand.serviceName}</div>
                  <div className="text-sm text-muted-foreground">
                    {errand.location ? `${errand.location} • ` : ""}
                    {errand.isPublic ? "Public" : "Private / Pending review"}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {hasHelpMamaPricing(errand)
                        ? `From ${formatAmount(getHelpMamaStartingPrice(errand.helpMamaPricing))}`
                        : `${formatAmount(errand.basePrice)} base`}
                    </Badge>
                    {errand.shoppingEnabled ? <Badge variant="outline">shopping + {errand.shoppingCommissionPercent}%</Badge> : null}
                    {errand.laundryEnabled ? <Badge variant="outline">laundry + {(errand.laundryAddons || []).length} add-ons</Badge> : null}
                    {errand.houseCleaningEnabled ? <Badge variant="outline">cleaning + {(errand.houseCleaningAddons || []).length} add-ons</Badge> : null}
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-3">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Management</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                        <a href={`/provider/errands/${errand.id}/edit#pricing`}>Update pricing</a>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                        <a href={`/provider/errands/${errand.id}/edit#media`}>Update photos</a>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                        <Link href={`/provider/errands/${errand.id}/edit`}>Adjust add-ons</Link>
                      </Button>
                      <ShareListingButton serviceType="errand" id={errand.id} title={errand.serviceName} isPublic={errand.isPublic} />
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm" className="w-full rounded-full sm:w-auto">
                    <Link href={`/provider/errands/${errand.id}/edit`}>Open Errand Manager</Link>
                  </Button>
                </div>
              )) : <p className="text-sm text-muted-foreground">No errands assigned yet.</p>}
            </CardContent>
          </Card>
          )}
          {hasRole("experiences") && (
          <Card id="provider-experiences" className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)] scroll-mt-24">
            <CardHeader>
              <CardTitle>Experiences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-stretch sm:justify-end">
                <Button asChild className="w-full sm:w-auto">
                  <Link href="/provider/experiences/new">Add Experience</Link>
                </Button>
              </div>
              {visibleExperiences.length ? visibleExperiences.map((experience) => (
                <div key={experience.id} className="space-y-3 rounded-[1.5rem] border border-stone-200/80 bg-stone-50/65 p-5">
                  <div className="font-medium">{experience.title}</div>
                  <div className="text-sm text-muted-foreground">
                    Based in {experience.location || "Not set"} • {experience.experienceLocation || "Destination not set"} • {experience.experienceType} • {experience.isPublic ? "Public" : "Private / Pending review"}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {experience.privateEnabled ? <Badge variant="outline">Private from {formatAmount(experience.privatePricePerPerson)}/person</Badge> : null}
                    {experience.sharedEnabled ? <Badge variant="outline">Shared from {formatAmount(experience.sharedPricePerPerson)}/person</Badge> : null}
                    <Badge variant="outline">{experience.durationHours}h</Badge>
                    <Badge variant="outline">Up to {experience.maxGuests} private guests</Badge>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-3">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Management</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                        <a href={`/provider/experiences/${experience.id}/edit#pricing`}>Update pricing</a>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                        <a href={`/provider/experiences/${experience.id}/edit#media`}>Update photos</a>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="rounded-full bg-white/80">
                        <Link href={`/provider/experiences/${experience.id}/edit`}>Adjust guest settings</Link>
                      </Button>
                      <ShareListingButton serviceType="experience" id={experience.id} title={experience.title} isPublic={experience.isPublic} />
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm" className="w-full rounded-full sm:w-auto">
                    <Link href={`/provider/experiences/${experience.id}/edit`}>Open Experience Manager</Link>
                  </Button>
                </div>
              )) : <p className="text-sm text-muted-foreground">No experiences assigned yet.</p>}
            </CardContent>
          </Card>
          )}
        </div>

            </TabsContent>

            <TabsContent value="custom-requests" className="space-y-8">
        <section id="provider-custom-requests" className="space-y-4 scroll-mt-24">
          <DashboardSectionHeader
            title="Custom requests"
          />
        </section>

        {false && customRequestBookings.length ? (
          <Card className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)]">
            <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="font-medium text-foreground">{customRequestBookings.length} custom request{customRequestBookings.length === 1 ? "" : "s"} still need tracking</div>
                <p className="text-sm text-muted-foreground">
                  Keep booking operations focused here, and use the dedicated custom requests tab for the quote queue.
                </p>
              </div>
              <Button type="button" variant="outline" className="w-full rounded-full sm:w-auto" onClick={() => setActiveTab("custom-requests")}>
                Open Custom Requests
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {false && customRequestBookings.length ? (
          <Card className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)]">
            <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="font-medium text-foreground">{customRequestBookings.length} custom request{customRequestBookings.length === 1 ? "" : "s"} still need tracking</div>
                <p className="text-sm text-muted-foreground">
                  Keep booking operations focused here, and use the dedicated custom requests tab for the quote queue.
                </p>
              </div>
              <Button type="button" variant="outline" className="w-full rounded-full sm:w-auto" onClick={() => setActiveTab("custom-requests")}>
                Open Custom Requests
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {false && customRequestBookings.length ? (
          <Card className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)]">
            <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="font-medium text-foreground">{customRequestBookings.length} custom request{customRequestBookings.length === 1 ? "" : "s"} still need tracking</div>
                <p className="text-sm text-muted-foreground">
                  Keep booking operations focused here, and use the dedicated custom requests tab for the quote queue.
                </p>
              </div>
              <Button type="button" variant="outline" className="w-full rounded-full sm:w-auto" onClick={() => setActiveTab("custom-requests")}>
                Open Custom Requests
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {false && customRequestBookings.length ? (
          <Card className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)]">
            <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="font-medium text-foreground">{customRequestBookings.length} custom request{customRequestBookings.length === 1 ? "" : "s"} still need tracking</div>
                <p className="text-sm text-muted-foreground">
                  Keep booking operations focused here, and use the dedicated custom requests tab for the quote queue.
                </p>
              </div>
              <Button type="button" variant="outline" className="w-full rounded-full sm:w-auto" onClick={() => setActiveTab("custom-requests")}>
                Open Custom Requests
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {customRequestBookings.length ? (
          <Card className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)]">
            <CardHeader>
              <CardTitle>Custom Requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[1.15rem] border border-stone-200/80 bg-stone-50/70 p-3">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Needs Quote</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{partnerPendingCustomRequestCount}</div>
                </div>
                <div className="rounded-[1.15rem] border border-stone-200/80 bg-stone-50/70 p-3">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Waiting Admin</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{adminPendingCustomRequestCount}</div>
                </div>
                <div className="rounded-[1.15rem] border border-stone-200/80 bg-stone-50/70 p-3">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Waiting Client</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{clientPendingCustomRequestCount}</div>
                </div>
              </div>
              {customRequestBookings.map((booking) => {
                const label = getCustomRequestLabel(booking);
                const serviceLocation = booking.assignment.serviceConfig.serviceLocation;
                const serviceRequestDetails = booking.assignment.serviceConfig.serviceRequestDetails;
                return (
                  <div key={`custom-request-${booking.assignment.id}`} className="rounded-[1.25rem] border border-stone-200/80 bg-stone-50/70 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-teal-700">{label} #{getShortBookingReference(booking.booking.id)}</div>
                        <div className="text-sm text-muted-foreground">
                          {booking.booking.guestName}
                          {serviceLocation ? ` • ${serviceLocation}` : ""}
                          {booking.booking.checkIn ? ` • ${booking.booking.checkIn}` : ""}
                        </div>
                        <p className="max-w-3xl text-sm leading-6 text-stone-700">{getRequestPreview(serviceRequestDetails)}</p>
                      </div>
                      <div className="flex flex-col items-start gap-2 md:items-end">
                        <Badge variant="secondary">{getCustomRequestQueueLabel(booking)}</Badge>
                        {getAssignmentServiceMode(booking) === "cook-custom-menu"
                          ? getCustomMenuWorkflowBadge(booking)
                          : getExperienceWorkflowBadge(booking)}
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full rounded-full bg-white/85 sm:w-auto"
                          onClick={() => openCustomRequestWorkspace(booking.assignment.id)}
                        >
                          Open workspace
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)]">
            <CardContent className="py-10 text-sm text-muted-foreground">
              {hasDashboardFilters ? "No custom requests match the current filters." : "No custom requests are waiting right now."}
            </CardContent>
          </Card>
        )}
            </TabsContent>

            <TabsContent value="bookings" className="space-y-8">
        <section id="provider-bookings" className="space-y-4 scroll-mt-24">
          <DashboardSectionHeader
            title="Bookings"
          />
          {bookingSectionLinks.length ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {bookingSectionLinks.map((section) => (
                <Button
                  key={section.id}
                  type="button"
                  variant="outline"
                  className="rounded-full whitespace-nowrap bg-white/80"
                  onClick={() => jumpToSection(section.id)}
                >
                  {section.label} ({section.count})
                </Button>
              ))}
            </div>
          ) : null}
        </section>

        {false && customRequestBookings.length ? (
          <Card className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)]">
            <CardHeader>
              <CardTitle>Custom Requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[1.15rem] border border-stone-200/80 bg-stone-50/70 p-3">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Needs Quote</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{partnerPendingCustomRequestCount}</div>
                </div>
                <div className="rounded-[1.15rem] border border-stone-200/80 bg-stone-50/70 p-3">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Waiting Admin</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{adminPendingCustomRequestCount}</div>
                </div>
                <div className="rounded-[1.15rem] border border-stone-200/80 bg-stone-50/70 p-3">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Waiting Client</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{clientPendingCustomRequestCount}</div>
                </div>
              </div>
              {customRequestBookings.map((booking) => {
                const label = getCustomRequestLabel(booking);
                const serviceLocation = booking.assignment.serviceConfig.serviceLocation;
                const serviceRequestDetails = booking.assignment.serviceConfig.serviceRequestDetails;
                const destination = `#partner-assignment-${booking.assignment.id}`;
                return (
                  <div key={`custom-request-${booking.assignment.id}`} className="rounded-[1.25rem] border border-stone-200/80 bg-stone-50/70 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-teal-700">{label} #{getShortBookingReference(booking.booking.id)}</div>
                        <div className="text-sm text-muted-foreground">
                          {booking.booking.guestName}
                          {serviceLocation ? ` • ${serviceLocation}` : ""}
                          {booking.booking.checkIn ? ` • ${booking.booking.checkIn}` : ""}
                        </div>
                        <p className="max-w-3xl text-sm leading-6 text-stone-700">{getRequestPreview(serviceRequestDetails)}</p>
                      </div>
                      <div className="flex flex-col items-start gap-2 md:items-end">
                        <Badge variant="secondary">{getCustomRequestQueueLabel(booking)}</Badge>
                        {getAssignmentServiceMode(booking) === "cook-custom-menu"
                          ? getCustomMenuWorkflowBadge(booking)
                          : getExperienceWorkflowBadge(booking)}
                        <a href={destination} className="text-sm font-medium text-teal-700 underline-offset-4 hover:underline">
                          Open details
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : null}

        {hasRole("stays") && (
          <Card id="provider-stay-bookings" className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)]">
            <CardHeader>
              <CardTitle>Stay Bookings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {visibleStayBookings.length ? visibleStayBookings.map((booking, index) => {
                const stay = data?.stays?.find((item) => item.id === booking.assignment.serviceId);
                const dashboardStatus = getDashboardAssignmentStatus(booking);
                const statusAction = getNextProgressAction(dashboardStatus);
                const bookedOnLabel = getBookedOnLabel(booking);
                const isOpen = isAssignmentExpanded(booking.assignment.id);
                return (
                  <div key={booking.assignment.id} className="space-y-3" id={`partner-assignment-${booking.assignment.id}`}>
                    {shouldShowArchiveHeading(visibleStayBookings, index) ? (
                      <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                        Archived orders
                      </div>
                    ) : null}
                    <ProviderOrderCollapsible
                      assignmentId={booking.assignment.id}
                      open={isOpen}
                      onOpenChange={(open) => setAssignmentExpanded(booking.assignment.id, open)}
                      archived={isArchivedBookingStatus(dashboardStatus)}
                      title={stay?.title ?? "Stay booking"}
                      summary={joinMeta([
                        booking.booking.guestName,
                        stay?.location,
                        `Ref ${getShortBookingReference(booking.booking.id)}`,
                      ])}
                      detail={joinMeta([
                        getAssignmentDateRange(booking),
                        bookedOnLabel ? `Booked ${bookedOnLabel}` : null,
                      ])}
                      statusContent={<Badge variant="outline" className="rounded-full">{getProgressStatusLabel(dashboardStatus)}</Badge>}
                    >
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Stay Dates</div>
                          <div className="mt-2 text-sm font-medium text-foreground">{getAssignmentDateRange(booking) ?? "Pending"}</div>
                        </div>
                        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Booked On</div>
                          <div className="mt-2 text-sm font-medium text-foreground">{bookedOnLabel ?? "Not captured"}</div>
                        </div>
                        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Guests</div>
                          <div className="mt-2 text-sm font-medium text-foreground">
                            {booking.booking.guests} guest{booking.booking.guests === 1 ? "" : "s"}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Status</div>
                          <div className="mt-2 text-sm font-medium text-foreground">{getProgressStatusLabel(dashboardStatus)}</div>
                        </div>
                      </div>
                      <BookingThread
                        bookingId={booking.booking.id}
                        title="Booking Chat"
                        composerPlaceholder="Reply inside this booking thread..."
                        defaultOpen={dashboardIntent.openThread && dashboardIntent.bookingId === booking.booking.id}
                      />

                      {statusAction ? (
                        <Button
                          variant="outline"
                          className="w-full rounded-full lg:w-auto"
                          onClick={() => updateProviderBookingStatus.mutate({ id: booking.assignment.id, status: statusAction.status })}
                          disabled={updateProviderBookingStatus.isPending}
                        >
                          {activeStatusBookingId === booking.assignment.id ? "Updating..." : statusAction.label}
                        </Button>
                      ) : null}
                    </ProviderOrderCollapsible>
                  </div>
                );
              }) : <p className="text-sm text-muted-foreground">No stay bookings yet.</p>}
            </CardContent>
          </Card>
        )}

        {hasRole("cars") && (
          <Card id="provider-car-bookings" className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)]">
            <CardHeader>
              <CardTitle>Car Bookings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {visibleCarBookings.length ? visibleCarBookings.map((booking, index) => {
                const car = data?.cars?.find((item) => item.id === booking.assignment.serviceId);
                const dashboardStatus = getDashboardAssignmentStatus(booking);
                const statusAction = isConfirmedOrderBooking(booking) ? getNextProgressAction(dashboardStatus) : null;
                const isOpen = isAssignmentExpanded(booking.assignment.id);
                return (
                  <div key={booking.assignment.id} className="space-y-3" id={`partner-assignment-${booking.assignment.id}`}>
                    {shouldShowArchiveHeading(visibleCarBookings, index) ? (
                      <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                        Archived orders
                      </div>
                    ) : null}
                    <ProviderOrderCollapsible
                      assignmentId={booking.assignment.id}
                      open={isOpen}
                      onOpenChange={(open) => setAssignmentExpanded(booking.assignment.id, open)}
                      archived={isArchivedBookingStatus(dashboardStatus)}
                      title={car?.model ?? "Car booking"}
                      summary={joinMeta([
                        booking.booking.guestName,
                        getAssignmentDateRange(booking),
                        getAssignmentLocation(booking),
                        getAssignmentPickupLocation(booking) ? `Pickup ${getAssignmentPickupLocation(booking)}` : null,
                        getAssignmentReturnLocation(booking) ? `Return ${getAssignmentReturnLocation(booking)}` : null,
                        booking.assignment.serviceConfig.serviceZone ? `Zone ${booking.assignment.serviceConfig.serviceZone}` : null,
                      ])}
                      detail={getCarModeSummary(booking)}
                      statusContent={<Badge variant="outline">{getProgressStatusLabel(dashboardStatus)}</Badge>}
                    >
                      <BookingThread
                        bookingId={booking.booking.id}
                        title="Booking Chat"
                        initialMessage={getAssignmentRequestDetails(booking)}
                        initialMessageLabel={getBookingThreadInitialLabel(booking)}
                        composerPlaceholder="Reply inside this booking thread..."
                        defaultOpen={dashboardIntent.openThread && dashboardIntent.bookingId === booking.booking.id}
                      />
                      {statusAction ? (
                        <Button
                          variant="outline"
                          className="w-full md:w-56"
                          onClick={() => updateProviderBookingStatus.mutate({ id: booking.assignment.id, status: statusAction.status })}
                          disabled={updateProviderBookingStatus.isPending}
                        >
                          {activeStatusBookingId === booking.assignment.id ? "Updating..." : statusAction.label}
                        </Button>
                      ) : null}
                    </ProviderOrderCollapsible>
                  </div>
                );
              }) : <p className="text-sm text-muted-foreground">No car bookings yet.</p>}
            </CardContent>
          </Card>
        )}

        {hasRole("cooks") && (
          <Card id="provider-cook-bookings" className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)]">
            <CardHeader>
              <CardTitle>Chef Bookings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {bookingTabCookBookings.length ? bookingTabCookBookings.map((booking, index) => {
                const cook = data?.cooks?.find((item) => item.id === booking.assignment.serviceId);
                const dashboardStatus = getDashboardAssignmentStatus(booking);
                const statusAction = isConfirmedOrderBooking(booking) ? getNextProgressAction(dashboardStatus) : null;
                const isOpen = isAssignmentExpanded(booking.assignment.id);
                return (
                  <div key={booking.assignment.id} className="space-y-3" id={`partner-assignment-${booking.assignment.id}`}>
                    {shouldShowArchiveHeading(bookingTabCookBookings, index) ? (
                      <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                        Archived orders
                      </div>
                    ) : null}
                    <ProviderOrderCollapsible
                      assignmentId={booking.assignment.id}
                      open={isOpen}
                      onOpenChange={(open) => setAssignmentExpanded(booking.assignment.id, open)}
                      archived={isArchivedBookingStatus(dashboardStatus)}
                      title={cook?.title ?? "Chef booking"}
                      summary={joinMeta([
                        booking.booking.guestName,
                        getAssignmentDateRange(booking),
                        getAssignmentLocation(booking),
                        getAssignmentGuests(booking) ? `${getAssignmentGuests(booking)} guest${getAssignmentGuests(booking) === 1 ? "" : "s"}` : null,
                      ])}
                      detail={getCookBookingLabel(booking)}
                      statusContent={getPrimaryBookingStatusBadge(booking)}
                    >
                    <div>
                      {getAssignmentRequestDetails(booking) ? (
                        <RequestBriefAccordion
                          id={`partner-cook-brief-${booking.assignment.id}`}
                          title={`Custom Menu #${getShortBookingReference(booking.booking.id)}`}
                          summary={getRequestPreview(getAssignmentRequestDetails(booking))}
                          content={getAssignmentRequestDetails(booking) ?? ""}
                          accent="amber"
                          className="mt-3"
                        />
                      ) : null}
                      {getAssignmentServiceMode(booking) === "cook-custom-menu" ? (
                        <div className="mt-3 rounded-lg border p-3 space-y-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-sm font-medium">Quote Review</div>
                            {getCustomMenuWorkflowBadge(booking)}
                          </div>
                          {booking.booking.customMenuProposalStatus === "proposed" && booking.booking.customMenuProposedAmount ? (
                            <div className="text-sm text-muted-foreground">
                              Quote sent: <span className="font-medium text-foreground">{formatAmount(booking.booking.customMenuProposedAmount)}</span>
                              {booking.booking.customMenuProposalMessage ? ` • ${booking.booking.customMenuProposalMessage}` : ""}
                            </div>
                          ) : null}
                          {booking.booking.customMenuProposalStatus === "pending-admin-approval" ? (
                            <div className="text-sm text-muted-foreground">
                              {booking.booking.customMenuProposedAmount
                                ? <>Submitted quote: <span className="font-medium text-foreground">{formatAmount(booking.booking.customMenuProposedAmount)}</span>{booking.booking.customMenuProposalMessage ? ` • ${booking.booking.customMenuProposalMessage}` : ""}</>
                                : booking.booking.customMenuDeclineReason
                                  ? <>Submitted decline reason: {booking.booking.customMenuDeclineReason}</>
                                  : "Submitted, waiting for confirmation."}
                            </div>
                          ) : null}
                          {booking.booking.customMenuProposalStatus === "declined" && booking.booking.customMenuDeclineReason ? (
                            <div className="text-sm text-muted-foreground">
                              Decline reason: {booking.booking.customMenuDeclineReason}
                            </div>
                          ) : null}
                          {isFinalizedAssignmentBooking(booking) ? (
                            <div className="text-sm text-muted-foreground rounded-md bg-muted/40 p-3">
                              {booking.booking.status === "cancelled"
                                ? "This booking was cancelled by admin. Custom menu actions are now locked."
                                : "This booking was marked completed by admin. Custom menu actions are now locked."}
                            </div>
                          ) : isClosedCustomMenu(booking) ? (
                            <div className="text-sm text-muted-foreground rounded-md bg-muted/40 p-3">
                              This custom menu offer has been accepted by the customer and is now closed for editing.
                            </div>
                          ) : null}
                          {!isFinalizedAssignmentBooking(booking) && !isClosedCustomMenu(booking) && booking.booking.customMenuProposalStatus === "pending" ? <Input
                            type="number"
                            min="1"
                            placeholder={`Quoted total (${selectedCurrency})`}
                            value={proposalAmounts[booking.assignment.id] ?? ""}
                            onChange={(e) => setProposalAmounts((current) => ({ ...current, [booking.assignment.id]: e.target.value }))}
                          /> : null}
                          {!isFinalizedAssignmentBooking(booking) && !isClosedCustomMenu(booking) && booking.booking.customMenuProposalStatus === "pending" ? <Textarea
                            rows={3}
                            placeholder="Quote note or decline reason"
                            value={proposalMessages[booking.assignment.id] ?? booking.booking.customMenuProposalMessage ?? declineReasons[booking.assignment.id] ?? booking.booking.customMenuDeclineReason ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              setProposalMessages((current) => ({ ...current, [booking.assignment.id]: value }));
                              setDeclineReasons((current) => ({ ...current, [booking.assignment.id]: value }));
                            }}
                          /> : null}
                          {!isFinalizedAssignmentBooking(booking) && !isClosedCustomMenu(booking) && booking.booking.customMenuProposalStatus === "pending" ? <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              variant="outline"
                              className="w-full sm:w-auto"
                              disabled={reviewCookBookingMutation.isPending}
                              onClick={() => reviewCookBookingMutation.mutate({
                                assignmentId: booking.assignment.id,
                                payload: {
                                  action: "propose",
                                  proposedAmount: getSubmittedProposalAmountUsd(
                                    proposalAmounts[booking.assignment.id],
                                    booking.booking.customMenuProposedAmount,
                                  ),
                                  proposalMessage: proposalMessages[booking.assignment.id] ?? booking.booking.customMenuProposalMessage ?? "",
                                },
                              })}
                            >
                              {activeCustomMenuBookingId === booking.assignment.id ? "Sending..." : "Send Quote"}
                            </Button>
                            <Button
                              variant="destructive"
                              className="w-full sm:w-auto"
                              disabled={reviewCookBookingMutation.isPending}
                              onClick={() => reviewCookBookingMutation.mutate({
                                assignmentId: booking.assignment.id,
                                payload: {
                                  action: "decline",
                                  declineReason: declineReasons[booking.assignment.id] ?? proposalMessages[booking.assignment.id] ?? booking.booking.customMenuDeclineReason ?? "",
                                },
                              })}
                            >
                              {activeCustomMenuBookingId === booking.assignment.id ? "Sending..." : "Send Decline"}
                            </Button>
                          </div> : null}
                        </div>
                      ) : null}
                    </div>
                      <BookingThread
                        bookingId={booking.booking.id}
                        title="Booking Chat"
                        initialMessage={getAssignmentRequestDetails(booking)}
                        initialMessageLabel={getBookingThreadInitialLabel(booking)}
                        composerPlaceholder="Reply inside this booking thread..."
                        defaultOpen={dashboardIntent.openThread && dashboardIntent.bookingId === booking.booking.id}
                      />
                      {statusAction ? (
                        <Button
                          variant="outline"
                          className="w-full md:w-56"
                          onClick={() => updateProviderBookingStatus.mutate({ id: booking.assignment.id, status: statusAction.status })}
                          disabled={updateProviderBookingStatus.isPending}
                        >
                          {activeStatusBookingId === booking.assignment.id ? "Updating..." : statusAction.label}
                        </Button>
                      ) : null}
                    </ProviderOrderCollapsible>
                  </div>
                );
              }) : <p className="text-sm text-muted-foreground">No chef bookings yet.</p>}
            </CardContent>
          </Card>
        )}

        {hasRole("errands") && (
          <Card id="provider-errand-bookings" className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)]">
            <CardHeader>
              <CardTitle>Errand Bookings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {visibleErrandBookings.length ? visibleErrandBookings.map((booking, index) => {
                const errand = data?.errands?.find((item) => item.id === booking.assignment.serviceId);
                const dashboardStatus = getDashboardAssignmentStatus(booking);
                const statusAction = getNextProgressAction(dashboardStatus);
                const isOpen = isAssignmentExpanded(booking.assignment.id);
                return (
                  <div key={booking.assignment.id} className="space-y-3" id={`partner-assignment-${booking.assignment.id}`}>
                    {shouldShowArchiveHeading(visibleErrandBookings, index) ? (
                      <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                        Archived orders
                      </div>
                    ) : null}
                    <ProviderOrderCollapsible
                      assignmentId={booking.assignment.id}
                      open={isOpen}
                      onOpenChange={(open) => setAssignmentExpanded(booking.assignment.id, open)}
                      archived={isArchivedBookingStatus(dashboardStatus)}
                      title={errand?.serviceName ?? "Errand booking"}
                      summary={joinMeta([
                        booking.booking.guestName,
                        getAssignmentLocation(booking),
                      ])}
                      detail={getAssignmentScheduleSlots(booking).length
                        ? `${getAssignmentScheduleSlots(booking).length} scheduled stop${getAssignmentScheduleSlots(booking).length === 1 ? "" : "s"}`
                        : null}
                      statusContent={<Badge variant="outline">{getProgressStatusLabel(dashboardStatus)}</Badge>}
                    >
                    {getAssignmentScheduleSlots(booking).length ? (
                      <div className="space-y-1 text-sm text-muted-foreground">
                        {getAssignmentScheduleSlots(booking).map((slot, index) => (
                          <div key={`${slot.date}-${slot.note}-${index}`}>
                            {slot.date}{slot.note?.trim() ? ` - ${slot.note.trim()}` : ""}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {getAssignmentServiceMode(booking) === "errand-shopping" && getAssignmentBudgetAmount(booking) ? (
                      <div className="text-sm text-muted-foreground">
                        Shopping budget: <span className="font-medium text-foreground">{formatAmount(getAssignmentBudgetAmount(booking) ?? 0)}</span>
                      </div>
                    ) : null}
                      <BookingThread
                        bookingId={booking.booking.id}
                        title="Booking Chat"
                        initialMessage={getAssignmentRequestDetails(booking)}
                        initialMessageLabel={getBookingThreadInitialLabel(booking)}
                        composerPlaceholder="Reply inside this request thread..."
                        defaultOpen={dashboardIntent.openThread && dashboardIntent.bookingId === booking.booking.id}
                      />
                      {statusAction ? (
                        <Button
                          variant="outline"
                          className="w-full md:w-56"
                          onClick={() => updateProviderBookingStatus.mutate({ id: booking.assignment.id, status: statusAction.status })}
                          disabled={updateProviderBookingStatus.isPending}
                        >
                          {activeStatusBookingId === booking.assignment.id ? "Updating..." : statusAction.label}
                        </Button>
                      ) : null}
                    </ProviderOrderCollapsible>
                  </div>
                );
              }) : <p className="text-sm text-muted-foreground">No errand bookings yet.</p>}
            </CardContent>
          </Card>
        )}

        {hasRole("experiences") && (
          <Card id="provider-experience-bookings" className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)]">
            <CardHeader>
              <CardTitle>Experience Bookings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {bookingTabExperienceBookings.length ? bookingTabExperienceBookings.map((booking, index) => {
                const experience = data?.experiences?.find((item) => item.id === booking.assignment.serviceId);
                const dashboardStatus = getDashboardAssignmentStatus(booking);
                const statusAction = isConfirmedOrderBooking(booking) ? getNextProgressAction(dashboardStatus) : null;
                const isOpen = isAssignmentExpanded(booking.assignment.id);
                return (
                  <div key={booking.assignment.id} className="space-y-3" id={`partner-assignment-${booking.assignment.id}`}>
                    {shouldShowArchiveHeading(bookingTabExperienceBookings, index) ? (
                      <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                        Archived orders
                      </div>
                    ) : null}
                    <ProviderOrderCollapsible
                      assignmentId={booking.assignment.id}
                      open={isOpen}
                      onOpenChange={(open) => setAssignmentExpanded(booking.assignment.id, open)}
                      archived={isArchivedBookingStatus(dashboardStatus)}
                      title={experience?.title ?? "Experience booking"}
                      summary={joinMeta([
                        booking.booking.guestName,
                        getAssignmentDateRange(booking),
                        getAssignmentLocation(booking),
                        getAssignmentGuests(booking) ? `${getAssignmentGuests(booking)} guest${getAssignmentGuests(booking) === 1 ? "" : "s"}` : null,
                      ])}
                      detail={getAssignmentServiceMode(booking) === "experience-custom-offer" ? "Custom offer request" : null}
                      statusContent={getPrimaryBookingStatusBadge(booking)}
                    >
                    <div>
                      {getAssignmentRequestDetails(booking) ? (
                        <RequestBriefAccordion
                          id={`partner-experience-brief-${booking.assignment.id}`}
                          title={`Request Brief #${getShortBookingReference(booking.booking.id)}`}
                          summary={getRequestPreview(getAssignmentRequestDetails(booking))}
                          content={getAssignmentRequestDetails(booking) ?? ""}
                          accent="sky"
                          className="mt-0"
                        />
                      ) : null}
                    </div>
                    {getAssignmentServiceMode(booking) === "experience-custom-offer" ? (
                      <div className="rounded-lg border p-3 space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="space-y-1">
                            <div className="text-sm font-medium">Offer Review</div>
                            <div className="text-xs text-muted-foreground">{getExperienceOfferStatusText(booking)}</div>
                          </div>
                          {getExperienceWorkflowBadge(booking)}
                        </div>
                        {booking.booking.experienceCustomOfferAmount ? (
                          <div className="rounded-md bg-muted/40 p-3">
                            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              {booking.booking.experienceCustomOfferStatus === "pending-admin-approval" ? "Submitted Offer" : "Offer Total"}
                            </div>
                            <div className="mt-1 text-sm font-medium text-foreground">{formatAmount(booking.booking.experienceCustomOfferAmount)}</div>
                          </div>
                        ) : null}
                        {booking.booking.experienceCustomOfferMessage ? (
                          <div className="rounded-md bg-muted/40 p-3">
                            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Offer Note</div>
                            <div className="mt-1 text-sm text-muted-foreground">{booking.booking.experienceCustomOfferMessage}</div>
                          </div>
                        ) : null}
                        {booking.booking.experienceCustomOfferDeclineReason ? (
                          <div className="rounded-md bg-muted/40 p-3">
                            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Decline Reason</div>
                            <div className="mt-1 text-sm text-muted-foreground">{booking.booking.experienceCustomOfferDeclineReason}</div>
                          </div>
                        ) : null}
                        {false && booking.booking.experienceCustomOfferStatus === "proposed" && booking.booking.experienceCustomOfferAmount ? (
                          <div className="text-sm text-muted-foreground">
                            Offer sent: <span className="font-medium text-foreground">{formatAmount(booking.booking.experienceCustomOfferAmount ?? 0)}</span>
                            {booking.booking.experienceCustomOfferMessage ? ` • ${booking.booking.experienceCustomOfferMessage}` : ""}
                          </div>
                        ) : null}
                        {false && booking.booking.experienceCustomOfferStatus === "pending-admin-approval" ? (
                          <div className="text-sm text-muted-foreground">
                            Submitted, waiting for confirmation.
                          </div>
                        ) : null}
                        {false && booking.booking.experienceCustomOfferStatus === "declined" && booking.booking.experienceCustomOfferDeclineReason ? (
                          <div className="text-sm text-muted-foreground">
                            Decline reason: {booking.booking.experienceCustomOfferDeclineReason}
                          </div>
                        ) : null}
                        {isFinalizedAssignmentBooking(booking) ? (
                          <div className="text-sm text-muted-foreground rounded-md bg-muted/40 p-3">
                            {booking.booking.status === "cancelled"
                              ? "This booking was cancelled by admin. Offer actions are now locked."
                              : "This booking was marked completed by admin. Offer actions are now locked."}
                          </div>
                        ) : isClosedExperienceOffer(booking) ? (
                          <div className="text-sm text-muted-foreground rounded-md bg-muted/40 p-3">
                            Accepted by client. Editing locked.
                          </div>
                        ) : null}
                        {!isFinalizedAssignmentBooking(booking) && !isClosedExperienceOffer(booking) && booking.booking.experienceCustomOfferStatus === "pending" ? <Input
                          type="number"
                          min="1"
                          placeholder={`Offer total (${selectedCurrency})`}
                          value={proposalAmounts[booking.assignment.id] ?? ""}
                          onChange={(e) => setProposalAmounts((current) => ({ ...current, [booking.assignment.id]: e.target.value }))}
                        /> : null}
                        {!isFinalizedAssignmentBooking(booking) && !isClosedExperienceOffer(booking) && booking.booking.experienceCustomOfferStatus === "pending" ? <Textarea
                          rows={3}
                          placeholder="Offer note or decline reason"
                          value={proposalMessages[booking.assignment.id] ?? booking.booking.experienceCustomOfferMessage ?? declineReasons[booking.assignment.id] ?? booking.booking.experienceCustomOfferDeclineReason ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            setProposalMessages((current) => ({ ...current, [booking.assignment.id]: value }));
                            setDeclineReasons((current) => ({ ...current, [booking.assignment.id]: value }));
                          }}
                        /> : null}
                        {!isFinalizedAssignmentBooking(booking) && !isClosedExperienceOffer(booking) && booking.booking.experienceCustomOfferStatus === "pending" ? <div className="flex flex-col gap-2 sm:flex-row">
                          <Button
                            variant="outline"
                            className="w-full sm:w-auto"
                            disabled={reviewExperienceOfferMutation.isPending}
                            onClick={() => reviewExperienceOfferMutation.mutate({
                              assignmentId: booking.assignment.id,
                              payload: {
                                action: "propose",
                                proposedAmount: getSubmittedProposalAmountUsd(
                                  proposalAmounts[booking.assignment.id],
                                  booking.booking.experienceCustomOfferAmount,
                                ),
                                proposalMessage: proposalMessages[booking.assignment.id] ?? booking.booking.experienceCustomOfferMessage ?? "",
                              },
                            })}
                          >
                            {activeExperienceOfferBookingId === booking.assignment.id ? "Sending..." : "Send Offer"}
                          </Button>
                          <Button
                            variant="destructive"
                            className="w-full sm:w-auto"
                            disabled={reviewExperienceOfferMutation.isPending}
                            onClick={() => reviewExperienceOfferMutation.mutate({
                              assignmentId: booking.assignment.id,
                              payload: {
                                action: "decline",
                                declineReason: declineReasons[booking.assignment.id] ?? proposalMessages[booking.assignment.id] ?? booking.booking.experienceCustomOfferDeclineReason ?? "",
                              },
                            })}
                          >
                            {activeExperienceOfferBookingId === booking.assignment.id ? "Sending..." : "Send Decline"}
                          </Button>
                        </div> : null}
                      </div>
                    ) : null}
                      <BookingThread
                        bookingId={booking.booking.id}
                        title="Booking Chat"
                        initialMessage={getAssignmentRequestDetails(booking)}
                        initialMessageLabel={getBookingThreadInitialLabel(booking)}
                        composerPlaceholder="Reply inside this booking thread..."
                        defaultOpen={dashboardIntent.openThread && dashboardIntent.bookingId === booking.booking.id}
                      />
                      {statusAction ? (
                        <Button
                          variant="outline"
                          className="w-full md:w-56"
                          onClick={() => updateProviderBookingStatus.mutate({ id: booking.assignment.id, status: statusAction.status })}
                          disabled={updateProviderBookingStatus.isPending}
                        >
                          {activeStatusBookingId === booking.assignment.id ? "Updating..." : statusAction.label}
                        </Button>
                      ) : null}
                    </ProviderOrderCollapsible>
                  </div>
                );
              }) : <p className="text-sm text-muted-foreground">No experience bookings yet.</p>}
            </CardContent>
          </Card>
        )}
            </TabsContent>
          </Tabs>
      </div>
      </div>
    </ProviderLayout>
  );
}
