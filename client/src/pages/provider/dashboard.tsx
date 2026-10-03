import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Eye,
  MessagesSquare,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { Stay, Car, Cook, Errand, Experience, ProviderBookingAssignmentView, ProviderPaymentView } from "@shared/schema";
import { ProviderLayout } from "@/components/provider-layout";
import { HubPageHeader, WorkspaceIcon } from "@/components/provider-hub/hub-ui";
import { ProviderOverview, type AttentionItem, type UpcomingItem } from "@/components/provider-hub/overview";
import { QrShareCard } from "@/components/provider-hub/qr-share-card";
import { useProviderHub } from "@/hooks/use-provider-hub";
import { toHubListings } from "@/lib/provider-listings";
import { useAuth } from "@/hooks/useAuth";
import { useInbox } from "@/hooks/use-inbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BookingThread } from "@/components/booking-thread";
import { SharedGuestContact } from "@/components/shared-guest-contact";
import { JobEarnings } from "@/components/job-earnings";
import { RequestBriefAccordion } from "@/components/request-brief-accordion";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCurrency } from "@/lib/currency";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { awaitsProviderResponse, canStartJob, getJobStartDate, isAgreedOrder } from "@shared/provider-dashboard";
import { getCarDisplayName } from "@shared/listing-share";
import { ListingShareSheet } from "@/components/listing-share-sheet";
import { isProviderWorkspace, providerWorkspaces, workspacesHaveCustomQuotes } from "@shared/provider-workspaces";
import type { ProviderCategory } from "@shared/schema";
import { getPublicListingPath } from "@shared/seo";
import { getCookExtraGuestInclusivePrice, getCookExtraGuestServiceFee, getCookMinimumGuests } from "@shared/cook-pricing";
import { HOUSE_CLEANING_BASE_ROOM_LABEL, getHelpMamaStartingPrice, hasHelpMamaPricing } from "@shared/errand-pricing";
import { formatCalendarDate, formatCalendarDateRange, isCalendarDate, todayInKenya } from "@shared/calendar-dates";
import { isHotelStay } from "@shared/hotel-rooms";

type ProviderAssignments = {
  stays: Stay[];
  cars: Car[];
  cooks: Cook[];
  errands: Errand[];
  experiences: Experience[];
};

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
      return "TBM checking";
    }

    if (assignment.booking.customMenuProposalStatus === "proposed" || assignment.booking.customMenuProposalStatus === "declined") {
      return "With the guest";
    }

    return "Needs your price";
  }

  if (mode === "experience-custom-offer") {
    if (assignment.booking.experienceCustomOfferStatus === "pending-admin-approval") {
      return "TBM checking";
    }

    if (assignment.booking.experienceCustomOfferStatus === "proposed" || assignment.booking.experienceCustomOfferStatus === "declined") {
      return "With the guest";
    }

    return "Needs your price";
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
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
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

  // "20–22 Nov 2026", the same in every time zone.
  return formatCalendarDateRange(assignment.booking.checkIn, assignment.booking.checkOut, "en-GB");
}

function formatDashboardDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  // Booking dates are calendar dates: the same day in every time zone. Day first, as in Kenya.
  if (isCalendarDate(value)) {
    return formatCalendarDate(value, { month: "short", day: "numeric", year: "numeric" }, "en-GB");
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  }).format(parsed);
}

// "12 Nov 2026" for a calendar date, or the text as it is.
function formatDay(value: string | null | undefined) {
  return value ? formatDashboardDate(value) : null;
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
          <button type="button" className="flex w-full flex-col gap-3 text-left sm:flex-row sm:items-start sm:gap-4">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-medium text-foreground">{title}</div>
              {summary ? <div className="text-sm text-muted-foreground">{summary}</div> : null}
              {detail ? <div className="text-sm text-muted-foreground">{detail}</div> : null}
            </div>
            {/* On a phone the status sits under the details, so they use the full width. */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
              {statusContent ? <div className="flex flex-wrap gap-2 sm:max-w-[13rem] sm:justify-end">{statusContent}</div> : null}
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

function matchesDashboardQuery(
  query: string,
  values: Array<string | number | null | undefined>,
) {
  if (!query) {
    return true;
  }

  return values.some((value) => String(value ?? "").toLowerCase().includes(query));
}

type DashboardTab = "overview" | "listings" | "custom-requests" | "bookings";

function readProviderDashboardIntent(search: string) {
  const params = new URLSearchParams(search);
  const requestedTab = params.get("tab");
  const tab: DashboardTab = requestedTab === "listings" || requestedTab === "custom-requests" || requestedTab === "bookings"
    ? requestedTab
    : "overview";

  const workspace = params.get("workspace");

  return {
    tab,
    workspace: isProviderWorkspace(workspace) ? workspace : null,
    bookingId: params.get("bookingId"),
    assignmentId: params.get("assignmentId"),
    openThread: params.get("openThread") === "1",
    openAdminThread: params.get("openAdminThread") === "1",
  };
}

export default function ProviderDashboard() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { user, isLoading: authLoading, isProvider, isAdmin } = useAuth();
  const { toast } = useToast();
  const { formatAmount, convertToUsd, selectedCurrency } = useCurrency();
  const dashboardIntent = useMemo(() => readProviderDashboardIntent(search), [search]);
  const [activeTab, setActiveTab] = useState<DashboardTab>(dashboardIntent.tab);
  const [dashboardQuery, setDashboardQuery] = useState("");
  const [showOnlyActionable, setShowOnlyActionable] = useState(false);
  const hub = useProviderHub();
  const today = todayInKenya();
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
  // Only the services this provider offers; a workspace link narrows it to one.
  const activeWorkspace = dashboardIntent.workspace && hub.workspaces.includes(dashboardIntent.workspace) ? dashboardIntent.workspace : null;
  const hasRole = (role: ProviderCategory) => hub.workspaces.includes(role) && (!activeWorkspace || activeWorkspace === role);
  const showQuotes = workspacesHaveCustomQuotes(hub.workspaces);
  // Tabs live in the address, so the sidebar, the back button and shared links agree.
  const dashboardHref = (tab: DashboardTab, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    if (tab !== "overview") params.set("tab", tab);
    if (activeWorkspace && (tab === "listings" || tab === "bookings")) params.set("workspace", activeWorkspace);
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    const query = params.toString();
    return `/provider/dashboard${query ? `?${query}` : ""}`;
  };
  const goToTab = (tab: DashboardTab) => setLocation(dashboardHref(tab));
  const { data: providerBookingAssignments = [] } = useQuery<ProviderBookingAssignmentView[]>({
    queryKey: ["/api/provider/booking-assignments"],
  });
  const { unreadCount: unreadNotificationCount } = useInbox({ enabled: isProvider || isAdmin });
  const { data: providerPaymentData } = useQuery<ProviderPaymentView>({
    queryKey: ["/api/provider/payments"],
    enabled: !isAdmin,
  });
  const orderedStayBookings = sortProviderBookings(providerBookingAssignments.filter((item) => item.assignment.providerCategory === "stays"));
  const orderedCarBookings = sortProviderBookings(providerBookingAssignments.filter((item) => item.assignment.providerCategory === "cars"));
  const orderedCookBookings = sortProviderBookings(providerBookingAssignments.filter((item) => item.assignment.providerCategory === "cooks"));
  const orderedErrandBookings = sortProviderBookings(providerBookingAssignments.filter((item) => item.assignment.providerCategory === "errands"));
  const orderedExperienceBookings = sortProviderBookings(providerBookingAssignments.filter((item) => item.assignment.providerCategory === "experiences"));
  const liveBookingCount =
    getActiveBookingCount(orderedStayBookings) +
    getActiveBookingCount(orderedCarBookings) +
    getActiveBookingCount(orderedCookBookings) +
    getActiveBookingCount(orderedErrandBookings) +
    getActiveBookingCount(orderedExperienceBookings);
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
    shouldIncludeListing([getCarDisplayName(car), car.location, car.isPublic ? "public" : "pending review"], car.isPublic),
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
  const allProviderBookings = [
    ...orderedStayBookings,
    ...orderedCarBookings,
    ...orderedCookBookings,
    ...orderedErrandBookings,
    ...orderedExperienceBookings,
  ];
  const isAgreed = (booking: ProviderBookingAssignmentView) => isAgreedOrder(getAssignmentServiceMode(booking), booking.booking);
  const awaitingResponseCount = allProviderBookings.filter((booking) => awaitsProviderResponse(booking.assignment)).length;
  const deepLinkedAssignmentId = useMemo(
    () => dashboardIntent.assignmentId
      || allProviderBookings.find((booking) => booking.booking.id === dashboardIntent.bookingId)?.assignment.id
      || null,
    [allProviderBookings, dashboardIntent.assignmentId, dashboardIntent.bookingId],
  );

  useEffect(() => {
    if (!dashboardIntent.bookingId && !dashboardIntent.assignmentId) {
      setActiveTab(dashboardIntent.openAdminThread ? "overview" : dashboardIntent.tab);
      if (dashboardIntent.openAdminThread && typeof window !== "undefined") {
        window.setTimeout(() => document.getElementById("message-tbm")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
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
        return <Badge className="bg-sky-700">TBM checking</Badge>;
      case "proposed":
        return <Badge className="bg-amber-600">With the guest</Badge>;
      case "declined":
        return <Badge variant="destructive">Declined</Badge>;
      default:
        return <Badge variant="outline">Needs your price</Badge>;
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
      return <Badge variant="secondary">Accepted</Badge>;
    }

    return getProposalBadge(booking.booking.customMenuProposalStatus);
  };

  const getExperienceOfferBadge = (proposalStatus: string) => {
    switch (proposalStatus) {
      case "pending-admin-approval":
        return <Badge className="bg-sky-700">TBM checking</Badge>;
      case "proposed":
        return <Badge className="bg-amber-600">With the guest</Badge>;
      case "declined":
        return <Badge variant="destructive">Declined</Badge>;
      default:
        return <Badge variant="outline">Needs your price</Badge>;
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
      return <Badge variant="secondary">Accepted</Badge>;
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

  // Bookings show up once the guest pays the deposit; say so until the balance is in.
  const withPaymentStage = (booking: ProviderBookingAssignmentView, badge: ReactNode) =>
    (booking.booking as { paymentStage?: string }).paymentStage === "deposit-paid"
      ? (
        <span className="flex flex-wrap justify-end gap-1">
          {badge}
          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Deposit paid · balance due</Badge>
        </span>
      )
      : badge;

  const getPrimaryBookingStatusBadge = (booking: ProviderBookingAssignmentView) => {
    if (getAssignmentServiceMode(booking) === "cook-custom-menu") {
      return getCustomMenuWorkflowBadge(booking);
    }

    if (getAssignmentServiceMode(booking) === "experience-custom-offer") {
      return getExperienceWorkflowBadge(booking);
    }

    return <Badge variant="outline">{getProgressStatusLabel(getDashboardAssignmentStatus(booking))}</Badge>;
  };

  const quoteStatusText = (status: string | null | undefined) => {
    switch (status) {
      case "pending-admin-approval":
        return "Sent. TBM is checking it before the guest sees it.";
      case "proposed":
        return "With the guest. You'll hear when they decide.";
      case "declined":
        return "Declined.";
      default:
        return "Waiting for your price.";
    }
  };

  const renderQuoteForm = (booking: ProviderBookingAssignmentView) => {
    const id = booking.assignment.id;
    const isMenu = getAssignmentServiceMode(booking) === "cook-custom-menu";
    const status = (isMenu ? booking.booking.customMenuProposalStatus : booking.booking.experienceCustomOfferStatus) ?? "pending";
    const amount = isMenu ? booking.booking.customMenuProposedAmount : booking.booking.experienceCustomOfferAmount;
    const message = isMenu ? booking.booking.customMenuProposalMessage : booking.booking.experienceCustomOfferMessage;
    const declineReason = isMenu ? booking.booking.customMenuDeclineReason : booking.booking.experienceCustomOfferDeclineReason;
    const mutation = isMenu ? reviewCookBookingMutation : reviewExperienceOfferMutation;
    const isSending = (isMenu ? activeCustomMenuBookingId : activeExperienceOfferBookingId) === id;
    const locked = isFinalizedAssignmentBooking(booking) || (isMenu ? isClosedCustomMenu(booking) : isClosedExperienceOffer(booking));
    const canAnswer = !locked && status === "pending";
    const enteredAmount = proposalAmounts[id] ?? "";
    const note = proposalMessages[id] ?? "";
    const currencyLabel = selectedCurrency === "KES" ? "KSh" : "US$";

    return (
      <div className="space-y-3 rounded-2xl border border-stone-200 bg-stone-50/70 p-4" data-testid={`quote-form-${id}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-stone-950">{isMenu ? "Your quote" : "Your offer"}</div>
            <div className="text-xs text-stone-600">{locked ? (booking.booking.status === "cancelled" ? "This booking was cancelled." : "Accepted by the guest.") : quoteStatusText(status)}</div>
          </div>
          {isMenu ? getCustomMenuWorkflowBadge(booking) : getExperienceWorkflowBadge(booking)}
        </div>
        {status !== "pending" && amount ? (
          <div className="rounded-xl bg-white p-3 text-sm">
            <span className="text-stone-600">Price sent: </span>
            <span className="font-semibold text-stone-950">{formatAmount(amount)}</span>
            {message ? <span className="text-stone-600"> · {message}</span> : null}
          </div>
        ) : null}
        {status !== "pending" && declineReason ? (
          <div className="rounded-xl bg-white p-3 text-sm text-stone-700">Reason given: {declineReason}</div>
        ) : null}
        {canAnswer ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`quote-amount-${id}`}>Total price for the guest ({currencyLabel})</Label>
              <Input
                id={`quote-amount-${id}`}
                type="number"
                inputMode="decimal"
                min="1"
                placeholder={selectedCurrency === "KES" ? "For example, 25000" : "For example, 200"}
                value={enteredAmount}
                onChange={(event) => setProposalAmounts((current) => ({ ...current, [id]: event.target.value }))}
                className="bg-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`quote-note-${id}`}>Note for the guest, or why you can't do it</Label>
              <Textarea
                id={`quote-note-${id}`}
                rows={3}
                placeholder={isMenu ? "What's on the menu, what's included, anything the guest should know" : "What's included, timings, anything the guest should know"}
                value={note}
                onChange={(event) => {
                  const value = event.target.value;
                  setProposalMessages((current) => ({ ...current, [id]: value }));
                  setDeclineReasons((current) => ({ ...current, [id]: value }));
                }}
                className="bg-white"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                className="rounded-full"
                disabled={mutation.isPending || !(Number(enteredAmount) > 0)}
                onClick={() => mutation.mutate({
                  assignmentId: id,
                  payload: {
                    action: "propose",
                    proposedAmount: getSubmittedProposalAmountUsd(enteredAmount, amount),
                    proposalMessage: note,
                  },
                })}
                data-testid={`button-send-quote-${id}`}
              >
                {isSending ? "Sending..." : isMenu ? "Send quote" : "Send offer"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-rose-200 text-rose-700 hover:bg-rose-50"
                disabled={mutation.isPending || !note.trim()}
                onClick={() => mutation.mutate({ assignmentId: id, payload: { action: "decline", declineReason: declineReasons[id] ?? note } })}
              >
                Decline
              </Button>
            </div>
            <p className="text-xs text-stone-500">TBM checks your answer before the guest sees it. To decline, write a short reason in the note.</p>
          </>
        ) : null}
      </div>
    );
  };

  // In Bookings, quotes point to the Custom quotes tab, where they're answered.
  const renderQuotePointer = (booking: ProviderBookingAssignmentView) => {
    const isMenu = getAssignmentServiceMode(booking) === "cook-custom-menu";
    if (isFinalizedAssignmentBooking(booking) || (isMenu ? isClosedCustomMenu(booking) : isClosedExperienceOffer(booking))) {
      return null;
    }
    const status = isMenu ? booking.booking.customMenuProposalStatus : booking.booking.experienceCustomOfferStatus;
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-sky-200 bg-sky-50/60 p-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-sky-950">{isMenu ? "Custom menu" : "Custom offer"}: {quoteStatusText(status)}</span>
        <Button type="button" size="sm" variant="outline" className="rounded-full bg-white" onClick={() => goToTab("custom-requests")}>
          Open in Custom quotes
        </Button>
      </div>
    );
  };

  const customRequestsTabLabel = customRequestBookings.length > 0 ? `Quotes (${customRequestBookings.length})` : "Quotes";
  const bookingsTabLabel = liveBookingCount > 0 ? `Bookings (${liveBookingCount})` : "Bookings";
  const bookingSectionLinks = [
    hasRole("stays") ? { id: "provider-stay-bookings", label: "Stays", count: visibleStayBookings.length } : null,
    hasRole("cars") ? { id: "provider-car-bookings", label: "Vehicles", count: visibleCarBookings.length } : null,
    hasRole("cooks") ? { id: "provider-cook-bookings", label: "Chef services", count: bookingTabCookBookings.length } : null,
    hasRole("errands") ? { id: "provider-errand-bookings", label: "Home help", count: visibleErrandBookings.length } : null,
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

  const openBookingWorkspace = (bookingId: string, assignmentId?: string | null) => {
    const targetAssignmentId = assignmentId || allProviderBookings.find((booking) => booking.booking.id === bookingId)?.assignment.id;
    if (!targetAssignmentId) {
      goToTab("bookings");
      return;
    }

    setLocation(dashboardHref("bookings", { assignmentId: targetAssignmentId }));
    openAssignment(targetAssignmentId);
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        document.getElementById(`partner-assignment-${targetAssignmentId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    }
  };

  // "In progress" only from the job's first day, as the server checks too.
  const getJobStart = (booking: ProviderBookingAssignmentView) => getJobStartDate({
    checkIn: booking.booking.checkIn,
    serviceScheduleSlots: getAssignmentScheduleSlots(booking),
  });
  const renderStatusAction = (booking: ProviderBookingAssignmentView, statusAction: ReturnType<typeof getNextProgressAction>, className: string) => {
    if (!statusAction) {
      return null;
    }
    const startDate = getJobStart(booking);
    if (!canStartJob(startDate, today)) {
      return (
        <p className="flex items-center gap-2 rounded-2xl bg-stone-50 px-3 py-2 text-sm text-stone-600" data-testid={`text-starts-on-${booking.assignment.id}`}>
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          {startDate ? `You can mark this job in progress from ${formatDay(startDate)}.` : "This job has no start date yet."}
        </p>
      );
    }
    return (
      <Button
        variant="outline"
        className={className}
        onClick={() => updateProviderBookingStatus.mutate({ id: booking.assignment.id, status: statusAction.status })}
        disabled={updateProviderBookingStatus.isPending}
        data-testid={`button-status-${booking.assignment.id}`}
      >
        {activeStatusBookingId === booking.assignment.id ? "Updating..." : statusAction.label}
      </Button>
    );
  };

  // Overview: what needs the provider now, and what's coming.
  const hubListings = toHubListings(data, hub.workspaces);
  const firstAwaiting = allProviderBookings.find((booking) => awaitsProviderResponse(booking.assignment));
  const startsToday = allProviderBookings.filter((booking) =>
    isAgreed(booking)
    && getDashboardAssignmentStatus(booking) === "upcoming"
    && getJobStart(booking) === today,
  );
  const attentionItems = ([
    awaitingResponseCount > 0 ? {
      key: "job-requests",
      icon: ClipboardList,
      title: `${awaitingResponseCount} new ${awaitingResponseCount === 1 ? "job" : "jobs"} to accept or decline`,
      detail: firstAwaiting ? joinMeta([firstAwaiting.assignment.serviceName, getAssignmentDateRange(firstAwaiting)]) : undefined,
      action: "Answer",
      href: "/provider/service-requests",
      tone: "amber" as const,
    } : null,
    partnerPendingCustomRequestCount > 0 ? {
      key: "quotes",
      icon: ReceiptText,
      title: `${partnerPendingCustomRequestCount} custom ${partnerPendingCustomRequestCount === 1 ? "request needs" : "requests need"} your quote`,
      detail: "The guest is waiting for your price.",
      action: "Quote",
      onClick: () => goToTab("custom-requests"),
      tone: "amber" as const,
    } : null,
    ...startsToday.slice(0, 2).map((booking) => ({
      key: `today-${booking.assignment.id}`,
      icon: CalendarDays,
      title: `${booking.assignment.serviceName} starts today`,
      detail: joinMeta([booking.booking.guestName, `Ref ${getShortBookingReference(booking.booking.id)}`]),
      action: "Open",
      onClick: () => openBookingWorkspace(booking.booking.id, booking.assignment.id),
      tone: "teal" as const,
    })),
    unreadNotificationCount > 0 ? {
      key: "messages",
      icon: MessagesSquare,
      title: `${unreadNotificationCount} unread ${unreadNotificationCount === 1 ? "message or alert" : "messages and alerts"}`,
      action: "Read",
      href: "/provider/messages",
      tone: "sky" as const,
    } : null,
  ] as Array<AttentionItem | null>).filter((item): item is AttentionItem => Boolean(item));
  const upcomingItems: UpcomingItem[] = allProviderBookings
    .filter((booking) => {
      const status = getDashboardAssignmentStatus(booking);
      return isAgreed(booking)
        && (status === "in-progress" || (status === "upcoming" && (booking.booking.checkOut || booking.booking.checkIn) >= today));
    })
    .sort((a, b) => (getJobStart(a) ?? "").localeCompare(getJobStart(b) ?? ""))
    .map((booking) => ({
      id: booking.assignment.id,
      workspace: booking.assignment.providerCategory as ProviderCategory,
      title: booking.assignment.serviceName,
      when: getAssignmentDateRange(booking) ?? "Date to be set",
      who: booking.booking.guestName ?? null,
      status: getProgressStatusLabel(getDashboardAssignmentStatus(booking)),
      onOpen: () => openBookingWorkspace(booking.booking.id, booking.assignment.id),
    }));
  const activeBookingCounts: Partial<Record<ProviderCategory, number>> = {
    stays: getActiveBookingCount(orderedStayBookings),
    cars: getActiveBookingCount(orderedCarBookings),
    cooks: getActiveBookingCount(orderedCookBookings),
    errands: getActiveBookingCount(orderedErrandBookings),
    experiences: getActiveBookingCount(orderedExperienceBookings),
  };

  // Listings, one section per service, each listing on one card.
  const listingDetails = (listing: (typeof hubListings)[number]): string[] => {
    if (listing.workspace === "stays") {
      const stay = data?.stays?.find((item) => item.id === listing.id);
      return stay ? [isHotelStay(stay) ? `Hotel · from ${formatAmount(stay.price)} a room a night` : `${formatAmount(stay.price)} a night`] : [];
    }
    if (listing.workspace === "cars") {
      const car = data?.cars?.find((item) => item.id === listing.id);
      if (!car) return [];
      return [
        `${formatAmount(car.priceWithDriver)} a day with driver`,
        car.priceWithDriverHourly ? `${formatAmount(car.priceWithDriverHourly)} an hour` : "",
        car.pricePerDay ? `${formatAmount(car.pricePerDay)} a day self-drive` : "",
      ].filter(Boolean);
    }
    if (listing.workspace === "cooks") {
      const cook = data?.cooks?.find((item) => item.id === listing.id);
      if (!cook) return [];
      return [
        `${formatAmount(cook.serviceFee || cook.pricePerSession)} a day, chef's service`,
        `${formatAmount(cook.inclusivePrice || cook.serviceFee || cook.pricePerSession)} a day, food included`,
        `Base for ${getCookMinimumGuests(cook)} guests · ${formatAmount(getCookExtraGuestServiceFee(cook))} per extra guest`,
        cook.customMenuEnabled ? "Takes custom menu requests" : "",
      ].filter(Boolean);
    }
    if (listing.workspace === "errands") {
      const errand = data?.errands?.find((item) => item.id === listing.id);
      if (!errand) return [];
      return [
        hasHelpMamaPricing(errand)
          ? `From ${formatAmount(getHelpMamaStartingPrice(errand.helpMamaPricing))}`
          : errand.houseCleaningEnabled && !errand.shoppingEnabled && !errand.laundryEnabled
            ? `${formatAmount(errand.basePrice)} ${HOUSE_CLEANING_BASE_ROOM_LABEL}`
            : `From ${formatAmount(errand.basePrice)}`,
        errand.shoppingEnabled ? `Shopping + ${errand.shoppingCommissionPercent}%` : "",
        errand.laundryEnabled ? "Laundry" : "",
        errand.houseCleaningEnabled ? "Cleaning" : "",
      ].filter(Boolean);
    }
    const experience = data?.experiences?.find((item) => item.id === listing.id);
    if (!experience) return [];
    return [
      experience.privateEnabled ? `Private from ${formatAmount(experience.privatePricePerPerson)} a person` : "",
      experience.sharedEnabled ? `Shared from ${formatAmount(experience.sharedPricePerPerson)} a person` : "",
      `${experience.durationHours} hours`,
      `Up to ${experience.maxGuests} guests`,
    ].filter(Boolean);
  };
  const listingMatchesSearch = (listing: (typeof hubListings)[number]) =>
    matchesDashboardQuery(normalizedDashboardQuery, [listing.name, listing.location, listing.isPublic ? "live public" : "checking review"])
    && (!showOnlyActionable || !listing.isPublic);
  const tabTitles: Record<DashboardTab, { title: string; description: string }> = {
    overview: { title: "", description: "" },
    listings: activeWorkspace
      ? { title: providerWorkspaces[activeWorkspace].label, description: `Your ${providerWorkspaces[activeWorkspace].noun[1]}: prices, photos, dates you're away, and sharing.` }
      : { title: "Your listings", description: "Prices, photos, dates you're away, and sharing, for each of your services." },
    "custom-requests": { title: "Custom quotes", description: "Guests asked for something made for them. Send your price, or decline with a reason. TBM checks it before the guest sees it." },
    bookings: { title: "Bookings", description: "Every job, with its dates, what the guest booked, and your messages with TBM." },
  };

  return (
    <ProviderLayout title={activeTab === "overview" ? "Home" : tabTitles[activeTab].title}>
      <div className="min-h-full">
        <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6 md:space-y-6 md:py-8">
          <Tabs value={activeTab} onValueChange={(value) => goToTab(value as DashboardTab)} className="space-y-5 md:space-y-6">
            <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-full border border-stone-200/80 bg-white/90 p-1 shadow-sm sm:w-fit">
              <TabsTrigger value="overview" className="min-h-10 shrink-0 rounded-full px-4 text-sm data-[state=active]:bg-teal-800 data-[state=active]:text-white">
                Overview
              </TabsTrigger>
              <TabsTrigger value="listings" className="min-h-10 shrink-0 rounded-full px-4 text-sm data-[state=active]:bg-teal-800 data-[state=active]:text-white">
                Listings
              </TabsTrigger>
              {showQuotes ? (
                <TabsTrigger value="custom-requests" className={cn("min-h-10 shrink-0 rounded-full px-4 text-sm data-[state=active]:bg-teal-800 data-[state=active]:text-white", partnerPendingCustomRequestCount > 0 && "text-amber-800")}>
                  {customRequestsTabLabel}
                </TabsTrigger>
              ) : null}
              <TabsTrigger value="bookings" className="min-h-10 shrink-0 rounded-full px-4 text-sm data-[state=active]:bg-teal-800 data-[state=active]:text-white">
                {bookingsTabLabel}
              </TabsTrigger>
            </TabsList>

            {activeTab !== "overview" ? (
              <div className="space-y-4">
                <HubPageHeader
                  title={tabTitles[activeTab].title}
                  description={tabTitles[activeTab].description}
                  actions={activeTab === "listings" && activeWorkspace ? (
                    <Button asChild className="rounded-full">
                      <Link href={providerWorkspaces[activeWorkspace].addHref}><Plus className="mr-1.5 h-4 w-4" />{providerWorkspaces[activeWorkspace].addLabel}</Link>
                    </Button>
                  ) : undefined}
                />
                {hub.workspaces.length > 1 && (activeTab === "listings" || activeTab === "bookings") ? (
                  <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="group" aria-label="Choose a service">
                    <Button
                      type="button"
                      size="sm"
                      variant={!activeWorkspace ? "default" : "outline"}
                      className="shrink-0 rounded-full"
                      onClick={() => setLocation(activeTab === "listings" ? "/provider/dashboard?tab=listings" : "/provider/dashboard?tab=bookings")}
                    >
                      All services
                    </Button>
                    {hub.workspaces.map((key) => (
                      <Button
                        key={key}
                        type="button"
                        size="sm"
                        variant={activeWorkspace === key ? "default" : "outline"}
                        className="shrink-0 rounded-full bg-white/90 data-[active=true]:bg-primary"
                        data-active={activeWorkspace === key}
                        onClick={() => setLocation(`/provider/dashboard?tab=${activeTab}&workspace=${key}`)}
                        data-testid={`filter-workspace-${key}`}
                      >
                        {providerWorkspaces[key].label}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={dashboardQuery}
                      onChange={(event) => setDashboardQuery(event.target.value)}
                      placeholder={activeTab === "listings" ? "Search your listings" : "Search by guest, place or reference"}
                      aria-label="Search"
                      className="h-11 rounded-full border-stone-200 bg-white pl-11"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant={!showOnlyActionable ? "default" : "outline"} className="flex-1 rounded-full sm:flex-none" onClick={() => setShowOnlyActionable(false)}>
                      All
                    </Button>
                    <Button type="button" variant={showOnlyActionable ? "default" : "outline"} className="flex-1 rounded-full sm:flex-none" onClick={() => setShowOnlyActionable(true)}>
                      {activeTab === "listings" ? "Being checked" : "Open"}
                    </Button>
                    {hasDashboardFilters ? (
                      <Button type="button" variant="ghost" className="rounded-full" onClick={() => { setDashboardQuery(""); setShowOnlyActionable(false); }}>
                        Clear
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            <TabsContent value="overview" className="mt-0">
              <ProviderOverview
                firstName={user?.firstName}
                isAdmin={isAdmin}
                isProvider={isProvider}
                providerUserId={user?.id}
                openAdminThread={dashboardIntent.openAdminThread}
                moderationNote={user?.moderationNote}
                workspaces={hub.workspaces}
                listings={hubListings}
                bookingCounts={activeBookingCounts}
                attention={attentionItems}
                upcoming={upcomingItems}
                payments={providerPaymentData}
              />
            </TabsContent>

            <TabsContent value="listings" className="mt-0 space-y-6">
              {hub.workspaces.filter((key) => hasRole(key)).map((key) => {
                const workspace = providerWorkspaces[key];
                const rows = hubListings.filter((listing) => listing.workspace === key && listingMatchesSearch(listing));
                const total = hubListings.filter((listing) => listing.workspace === key).length;
                return (
                  <section key={key} id={`provider-${key}`} className="scroll-mt-24 space-y-3" data-testid={`listings-section-${key}`}>
                    {!activeWorkspace ? (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <WorkspaceIcon workspace={key} />
                          <div>
                            <h2 className="text-lg font-semibold tracking-tight text-stone-950">{workspace.label}</h2>
                            <p className="text-xs text-stone-600">{workspace.description}</p>
                          </div>
                        </div>
                        <Button asChild size="sm" variant="outline" className="shrink-0 rounded-full bg-white">
                          <Link href={workspace.addHref}><Plus className="mr-1 h-4 w-4" />Add</Link>
                        </Button>
                      </div>
                    ) : null}
                    {rows.length ? (
                      <div className="grid gap-3 lg:grid-cols-2">
                        {rows.map((listing) => (
                          <article key={listing.id} className="flex flex-col overflow-hidden rounded-[1.5rem] border border-stone-200/80 bg-white shadow-[0_20px_50px_-42px_rgba(92,73,47,0.5)] sm:flex-row" data-testid={`listing-card-${listing.kind}-${listing.id}`}>
                            <div className="relative h-36 shrink-0 bg-stone-100 sm:h-auto sm:w-40">
                              {listing.imageUrl ? (
                                <img src={listing.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center"><WorkspaceIcon workspace={key} className="h-14 w-14" /></div>
                              )}
                              <span className={cn(
                                "absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold shadow-sm",
                                listing.isPublic ? "bg-emerald-600 text-white" : "bg-amber-100 text-amber-900",
                              )}>
                                {listing.isPublic ? <><BadgeCheck className="h-3.5 w-3.5" />Live</> : <><ShieldCheck className="h-3.5 w-3.5" />TBM is checking it</>}
                              </span>
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
                              <div className="min-w-0">
                                <h3 className="truncate font-semibold text-stone-950">{listing.name}</h3>
                                {listing.location ? <p className="truncate text-sm text-stone-600">{listing.location}</p> : null}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {listingDetails(listing).map((detail) => (
                                  <span key={detail} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-700">{detail}</span>
                                ))}
                              </div>
                              <div className="mt-auto flex flex-wrap gap-2">
                                <Button asChild size="sm" className="rounded-full">
                                  <Link href={listing.manageHref}><Settings2 className="mr-1.5 h-3.5 w-3.5" />Manage</Link>
                                </Button>
                                <Button asChild size="sm" variant="outline" className="rounded-full">
                                  <a href={listing.calendarHref}><CalendarDays className="mr-1.5 h-3.5 w-3.5" />Dates</a>
                                </Button>
                                <ListingShareSheet
                                  kind={listing.kind}
                                  id={listing.id}
                                  name={listing.name}
                                  description={listing.description}
                                  {...listing.share}
                                  isPublic={listing.isPublic}
                                  source="provider"
                                  triggerClassName={listing.isPublic ? "border-[#1f7a4d] text-[#1f7a4d]" : undefined}
                                />
                                {listing.isPublic ? <QrShareCard kind={listing.kind} id={listing.id} name={listing.name} isPublic /> : null}
                                {listing.isPublic ? (
                                  <Button asChild size="sm" variant="ghost" className="rounded-full">
                                    <a href={getPublicListingPath(listing.kind, listing.id, listing.name)} target="_blank" rel="noreferrer"><Eye className="mr-1.5 h-3.5 w-3.5" />View</a>
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-start gap-3 rounded-[1.5rem] border border-dashed border-stone-300 bg-white/70 p-5 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-stone-700">
                          {total ? "No listings match your search." : `No ${workspace.noun[1]} yet. Add your first: TBM checks every listing before guests see it.`}
                        </p>
                        {!total ? (
                          <Button asChild className="rounded-full">
                            <Link href={workspace.addHref}><Plus className="mr-1.5 h-4 w-4" />{workspace.addLabel}</Link>
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </section>
                );
              })}
              <div className="flex flex-col items-start gap-3 rounded-[1.5rem] border border-emerald-200 bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-emerald-950">See the visits and bookings your shared links brought in.</p>
                <Button asChild size="sm" variant="outline" className="rounded-full border-emerald-300 bg-white">
                  <Link href="/provider/share">Open Share & grow</Link>
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="custom-requests" className="mt-0 space-y-4">
              {customRequestBookings.length ? (
                <>
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
                      <div className="text-2xl font-semibold tabular-nums text-stone-950">{partnerPendingCustomRequestCount}</div>
                      <div className="text-xs font-medium text-amber-900">Need your price</div>
                    </div>
                    <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-3">
                      <div className="text-2xl font-semibold tabular-nums text-stone-950">{adminPendingCustomRequestCount}</div>
                      <div className="text-xs font-medium text-sky-900">TBM checking</div>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-white p-3">
                      <div className="text-2xl font-semibold tabular-nums text-stone-950">{clientPendingCustomRequestCount}</div>
                      <div className="text-xs font-medium text-stone-700">With the guest</div>
                    </div>
                  </div>
                  {customRequestBookings.map((booking) => {
                    const details = getAssignmentRequestDetails(booking);
                    const serviceLocation = getAssignmentLocation(booking);
                    return (
                      <article key={`custom-request-${booking.assignment.id}`} className="space-y-4 rounded-[1.5rem] border border-stone-200/80 bg-white p-4 shadow-[0_20px_50px_-42px_rgba(92,73,47,0.5)] sm:p-5" data-testid={`quote-card-${booking.assignment.id}`}>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 space-y-1">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">{getCustomRequestLabel(booking)} · Ref {getShortBookingReference(booking.booking.id)}</div>
                            <h3 className="font-semibold text-stone-950">{booking.assignment.serviceName}</h3>
                            <p className="text-sm text-stone-600">
                              {joinMeta([
                                booking.booking.guestName,
                                getAssignmentDateRange(booking),
                                serviceLocation,
                                getAssignmentGuests(booking) ? `${getAssignmentGuests(booking)} ${getAssignmentGuests(booking) === 1 ? "guest" : "guests"}` : null,
                              ])}
                            </p>
                          </div>
                          <Badge variant="secondary" className="w-fit shrink-0 rounded-full">{getCustomRequestQueueLabel(booking)}</Badge>
                        </div>
                        {details ? (
                          <RequestBriefAccordion
                            id={`quote-brief-${booking.assignment.id}`}
                            title="What the guest asked for"
                            summary={getRequestPreview(details)}
                            content={details}
                            accent={getAssignmentServiceMode(booking) === "cook-custom-menu" ? "amber" : "sky"}
                            className="mt-0"
                          />
                        ) : null}
                        {renderQuoteForm(booking)}
                        <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => openBookingWorkspace(booking.booking.id, booking.assignment.id)}>
                          Booking details and messages
                        </Button>
                      </article>
                    );
                  })}
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-[1.5rem] border border-dashed border-stone-300 bg-white/70 px-4 py-10 text-center">
                  <ReceiptText className="h-8 w-8 text-stone-400" aria-hidden="true" />
                  <p className="text-sm text-stone-700">
                    {hasDashboardFilters ? "No custom requests match your search." : "No custom requests right now. When a guest asks for a menu or an outing made for them, it shows here."}
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="bookings" className="mt-0 space-y-5">
        {bookingSectionLinks.length > 1 ? (
          <div id="provider-bookings" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {bookingSectionLinks.map((section) => (
              <Button
                key={section.id}
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 rounded-full bg-white/90"
                onClick={() => jumpToSection(section.id)}
              >
                {section.label} ({section.count})
              </Button>
            ))}
          </div>
        ) : null}

        {hasRole("stays") && (
          <Card id="provider-stay-bookings" className="scroll-mt-24 rounded-[1.75rem] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_-46px_rgba(92,73,47,0.45)]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-3 text-lg"><WorkspaceIcon workspace="stays" className="h-9 w-9" />Stays</CardTitle>
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
                      statusContent={withPaymentStage(booking, <Badge variant="outline" className="rounded-full">{getProgressStatusLabel(dashboardStatus)}</Badge>)}
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
                      <JobEarnings assignmentId={booking.assignment.id} />
                      <SharedGuestContact bookingId={booking.booking.id} />
                      <BookingThread
                        bookingId={booking.booking.id}
                        title="Messages with TBM"
                        composerPlaceholder="Ask TBM a question or send an update about this booking..."
                        defaultOpen={dashboardIntent.openThread && dashboardIntent.bookingId === booking.booking.id}
                      />

                      {renderStatusAction(booking, statusAction, "w-full rounded-full lg:w-auto")}
                    </ProviderOrderCollapsible>
                  </div>
                );
              }) : <p className="text-sm text-muted-foreground">No stay bookings yet. Share your stays to bring in the first guests.</p>}
            </CardContent>
          </Card>
        )}

        {hasRole("cars") && (
          <Card id="provider-car-bookings" className="scroll-mt-24 rounded-[1.75rem] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_-46px_rgba(92,73,47,0.45)]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-3 text-lg"><WorkspaceIcon workspace="cars" className="h-9 w-9" />Vehicles</CardTitle>
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
                      title={car ? getCarDisplayName(car) : "Vehicle booking"}
                      summary={joinMeta([
                        booking.booking.guestName,
                        getAssignmentDateRange(booking),
                        getAssignmentLocation(booking),
                        getAssignmentPickupLocation(booking) ? `Pickup ${getAssignmentPickupLocation(booking)}` : null,
                        getAssignmentReturnLocation(booking) ? `Return ${getAssignmentReturnLocation(booking)}` : null,
                        booking.assignment.serviceConfig.serviceZone ? `Zone ${booking.assignment.serviceConfig.serviceZone}` : null,
                      ])}
                      detail={getCarModeSummary(booking)}
                      statusContent={withPaymentStage(booking, <Badge variant="outline">{getProgressStatusLabel(dashboardStatus)}</Badge>)}
                    >
                      <JobEarnings assignmentId={booking.assignment.id} />
                      <SharedGuestContact bookingId={booking.booking.id} />
                      <BookingThread
                        bookingId={booking.booking.id}
                        title="Messages with TBM"
                        initialMessage={getAssignmentRequestDetails(booking)}
                        initialMessageLabel={getBookingThreadInitialLabel(booking)}
                        composerPlaceholder="Ask TBM a question or send an update about this booking..."
                        defaultOpen={dashboardIntent.openThread && dashboardIntent.bookingId === booking.booking.id}
                      />
                      {renderStatusAction(booking, statusAction, "w-full md:w-56")}
                    </ProviderOrderCollapsible>
                  </div>
                );
              }) : <p className="text-sm text-muted-foreground">No vehicle bookings yet.</p>}
            </CardContent>
          </Card>
        )}

        {hasRole("cooks") && (
          <Card id="provider-cook-bookings" className="scroll-mt-24 rounded-[1.75rem] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_-46px_rgba(92,73,47,0.45)]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-3 text-lg"><WorkspaceIcon workspace="cooks" className="h-9 w-9" />Chef services</CardTitle>
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
                      statusContent={withPaymentStage(booking, getPrimaryBookingStatusBadge(booking))}
                    >
                    <div>
                      {getAssignmentRequestDetails(booking) ? (
                        <RequestBriefAccordion
                          id={`partner-cook-brief-${booking.assignment.id}`}
                          title={`What the guest asked for · Ref ${getShortBookingReference(booking.booking.id)}`}
                          summary={getRequestPreview(getAssignmentRequestDetails(booking))}
                          content={getAssignmentRequestDetails(booking) ?? ""}
                          accent="amber"
                          className="mt-3"
                        />
                      ) : null}
                      {getAssignmentServiceMode(booking) === "cook-custom-menu" ? renderQuotePointer(booking) : null}
                    </div>
                      <JobEarnings assignmentId={booking.assignment.id} />
                      <SharedGuestContact bookingId={booking.booking.id} />
                      <BookingThread
                        bookingId={booking.booking.id}
                        title="Messages with TBM"
                        initialMessage={getAssignmentRequestDetails(booking)}
                        initialMessageLabel={getBookingThreadInitialLabel(booking)}
                        composerPlaceholder="Ask TBM a question or send an update about this booking..."
                        defaultOpen={dashboardIntent.openThread && dashboardIntent.bookingId === booking.booking.id}
                      />
                      {renderStatusAction(booking, statusAction, "w-full md:w-56")}
                    </ProviderOrderCollapsible>
                  </div>
                );
              }) : <p className="text-sm text-muted-foreground">No chef bookings yet.</p>}
            </CardContent>
          </Card>
        )}

        {hasRole("errands") && (
          <Card id="provider-errand-bookings" className="scroll-mt-24 rounded-[1.75rem] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_-46px_rgba(92,73,47,0.45)]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-3 text-lg"><WorkspaceIcon workspace="errands" className="h-9 w-9" />Home help</CardTitle>
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
                      title={errand?.serviceName ?? "Home help booking"}
                      summary={joinMeta([
                        booking.booking.guestName,
                        getAssignmentLocation(booking),
                      ])}
                      detail={getAssignmentScheduleSlots(booking).length
                        ? `${getAssignmentScheduleSlots(booking).length} scheduled stop${getAssignmentScheduleSlots(booking).length === 1 ? "" : "s"}`
                        : null}
                      statusContent={withPaymentStage(booking, <Badge variant="outline">{getProgressStatusLabel(dashboardStatus)}</Badge>)}
                    >
                    {getAssignmentScheduleSlots(booking).length ? (
                      <div className="space-y-1 text-sm text-muted-foreground">
                        {getAssignmentScheduleSlots(booking).map((slot, index) => (
                          <div key={`${slot.date}-${slot.note}-${index}`}>
                            {formatDay(slot.date)}{slot.note?.trim() ? ` · ${slot.note.trim()}` : ""}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {getAssignmentServiceMode(booking) === "errand-shopping" && getAssignmentBudgetAmount(booking) ? (
                      <div className="text-sm text-muted-foreground">
                        Estimated receipt value: <span className="font-medium text-foreground">{formatAmount(getAssignmentBudgetAmount(booking) ?? 0)}</span>
                      </div>
                    ) : null}
                      <JobEarnings assignmentId={booking.assignment.id} />
                      <SharedGuestContact bookingId={booking.booking.id} />
                      <BookingThread
                        bookingId={booking.booking.id}
                        title="Messages with TBM"
                        initialMessage={getAssignmentRequestDetails(booking)}
                        initialMessageLabel={getBookingThreadInitialLabel(booking)}
                        composerPlaceholder="Ask TBM a question or send an update about this request..."
                        defaultOpen={dashboardIntent.openThread && dashboardIntent.bookingId === booking.booking.id}
                      />
                      {renderStatusAction(booking, statusAction, "w-full md:w-56")}
                    </ProviderOrderCollapsible>
                  </div>
                );
              }) : <p className="text-sm text-muted-foreground">No home help bookings yet.</p>}
            </CardContent>
          </Card>
        )}

        {hasRole("experiences") && (
          <Card id="provider-experience-bookings" className="scroll-mt-24 rounded-[1.75rem] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_-46px_rgba(92,73,47,0.45)]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-3 text-lg"><WorkspaceIcon workspace="experiences" className="h-9 w-9" />Experiences</CardTitle>
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
                      statusContent={withPaymentStage(booking, getPrimaryBookingStatusBadge(booking))}
                    >
                    <div>
                      {getAssignmentRequestDetails(booking) ? (
                        <RequestBriefAccordion
                          id={`partner-experience-brief-${booking.assignment.id}`}
                          title={`What the guest asked for · Ref ${getShortBookingReference(booking.booking.id)}`}
                          summary={getRequestPreview(getAssignmentRequestDetails(booking))}
                          content={getAssignmentRequestDetails(booking) ?? ""}
                          accent="sky"
                          className="mt-0"
                        />
                      ) : null}
                    </div>
                    {getAssignmentServiceMode(booking) === "experience-custom-offer" ? renderQuotePointer(booking) : null}
                      <JobEarnings assignmentId={booking.assignment.id} />
                      <SharedGuestContact bookingId={booking.booking.id} />
                      <BookingThread
                        bookingId={booking.booking.id}
                        title="Messages with TBM"
                        initialMessage={getAssignmentRequestDetails(booking)}
                        initialMessageLabel={getBookingThreadInitialLabel(booking)}
                        composerPlaceholder="Ask TBM a question or send an update about this booking..."
                        defaultOpen={dashboardIntent.openThread && dashboardIntent.bookingId === booking.booking.id}
                      />
                      {renderStatusAction(booking, statusAction, "w-full md:w-56")}
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
