import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Calendar, MapPin, Users, Car, ChefHat, ShoppingBag, Compass, Filter, Mail, Phone } from "lucide-react";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BookingThread } from "@/components/booking-thread";
import { BookingServiceDetails } from "@/components/booking-service-details";
import { RequestBriefAccordion } from "@/components/request-brief-accordion";
import { calculateBookingDepositAmount, getBookingAmountPaid, getBookingCheckoutAmount, getBookingOutstandingAmount, hasLockedInBookingDeposit, isFullPaymentOnlyBooking, supportsBookingDeposit } from "@shared/booking-payments";
import type { Booking, Stay, Car as CarType, Cook, Errand, Experience } from "@shared/schema";
import { bookingStatus } from "@shared/schema";

type BookingStatus = typeof bookingStatus.options[number];

function isHistoryBookingStatus(status: string) {
  return status === "completed" || status === "cancelled";
}

function isLockedBookingStatus(status: string) {
  return status === "pending" || status === "pending-payment" || status === "completed" || status === "cancelled";
}

function isFinalizedBooking(booking: Pick<Booking, "status">) {
  return booking.status === "completed" || booking.status === "cancelled";
}

function hasOutstandingBookingPayment(booking: Booking) {
  return getBookingOutstandingAmount(booking) > 0
    && booking.status !== "completed"
    && booking.status !== "cancelled";
}

function getShortBookingReference(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function isPendingCustomRequestBooking(booking: Booking) {
  if (isFinalizedBooking(booking)) {
    return false;
  }

  if (booking.serviceMode === "cook-custom-menu") {
    return booking.customMenuClientDecision !== "accepted";
  }

  if (booking.serviceMode === "experience-custom-offer") {
    return booking.experienceCustomOfferClientDecision !== "accepted";
  }

  return false;
}

function isAdminManagedCustomServiceBooking(booking: Booking) {
  return booking.serviceMode === "experience-custom-offer" && booking.selectedServices.length === 0;
}

function isApprovalQueueCustomRequest(booking: Booking) {
  if (isFinalizedBooking(booking)) {
    return false;
  }

  if (booking.serviceMode === "cook-custom-menu") {
    return booking.customMenuProposalStatus === "pending-admin-approval";
  }

  if (booking.serviceMode === "experience-custom-offer") {
    return booking.experienceCustomOfferStatus === "pending-admin-approval"
      || (isAdminManagedCustomServiceBooking(booking) && booking.experienceCustomOfferStatus === "pending");
  }

  return false;
}

function isPartnerQueueCustomRequest(booking: Booking) {
  if (isFinalizedBooking(booking)) {
    return false;
  }

  if (booking.serviceMode === "cook-custom-menu") {
    return booking.customMenuProposalStatus === "pending";
  }

  if (booking.serviceMode === "experience-custom-offer") {
    return booking.experienceCustomOfferStatus === "pending" && !isAdminManagedCustomServiceBooking(booking);
  }

  return false;
}

function getCustomRequestQueueLabel(booking: Booking) {
  if (isFinalizedBooking(booking)) {
    return booking.status === "cancelled" ? "Cancelled" : "Completed";
  }

  if (booking.serviceMode === "cook-custom-menu") {
    if (booking.customMenuProposalStatus === "pending-admin-approval") {
      return "Waiting Approval";
    }

    if (booking.customMenuProposalStatus === "proposed" || booking.customMenuProposalStatus === "declined") {
      return "Waiting Client";
    }

    return "Waiting Partner";
  }

  if (booking.serviceMode === "experience-custom-offer") {
    if (isApprovalQueueCustomRequest(booking)) {
      return "Waiting Approval";
    }

    if (booking.experienceCustomOfferStatus === "proposed" || booking.experienceCustomOfferStatus === "declined") {
      return "Waiting Client";
    }

    return "Waiting Partner";
  }

  return "Open";
}

function isAwaitingClientCustomMenuDecision(booking: Booking) {
  if (isFinalizedBooking(booking)) {
    return false;
  }

  return booking.serviceMode === "cook-custom-menu"
    && !!booking.customMenuReviewedAt
    && booking.customMenuClientDecision === "pending";
}

function isAwaitingClientExperienceDecision(booking: Booking) {
  if (isFinalizedBooking(booking)) {
    return false;
  }

  return booking.serviceMode === "experience-custom-offer"
    && !!booking.experienceCustomOfferReviewedAt
    && booking.experienceCustomOfferClientDecision === "pending";
}

function getCustomRequestLabel(booking: Booking) {
  if (booking.serviceMode === "cook-custom-menu") {
    return "Custom Menu";
  }

  if (booking.serviceMode === "experience-custom-offer" && booking.selectedServices.length === 0) {
    return "Custom Service";
  }

  if (booking.serviceMode === "experience-custom-offer") {
    return "Custom Experience";
  }

  return "Custom Request";
}

function getAdminStatusOptions(status: string): Array<{ value: string; label: string; disabled?: boolean }> {
  switch (status) {
    case "pending":
      return [{ value: "pending", label: "Pending (awaiting payment)", disabled: true }];
    case "pending-payment":
      return [{ value: "pending-payment", label: "Pending Payment (deposit paid)", disabled: true }];
    case "upcoming":
      return [
        { value: "upcoming", label: "Upcoming" },
        { value: "in-progress", label: "In Progress" },
        { value: "completed", label: "Completed" },
        { value: "cancelled", label: "Cancelled" },
      ];
    case "in-progress":
      return [
        { value: "in-progress", label: "In Progress" },
        { value: "completed", label: "Completed" },
        { value: "cancelled", label: "Cancelled" },
      ];
    case "late":
      return [
        { value: "late", label: "Late (current)", disabled: true },
        { value: "completed", label: "Completed" },
        { value: "cancelled", label: "Cancelled" },
      ];
    case "completed":
      return [{ value: "completed", label: "Completed" }];
    case "cancelled":
      return [{ value: "cancelled", label: "Cancelled" }];
    default:
      return [
        { value: "upcoming", label: "Upcoming" },
        { value: "in-progress", label: "In Progress" },
        { value: "completed", label: "Completed" },
        { value: "cancelled", label: "Cancelled" },
      ];
  }
}

function getRequestedStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "in-progress":
      return "In Progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Update";
  }
}

function getBookingScheduleSlots(booking: Booking) {
  return (booking.serviceScheduleSlots || [])
    .filter((slot): slot is { date: string; note: string } => !!slot?.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getBookingThreadInitialLabel(booking: Booking) {
  return booking.serviceMode === "errand-shopping" ? "Shopping List" : "Request";
}

function getVisibleServiceRequestDetails(booking: Booking) {
  if (!booking.serviceRequestDetails) {
    return null;
  }

  return booking.serviceRequestDetails
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("Budget (USD):") && !trimmed.startsWith("Budget entered:");
    })
    .join("\n")
    .trim() || null;
}

function getBudgetDisplay(booking: Booking, formatAmount: (amountUsd: number) => string) {
  const lines = booking.serviceRequestDetails?.split("\n") ?? [];
  const enteredBudgetLine = lines.find((line) => line.trim().startsWith("Budget entered:"));
  if (enteredBudgetLine) {
    return enteredBudgetLine.replace(/^Budget entered:\s*/, "").trim();
  }

  const legacyBudgetLine = lines.find((line) => line.trim().startsWith("Budget (USD):"));
  if (legacyBudgetLine) {
    const parsedAmount = Number(legacyBudgetLine.replace(/^Budget \(USD\):\s*/, "").trim());
    if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
      return formatAmount(parsedAmount);
    }
  }

  if (booking.serviceBudgetAmount) {
    return formatAmount(booking.serviceBudgetAmount);
  }

  return null;
}

function getBudgetAmountUsd(booking: Booking) {
  if (typeof booking.serviceBudgetAmount === "number" && Number.isFinite(booking.serviceBudgetAmount) && booking.serviceBudgetAmount > 0) {
    return booking.serviceBudgetAmount;
  }

  const lines = booking.serviceRequestDetails?.split("\n") ?? [];
  const legacyBudgetLine = lines.find((line) => line.trim().startsWith("Budget (USD):"));
  if (!legacyBudgetLine) {
    return null;
  }

  const parsedAmount = Number(legacyBudgetLine.replace(/^Budget \(USD\):\s*/, "").trim());
  return Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null;
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

function mergeUpdatedBooking(
  currentBookings: Booking[] | undefined,
  updatedBooking: Booking,
) {
  if (!currentBookings) {
    return [updatedBooking];
  }

  return currentBookings.map((booking) =>
    booking.id === updatedBooking.id ? updatedBooking : booking,
  );
}

export default function AdminBookings() {
  const search = useSearch();
  const { toast } = useToast();
  const { formatAmount, convertToUsd, selectedCurrency } = useCurrency();
  const [lifecycleFilter, setLifecycleFilter] = useState<string>("active");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [requestFilter, setRequestFilter] = useState<string>("all");
  const [proposalAmounts, setProposalAmounts] = useState<Record<string, string>>({});
  const [proposalMessages, setProposalMessages] = useState<Record<string, string>>({});
  const [declineReasons, setDeclineReasons] = useState<Record<string, string>>({});
  const [paymentActionNotes, setPaymentActionNotes] = useState<Record<string, string>>({});
  const [expandedBookingIds, setExpandedBookingIds] = useState<string[]>([]);
  const handledSearchIntentRef = useRef<string | null>(null);
  const pageIntent = useMemo(() => {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    return {
      bookingId: params.get("bookingId"),
      openThread: params.get("openThread") === "1",
    };
  }, [search]);
  
  const { data: bookings, isLoading: bookingsLoading } = useQuery<Booking[]>({
    queryKey: ["/api/admin/bookings"],
  });

  const { data: accommodations } = useQuery<Stay[]>({
    queryKey: ["/api/admin/stays"],
  });

  const { data: cars } = useQuery<CarType[]>({
    queryKey: ["/api/admin/cars"],
  });

  const { data: cooks } = useQuery<Cook[]>({
    queryKey: ["/api/admin/cooks"],
  });

  const { data: errands } = useQuery<Errand[]>({
    queryKey: ["/api/admin/errands"],
  });

  const { data: experiences } = useQuery<Experience[]>({
    queryKey: ["/api/admin/experiences"],
  });

  const getSubmittedProposalAmountUsd = (enteredAmount: string | undefined, existingAmount?: number | null) => {
    const parsedAmount = Number(enteredAmount ?? "");
    if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
      return convertToUsd(parsedAmount);
    }

    return existingAmount ?? 0;
  };

  const openBookingDetails = (bookingId: string) => {
    setExpandedBookingIds((current) => (current.includes(bookingId) ? current : [...current, bookingId]));

    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        document.getElementById(`admin-booking-${bookingId}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 80);
    }
  };

  const submitEnteredBudgetAsOffer = (booking: Booking) => {
    const budgetAmountUsd = getBudgetAmountUsd(booking);
    if (!budgetAmountUsd) {
      return;
    }

    reviewExperienceOfferMutation.mutate({
      id: booking.id,
      payload: {
        action: "propose",
        proposedAmount: budgetAmountUsd,
        proposalMessage: proposalMessages[booking.id] ?? booking.experienceCustomOfferMessage ?? "",
      },
    });
  };

  // Filter bookings based on status and type
  const filteredBookings = useMemo(() => {
    if (!bookings) return [];
    
    return bookings.filter((booking) => {
      const lifecycleMatch = lifecycleFilter === "all"
        || (lifecycleFilter === "active" && !isHistoryBookingStatus(booking.status))
        || (lifecycleFilter === "history" && isHistoryBookingStatus(booking.status));
      const statusMatch = statusFilter === "all" || booking.status === statusFilter;
      const typeMatch = typeFilter === "all" || 
        (typeFilter === "accommodation" && booking.accommodationId) ||
        (typeFilter === "service" && !booking.accommodationId);
      const requestMatch = requestFilter === "all"
        || (requestFilter === "custom" && isPendingCustomRequestBooking(booking))
        || (requestFilter === "standard" && !isPendingCustomRequestBooking(booking));
      
      return lifecycleMatch && statusMatch && typeMatch && requestMatch;
    });
  }, [bookings, lifecycleFilter, statusFilter, typeFilter, requestFilter]);

  const customRequestBookings = useMemo(
    () => filteredBookings.filter((booking) => isPendingCustomRequestBooking(booking)),
    [filteredBookings],
  );

  const partnerQueueCount = useMemo(
    () => customRequestBookings.filter((booking) => isPartnerQueueCustomRequest(booking)).length,
    [customRequestBookings],
  );

  const approvalQueueCount = useMemo(
    () =>
      customRequestBookings.filter(
        (booking) => isApprovalQueueCustomRequest(booking),
      ).length,
    [customRequestBookings],
  );

  const clientQueueCount = useMemo(
    () =>
      customRequestBookings.filter(
        (booking) =>
          booking.customMenuProposalStatus === "proposed" ||
          booking.customMenuProposalStatus === "declined" ||
          booking.experienceCustomOfferStatus === "proposed" ||
          booking.experienceCustomOfferStatus === "declined",
      ).length,
    [customRequestBookings],
  );

  const activeBookingsCount = useMemo(
    () => (bookings || []).filter((booking) => !isHistoryBookingStatus(booking.status)).length,
    [bookings],
  );

  const historyBookingsCount = useMemo(
    () => (bookings || []).filter((booking) => isHistoryBookingStatus(booking.status)).length,
    [bookings],
  );
  const hasActiveFilters = lifecycleFilter !== "active"
    || statusFilter !== "all"
    || typeFilter !== "all"
    || requestFilter !== "all";

  useEffect(() => {
    if (!pageIntent.bookingId || !bookings?.length) {
      return;
    }

    if (filteredBookings.some((booking) => booking.id === pageIntent.bookingId)) {
      return;
    }

    const matchedBooking = bookings.find((booking) => booking.id === pageIntent.bookingId);
    if (!matchedBooking) {
      return;
    }

    setLifecycleFilter("all");
    setStatusFilter("all");
    setTypeFilter("all");
    setRequestFilter("all");
  }, [bookings, filteredBookings, pageIntent.bookingId]);

  useEffect(() => {
    if (!pageIntent.bookingId) {
      handledSearchIntentRef.current = null;
      return;
    }

    if (!filteredBookings.some((booking) => booking.id === pageIntent.bookingId)) {
      return;
    }

    const intentKey = `${pageIntent.bookingId}:${pageIntent.openThread ? "thread" : "booking"}`;
    if (handledSearchIntentRef.current === intentKey) {
      return;
    }

    handledSearchIntentRef.current = intentKey;
    setExpandedBookingIds((current) => (
      current.includes(pageIntent.bookingId!)
        ? current
        : [...current, pageIntent.bookingId!]
    ));

    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        document.getElementById(`admin-booking-${pageIntent.bookingId}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 80);
    }
  }, [filteredBookings, pageIntent.bookingId, pageIntent.openThread]);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: BookingStatus }) => {
      return await apiRequest("PATCH", `/api/admin/bookings/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bookings"] });
      toast({
        title: "Success",
        description: "Booking status updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const reviewCustomMenuMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/admin/bookings/${id}/custom-menu-proposal`, payload),
    onSuccess: async (response, variables) => {
      const updatedBooking = await response.json();
      queryClient.setQueryData<Booking[]>(["/api/admin/bookings"], (current) => mergeUpdatedBooking(current, updatedBooking));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bookings"] });
      setProposalAmounts((current) => ({ ...current, [variables.id]: "" }));
      setProposalMessages((current) => ({ ...current, [variables.id]: "" }));
      setDeclineReasons((current) => ({ ...current, [variables.id]: "" }));
      toast({ title: "Request reviewed", description: "The client-facing custom menu status has been updated." });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not review request",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const reviewExperienceOfferMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/admin/bookings/${id}/experience-custom-offer`, payload),
    onSuccess: async (response, variables) => {
      const updatedBooking = await response.json();
      queryClient.setQueryData<Booking[]>(["/api/admin/bookings"], (current) => mergeUpdatedBooking(current, updatedBooking));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bookings"] });
      setProposalAmounts((current) => ({ ...current, [variables.id]: "" }));
      setProposalMessages((current) => ({ ...current, [variables.id]: "" }));
      setDeclineReasons((current) => ({ ...current, [variables.id]: "" }));
      toast({ title: "Custom offer updated", description: "The client-facing experience offer has been updated." });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update custom offer",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const reviewProviderStatusRequestMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "decline" }) =>
      apiRequest("PATCH", `/api/admin/bookings/${id}/provider-status-request`, { action }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bookings"] });
      toast({
        title: variables.action === "approve" ? "Provider request approved" : "Provider request declined",
        description: variables.action === "approve"
          ? "The booking status was updated and the request was cleared."
          : "The request was cleared without changing the booking status.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not review provider request",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const requireDepositMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const response = await apiRequest("PATCH", `/api/admin/bookings/${id}/require-deposit`);
      return await response.json() as Booking;
    },
    onSuccess: (updatedBooking) => {
      queryClient.setQueryData<Booking[]>(["/api/admin/bookings"], (current) => mergeUpdatedBooking(current, updatedBooking));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bookings"] });
      toast({
        title: "Deposit required",
        description: "The client can now pay the 50% deposit from My Bookings to lock the dates.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not require a deposit",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const paymentActionMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: { action: "payment-received-cash" | "payment-received-mpesa" | "send-reminder" | "cancel-booking"; note?: string } }) => {
      const response = await apiRequest("PATCH", `/api/admin/bookings/${id}/payment-action`, payload);
      return await response.json() as Booking;
    },
    onSuccess: async (updatedBooking, variables) => {
      queryClient.setQueryData<Booking[]>(["/api/admin/bookings"], (current) => mergeUpdatedBooking(current, updatedBooking));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bookings"] });
      setPaymentActionNotes((current) => ({ ...current, [variables.id]: "" }));
      const hasRemainingBalance = getBookingOutstandingAmount(updatedBooking) > 0;
      toast({
        title: variables.payload.action === "payment-received-cash" || variables.payload.action === "payment-received-mpesa"
          ? variables.payload.action === "payment-received-mpesa"
            ? hasRemainingBalance ? "M-Pesa deposit recorded" : "M-Pesa payment recorded"
            : hasRemainingBalance ? "Cash deposit recorded" : "Cash payment recorded"
          : variables.payload.action === "send-reminder"
            ? "Reminder sent"
            : "Booking cancelled",
        description: variables.payload.action === "payment-received-cash" || variables.payload.action === "payment-received-mpesa"
          ? hasRemainingBalance
            ? "The deposit was recorded and the dates remain locked while the balance stays pending."
            : "The booking is now fully paid and ready for the active workflow."
          : variables.payload.action === "send-reminder"
            ? "The customer has received the reminder note in the booking thread."
            : "The booking has been cancelled.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update payment state",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const getAccommodation = (id: string | null) => {
    if (!id) return null;
    return accommodations?.find((a) => a.id === id);
  };

  const getSelectedItem = (id: string) => {
    const car = cars?.find((item) => item.id === id);
    if (car) {
      return { type: "car" as const, title: car.model };
    }

    const cook = cooks?.find((item) => item.id === id);
    if (cook) {
      return { type: "cook" as const, title: cook.title };
    }

    const errand = errands?.find((item) => item.id === id);
    if (errand) {
      return { type: "errand" as const, title: errand.serviceName };
    }

    const experience = experiences?.find((item) => item.id === id);
    if (experience) {
      return { type: "experience" as const, title: experience.title };
    }

    return null;
  };

  const getServiceIcon = (type: "car" | "cook" | "errand" | "experience") => {
    switch (type) {
      case "car":
        return <Car className="h-4 w-4" />;
      case "cook":
        return <ChefHat className="h-4 w-4" />;
      case "experience":
        return <Compass className="h-4 w-4" />;
      default:
        return <ShoppingBag className="h-4 w-4" />;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (timeString?: string | null) => {
    if (!timeString) return null;
    const [hours, minutes] = timeString.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-amber-600">Pending</Badge>;
      case "pending-payment":
        return <Badge className="bg-orange-500">Pending Payment</Badge>;
      case "upcoming":
        return <Badge variant="default">Upcoming</Badge>;
      case "in-progress":
        return <Badge className="bg-green-600">In Progress</Badge>;
      case "late":
        return <Badge className="bg-amber-600">Late</Badge>;
      case "completed":
        return <Badge variant="secondary">Completed</Badge>;
      case "cancelled":
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getProviderRequestBadge = (status: string | null | undefined) => {
    if (!status) {
      return null;
    }

    return <Badge className="bg-blue-600">Partner Requested {getRequestedStatusLabel(status)}</Badge>;
  };

  const getFinalizedWorkflowBadge = (booking: Pick<Booking, "status">) => (
    booking.status === "cancelled"
      ? <Badge variant="destructive">Cancelled</Badge>
      : <Badge variant="secondary">Completed</Badge>
  );

  const getProposalBadge = (proposalStatus: string) => {
    switch (proposalStatus) {
      case "pending-admin-approval":
        return <Badge className="bg-blue-600">Needs Admin Approval</Badge>;
      case "proposed":
        return <Badge className="bg-amber-600">Pending Confirmation</Badge>;
      case "declined":
        return <Badge variant="destructive">Decline Sent</Badge>;
      default:
        return <Badge variant="outline">Pending Chef Review</Badge>;
    }
  };

  const isClosedCustomMenu = (booking: Booking) =>
    booking.serviceMode === "cook-custom-menu" &&
    booking.customMenuClientDecision === "accepted";

  const getCustomMenuWorkflowBadge = (booking: Booking) => {
    if (isFinalizedBooking(booking)) {
      return getFinalizedWorkflowBadge(booking);
    }

    if (isClosedCustomMenu(booking)) {
      return <Badge variant="secondary">Fulfilled</Badge>;
    }

    return getProposalBadge(booking.customMenuProposalStatus);
  };

  const getExperienceOfferBadge = (booking: Booking) => {
    if (isFinalizedBooking(booking)) {
      return getFinalizedWorkflowBadge(booking);
    }

    if (isAcceptedExperienceOfferAwaitingPayment(booking)) {
      return <Badge className="bg-amber-600">Accepted - Pending Payment</Badge>;
    }

    if (isClosedExperienceOffer(booking)) {
      return <Badge className="bg-emerald-600">Accepted</Badge>;
    }

    switch (booking.experienceCustomOfferStatus) {
      case "pending-admin-approval":
        return <Badge className="bg-blue-600">Admin Review</Badge>;
      case "proposed":
        return <Badge className="bg-amber-600">With Client</Badge>;
      case "declined":
        return <Badge variant="destructive">Declined</Badge>;
      default:
        return <Badge variant="outline">{isAdminManagedCustomServiceBooking(booking) ? "Waiting Approval" : "Waiting Partner"}</Badge>;
    }
  };

  const isClosedExperienceOffer = (booking: Booking) =>
    booking.serviceMode === "experience-custom-offer" &&
    booking.experienceCustomOfferClientDecision === "accepted";

  const isAcceptedExperienceOfferAwaitingPayment = (booking: Booking) =>
    isClosedExperienceOffer(booking) &&
    booking.paymentStatus !== "paid";

  const getExperienceOfferStatusText = (booking: Booking) => {
    if (isFinalizedBooking(booking)) {
      return booking.status === "cancelled"
        ? "Booking cancelled by admin. Offer actions are locked."
        : "Booking completed by admin. Offer actions are locked.";
    }

    if (isClosedExperienceOffer(booking)) {
      return isAcceptedExperienceOfferAwaitingPayment(booking)
        ? "Accepted by client. Awaiting payment."
        : "Accepted by client and paid.";
    }

    if (isAwaitingClientExperienceDecision(booking)) {
      return "Waiting for client decision.";
    }

    switch (booking.experienceCustomOfferStatus) {
      case "pending-admin-approval":
        return "Ready for review.";
      case "proposed":
        return "Shared with client.";
      case "declined":
        return "Declined.";
      default:
        return isAdminManagedCustomServiceBooking(booking) ? "Waiting for admin review." : "Waiting for partner.";
    }
  };

  if (bookingsLoading) {
    return (
      <AdminLayout>
        <div className="p-4 pb-8 sm:p-6 lg:p-8">
          <Skeleton className="mb-6 h-10 w-52 sm:mb-8 sm:h-12 sm:w-64" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-4 sm:p-6">
                  <Skeleton className="h-40 w-full sm:h-32" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-4 pb-8 sm:p-6 lg:p-8">
        <div className="mb-6 space-y-2 sm:mb-8">
          <h1 className="font-serif text-3xl font-semibold sm:text-4xl" data-testid="heading-admin-bookings">
            Bookings Management
          </h1>
          <p className="text-muted-foreground">
            View and manage all customer bookings
          </p>
        </div>

        {/* Filters */}
        <Card className="mb-6 overflow-hidden border-stone-200/80 bg-white/95 shadow-sm">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Filters</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">View</label>
                    <Select value={lifecycleFilter} onValueChange={setLifecycleFilter}>
                      <SelectTrigger className="w-full" data-testid="filter-lifecycle">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active Orders</SelectItem>
                        <SelectItem value="history">Order History</SelectItem>
                        <SelectItem value="all">All Orders</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">Status</label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-full" data-testid="filter-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="pending-payment">Pending Payment</SelectItem>
                        <SelectItem value="upcoming">Upcoming</SelectItem>
                        <SelectItem value="in-progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">Request Type</label>
                    <Select value={requestFilter} onValueChange={setRequestFilter}>
                      <SelectTrigger className="w-full" data-testid="filter-request-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Booking Flows</SelectItem>
                        <SelectItem value="custom">Custom Requests</SelectItem>
                        <SelectItem value="standard">Standard Orders</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 sm:col-span-2 xl:col-span-1">
                    <label className="text-sm font-medium text-muted-foreground">Type</label>
                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                      <SelectTrigger className="w-full" data-testid="filter-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="accommodation">Accommodation + Services</SelectItem>
                        <SelectItem value="service">Service Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {hasActiveFilters ? (
                  <Button
                    variant="ghost"
                    className="w-full justify-center sm:w-auto sm:justify-start"
                    onClick={() => {
                      setLifecycleFilter("active");
                      setStatusFilter("all");
                      setTypeFilter("all");
                      setRequestFilter("all");
                    }}
                    data-testid="button-reset-filters"
                  >
                    Reset Filters
                  </Button>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[24rem]">
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Active</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{activeBookingsCount}</div>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Archived</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{historyBookingsCount}</div>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Visible</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{filteredBookings.length}</div>
                  <div className="mt-1 text-xs text-muted-foreground">of {bookings?.length || 0} bookings</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {bookings && bookings.length === 0 ? (
          <Card className="p-8 text-center sm:p-12">
            <div className="mx-auto max-w-md">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Calendar className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-xl font-semibold">No bookings yet</h3>
              <p className="text-muted-foreground">
                Bookings will appear here once customers start making reservations
              </p>
            </div>
          </Card>
        ) : filteredBookings.length === 0 ? (
          <Card className="p-8 text-center sm:p-12">
            <div className="mx-auto max-w-md">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Filter className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-xl font-semibold">No bookings match your filters</h3>
              <p className="text-muted-foreground">
                Try adjusting your filters to see more results
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setLifecycleFilter("active");
                  setStatusFilter("all");
                  setTypeFilter("all");
                  setRequestFilter("all");
                }}
                data-testid="button-reset-filters"
              >
                Reset Filters
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {customRequestBookings.length ? (
              <Card className="overflow-hidden border-stone-200/80 bg-white/90 shadow-sm">
                <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
                  <CardTitle>Custom Requests</CardTitle>
                  <CardDescription>Review request-stage quotes separately until the client accepts and pays.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-4 pt-4 sm:p-6 sm:pt-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                      <div className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Waiting Partner</div>
                      <div className="mt-2 text-2xl font-semibold text-foreground">{partnerQueueCount}</div>
                    </div>
                    <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                      <div className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Waiting Approval</div>
                      <div className="mt-2 text-2xl font-semibold text-foreground">{approvalQueueCount}</div>
                    </div>
                    <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                      <div className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Waiting Client</div>
                      <div className="mt-2 text-2xl font-semibold text-foreground">{clientQueueCount}</div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {customRequestBookings.map((booking) => {
                      const serviceLabel = getCustomRequestLabel(booking);
                      return (
                        <div key={`admin-custom-request-${booking.id}`} className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="space-y-2">
                              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-teal-700">
                                {serviceLabel} #{getShortBookingReference(booking.id)}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {booking.guestName}
                                {booking.serviceLocation ? ` / ${booking.serviceLocation}` : ""}
                                {booking.checkIn ? ` / ${booking.checkIn}` : ""}
                              </div>
                              <p className="max-w-3xl text-sm leading-6 text-stone-700">
                                {getRequestPreview(getVisibleServiceRequestDetails(booking) || booking.serviceRequestDetails)}
                              </p>
                            </div>
                            <div className="flex flex-col items-start gap-2 md:items-end">
                              <Badge variant="secondary">{getCustomRequestQueueLabel(booking)}</Badge>
                              {booking.serviceMode === "cook-custom-menu"
                                ? getProposalBadge(booking.customMenuProposalStatus)
                                : getExperienceOfferBadge(booking)}
                              <button
                                type="button"
                                className="text-sm font-medium text-teal-700 underline-offset-4 hover:underline"
                                onClick={() => openBookingDetails(booking.id)}
                              >
                                Open details
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Accordion
              type="multiple"
              value={expandedBookingIds}
              onValueChange={setExpandedBookingIds}
              className="space-y-4"
            >
            {filteredBookings.map((booking) => {
              const accommodation = getAccommodation(booking.accommodationId);
              const isServiceOnly = booking.bookingType === "service" || !booking.accommodationId;
              const bookingTitle = isServiceOnly ? "Service Booking" : accommodation?.title || "Accommodation Booking";
              const bookingSummary = [
                booking.guestName,
                booking.serviceLocation || accommodation?.location || null,
                booking.checkIn,
              ].filter(Boolean).join(" / ");
              const amountPaid = getBookingAmountPaid(booking);
              const outstandingAmount = getBookingOutstandingAmount(booking);
              const requiredDepositAmount = calculateBookingDepositAmount(booking.totalPrice);
              const cashCollectionAmount = getBookingCheckoutAmount(booking);
              const balanceAfterCashCollection = Math.max(0, outstandingAmount - cashCollectionAmount);
              const hasOutstandingPayment = hasOutstandingBookingPayment(booking);
              const isDepositLockedBooking = hasLockedInBookingDeposit(booking);
              const fullPaymentOnlyBooking = isFullPaymentOnlyBooking(booking);
              const hasConfiguredDepositRule = supportsBookingDeposit(booking) && typeof booking.paymentDepositAmount === "number"
                && booking.paymentDepositAmount > 0
                && booking.paymentDepositAmount < booking.totalPrice;
              const isFiftyPercentDepositRule = hasConfiguredDepositRule && booking.paymentDepositAmount === requiredDepositAmount;
              const isDepositCashCollection = amountPaid === 0 && cashCollectionAmount > 0 && cashCollectionAmount < outstandingAmount;
              const isTemporaryMpesaReview = booking.paymentProvider === "mpesa-manual" && booking.paymentStatus === "processing";
              const cashActionLabel = isDepositCashCollection
                ? "Deposit Received Cash"
                : amountPaid > 0
                  ? "Balance Received Cash"
                  : "Full Payment Received Cash";
              const manualMpesaActionLabel = isDepositCashCollection
                ? "Confirm M-Pesa Deposit"
                : amountPaid > 0
                  ? "Confirm M-Pesa Balance"
                  : "Confirm Full M-Pesa";

              return (
                <AccordionItem key={booking.id} value={booking.id} className="border-none" id={`admin-booking-${booking.id}`}>
                  <Card className="overflow-hidden border-stone-200/80 bg-white/95 shadow-sm" data-testid={`admin-booking-${booking.id}`}>
                    <AccordionTrigger className="px-4 py-4 text-left hover:no-underline sm:px-6 sm:py-5">
                      <div className="flex w-full flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0 space-y-2">
                          <CardTitle className="text-base sm:text-lg">{bookingTitle}</CardTitle>
                          <CardDescription className="break-words">
                            Booking ID: {booking.id}
                          </CardDescription>
                          <div className="text-sm text-muted-foreground">{bookingSummary}</div>
                          <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            Open order details
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end">
                          {getStatusBadge(booking.status)}
                          {getProviderRequestBadge(booking.providerStatusRequest)}
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:gap-6">
                      {/* Booking Details */}
                      <div className="space-y-3 rounded-2xl border bg-muted/20 p-4 sm:p-5">
                        <div>
                          <div className="text-sm font-medium mb-1">Guest Information</div>
                          <div className="space-y-1.5 text-sm text-muted-foreground">
                            <div>{booking.guestName}</div>
                            <div className="flex items-start gap-2">
                              <Mail className="h-3 w-3" />
                              <span className="break-all">{booking.guestEmail}</span>
                            </div>
                            {booking.guestPhone && (
                              <div className="mt-1 flex items-start gap-2">
                                <Phone className="h-3 w-3" />
                                <span className="break-words">{booking.guestPhone}</span>
                              </div>
                            )}
                            {booking.serviceMode?.startsWith("errand-") ? null : (
                              <div className="mt-1 flex items-start gap-2">
                                <Users className="h-3 w-3" />
                                <span>{booking.guests} {booking.guests > 1 ? "guests" : "guest"}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {!isServiceOnly && accommodation && (
                          <div>
                            <div className="text-sm font-medium mb-1">Location</div>
                            <div className="flex items-start gap-2 text-sm text-muted-foreground">
                              <MapPin className="h-3 w-3" />
                              <span className="break-words">{accommodation.location}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Dates */}
                      <div className="space-y-3 rounded-2xl border bg-muted/20 p-4 sm:p-5">
                        <div>
                          {booking.serviceMode?.startsWith("errand-") && getBookingScheduleSlots(booking).length > 0 ? (
                            <>
                              <div className="text-sm font-medium mb-1">Booked Packages</div>
                              <div className="space-y-1 text-sm text-muted-foreground">
                                {getBookingScheduleSlots(booking).map((slot, index) => (
                                  <div key={`${slot.date}-${slot.note}-${index}`} className="flex items-start gap-2">
                                    <Calendar className="mt-0.5 h-3 w-3" />
                                    <span>{formatDate(slot.date)}{slot.note?.trim() ? ` - ${slot.note.trim()}` : ""}</span>
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="text-sm font-medium mb-1">
                                {isServiceOnly ? "Service Period" : "Check-in / Check-out"}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                <div className="flex items-center gap-2">
                                  <Calendar className="h-3 w-3" />
                                  <span>{formatDate(booking.checkIn)}</span>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <Calendar className="h-3 w-3" />
                                  <span>{formatDate(booking.checkOut)}</span>
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        <div>
                          <div className="text-sm font-medium mb-1">Total Price</div>
                          <div className="text-xl font-semibold">{formatAmount(booking.totalPrice)}</div>
                        </div>
                        {amountPaid > 0 && amountPaid < booking.totalPrice ? (
                          <>
                            <div>
                              <div className="text-sm font-medium mb-1">Paid So Far</div>
                              <div className="text-sm text-muted-foreground">{formatAmount(amountPaid)}</div>
                            </div>
                            <div>
                              <div className="text-sm font-medium mb-1">Balance Due</div>
                              <div className="text-sm text-muted-foreground">{formatAmount(outstandingAmount)}</div>
                            </div>
                          </>
                        ) : null}

                        {booking.serviceLocation && (
                          <div>
                            <div className="text-sm font-medium mb-1">Service Location</div>
                            <div className="flex items-start gap-2 text-sm text-muted-foreground">
                              <MapPin className="h-3 w-3" />
                              <span className="break-words">{booking.serviceLocation}</span>
                            </div>
                          </div>
                        )}

                        {booking.servicePickupLocation && (
                          <div>
                            <div className="text-sm font-medium mb-1">Pickup Location</div>
                            <div className="break-words text-sm text-muted-foreground">{booking.servicePickupLocation}</div>
                          </div>
                        )}

                        {booking.serviceReturnLocation && (
                          <div>
                            <div className="text-sm font-medium mb-1">Return Location</div>
                            <div className="break-words text-sm text-muted-foreground">{booking.serviceReturnLocation}</div>
                          </div>
                        )}

                        {booking.serviceZone && (
                          <div>
                            <div className="text-sm font-medium mb-1">Zone</div>
                            <div className="break-words text-sm text-muted-foreground">{booking.serviceZone}</div>
                          </div>
                        )}
                      </div>

                      {/* Services & Actions */}
                      <div className="space-y-3 rounded-2xl border bg-muted/20 p-4 sm:p-5">
                        {booking.selectedServices.length > 0 && (
                          <div>
                            <div className="text-sm font-medium mb-2">Selected Services</div>
                            <div className="flex flex-wrap gap-2">
                              {booking.selectedServices.map((serviceId) => {
                                const service = getSelectedItem(serviceId);
                                return (
                                  <Badge key={serviceId} variant="secondary" className="flex max-w-full items-center gap-1 whitespace-normal text-xs">
                                    {service && getServiceIcon(service.type)}
                                    {service?.title || "Service"}
                                  </Badge>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <BookingServiceDetails
                          booking={booking}
                          getServiceById={(serviceId) => {
                            const service = getSelectedItem(serviceId);
                            if (!service) return null;
                            return cars?.find((item) => item.id === serviceId)
                              || cooks?.find((item) => item.id === serviceId)
                              || errands?.find((item) => item.id === serviceId)
                              || experiences?.find((item) => item.id === serviceId)
                              || null;
                          }}
                          formatAmount={formatAmount}
                          formatTime={formatTime}
                          hideRequestDetails={booking.serviceMode === "cook-custom-menu" || booking.serviceMode === "experience-custom-offer"}
                        />

                        {booking.serviceMode && (!booking.stayServiceSelections || booking.stayServiceSelections.length === 0) && (
                          <div>
                            <div className="text-sm font-medium mb-2">Mode</div>
                            <Badge variant="outline" className="whitespace-normal break-words">
                              {booking.serviceMode === "car-chauffeur-hourly"
                                ? `Chauffeur hourly${booking.serviceHours ? ` (${booking.serviceHours}h)` : ""}${booking.serviceStartTime && booking.serviceEndTime ? ` ${formatTime(booking.serviceStartTime)}-${formatTime(booking.serviceEndTime)}` : ""}`
                                : booking.serviceMode === "car-self-drive-day"
                                  ? "Self-drive daily"
                                  : booking.serviceMode === "car-chauffeur-day"
                                    ? "Chauffeur daily"
                                    : booking.serviceMode}
                            </Badge>
                          </div>
                        )}

                        {booking.serviceMode === "errand-shopping" && booking.serviceBudgetAmount && (!booking.stayServiceSelections || booking.stayServiceSelections.length === 0) ? (
                          <div className="rounded-lg border p-3">
                            <div className="text-sm text-muted-foreground">
                              Budget: <span className="font-medium text-foreground">{formatAmount(booking.serviceBudgetAmount)}</span>
                            </div>
                          </div>
                        ) : null}

                        {booking.serviceMode === "cook-custom-menu" && (
                          <div className="rounded-lg border p-3 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-medium">Custom Menu Review</div>
                              {getCustomMenuWorkflowBadge(booking)}
                            </div>
                            {getBudgetDisplay(booking, formatAmount) ? (
                              <div className="text-sm text-muted-foreground">
                                Budget: <span className="font-medium text-foreground">{getBudgetDisplay(booking, formatAmount)}</span>
                              </div>
                            ) : null}
                            {getVisibleServiceRequestDetails(booking) ? (
                              <RequestBriefAccordion
                                id={`admin-cook-brief-${booking.id}`}
                                title={`Custom Menu #${getShortBookingReference(booking.id)}`}
                                summary={getRequestPreview(getVisibleServiceRequestDetails(booking))}
                                content={getVisibleServiceRequestDetails(booking) || ""}
                                accent="amber"
                              />
                            ) : null}
                            {isAwaitingClientCustomMenuDecision(booking) ? (
                              <div className="text-sm text-muted-foreground rounded-md bg-muted/40 p-3">
                                Pending confirmation from the client.
                              </div>
                            ) : null}
                            {booking.customMenuProposalStatus === "proposed" && booking.customMenuProposedAmount ? (
                              <div className="text-sm text-muted-foreground">
                                Quote sent to client: <span className="font-medium text-foreground">{formatAmount(booking.customMenuProposedAmount)}</span>
                                {booking.customMenuProposalMessage ? ` / ${booking.customMenuProposalMessage}` : ""}
                              </div>
                            ) : null}
                            {booking.customMenuProposalStatus === "pending-admin-approval" ? (
                              <div className="text-sm text-muted-foreground">
                                {booking.customMenuProposedAmount
                                  ? <>Chef submitted full quote: <span className="font-medium text-foreground">{formatAmount(booking.customMenuProposedAmount)}</span>{booking.customMenuProposalMessage ? ` / ${booking.customMenuProposalMessage}` : ""}</>
                                  : booking.customMenuDeclineReason
                                    ? <>Chef submitted decline reason: {booking.customMenuDeclineReason}</>
                                    : "A chef response is waiting for your approval."}
                              </div>
                            ) : null}
                            {booking.customMenuProposalStatus === "declined" && booking.customMenuDeclineReason ? (
                              <div className="text-sm text-muted-foreground">
                                Decline reason: {booking.customMenuDeclineReason}
                              </div>
                            ) : null}
                            {isFinalizedBooking(booking) ? (
                              <div className="text-sm text-muted-foreground rounded-md bg-muted/40 p-3">
                                {booking.status === "cancelled"
                                  ? "This booking was cancelled by admin. Custom menu actions are now locked."
                                  : "This booking was marked completed by admin. Custom menu actions are now locked."}
                              </div>
                            ) : isClosedCustomMenu(booking) ? (
                              <div className="text-sm text-muted-foreground rounded-md bg-muted/40 p-3">
                                This custom menu offer has been accepted by the customer and is now closed for editing.
                              </div>
                            ) : null}
                            {!isFinalizedBooking(booking) && !isClosedCustomMenu(booking) && !isAwaitingClientCustomMenuDecision(booking) ? <Input
                              type="number"
                              min="1"
                              placeholder={`Quoted total (${selectedCurrency})`}
                              value={proposalAmounts[booking.id] ?? ""}
                              onChange={(e) => setProposalAmounts((current) => ({ ...current, [booking.id]: e.target.value }))}
                            /> : null}
                            {!isFinalizedBooking(booking) && !isClosedCustomMenu(booking) && !isAwaitingClientCustomMenuDecision(booking) ? <Textarea
                              rows={3}
                              placeholder="Note or decline reason"
                              value={booking.customMenuDeclineReason
                                ? (declineReasons[booking.id] ?? booking.customMenuDeclineReason ?? "")
                                : (proposalMessages[booking.id] ?? booking.customMenuProposalMessage ?? "")}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (booking.customMenuDeclineReason) {
                                  setDeclineReasons((current) => ({ ...current, [booking.id]: value }));
                                  return;
                                }
                                setProposalMessages((current) => ({ ...current, [booking.id]: value }));
                                setDeclineReasons((current) => ({ ...current, [booking.id]: value }));
                              }}
                            /> : null}
                            {!isFinalizedBooking(booking) && !isClosedCustomMenu(booking) && !isAwaitingClientCustomMenuDecision(booking) ? <div className="flex flex-col gap-2 sm:flex-row">
                              <Button
                                variant="outline"
                                disabled={reviewCustomMenuMutation.isPending}
                                onClick={() => reviewCustomMenuMutation.mutate({
                                  id: booking.id,
                                  payload: {
                                    action: "propose",
                                    proposedAmount: getSubmittedProposalAmountUsd(
                                      proposalAmounts[booking.id],
                                      booking.customMenuProposedAmount,
                                    ),
                                    proposalMessage: proposalMessages[booking.id] ?? booking.customMenuProposalMessage ?? "",
                                  },
                                })}
                              >
                                {booking.customMenuProposalStatus === "pending-admin-approval" ? "Approve Quote" : "Send Quote"}
                              </Button>
                              <Button
                                variant="destructive"
                                disabled={reviewCustomMenuMutation.isPending}
                                onClick={() => reviewCustomMenuMutation.mutate({
                                  id: booking.id,
                                  payload: {
                                    action: "decline",
                                    declineReason: declineReasons[booking.id] ?? proposalMessages[booking.id] ?? booking.customMenuDeclineReason ?? "",
                                  },
                                })}
                              >
                                {booking.customMenuProposalStatus === "pending-admin-approval" ? "Approve Decline" : "Decline"}
                              </Button>
                              {booking.customMenuProposalStatus === "pending-admin-approval" ? (
                                <Button
                                  variant="secondary"
                                  disabled={reviewCustomMenuMutation.isPending}
                                  onClick={() => reviewCustomMenuMutation.mutate({
                                    id: booking.id,
                                    payload: { action: "reopen" },
                                  })}
                                >
                                  Reopen
                                </Button>
                              ) : null}
                            </div> : null}
                          </div>
                        )}

                        {booking.serviceMode === "experience-custom-offer" && (
                          <div className="rounded-lg border p-3 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="space-y-1">
                                <div className="text-sm font-medium">Offer Review</div>
                                <div className="text-xs text-muted-foreground">{getExperienceOfferStatusText(booking)}</div>
                              </div>
                              {getExperienceOfferBadge(booking)}
                            </div>
                            {getBudgetDisplay(booking, formatAmount) ? (
                              <div className="rounded-md bg-muted/40 p-3">
                                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Entered Budget</div>
                                <div className="mt-1 text-sm font-medium text-foreground">{getBudgetDisplay(booking, formatAmount)}</div>
                              </div>
                            ) : null}
                            {booking.serviceRequestDetails ? (
                              <RequestBriefAccordion
                                id={`admin-experience-brief-${booking.id}`}
                                title={`Request Brief #${getShortBookingReference(booking.id)}`}
                                summary={getRequestPreview(booking.serviceRequestDetails)}
                                content={booking.serviceRequestDetails}
                                accent="sky"
                              />
                            ) : null}
                            {booking.experienceCustomOfferAmount ? (
                              <div className="rounded-md bg-muted/40 p-3">
                                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                  {booking.experienceCustomOfferStatus === "pending-admin-approval" ? "Submitted Offer" : "Offer Total"}
                                </div>
                                <div className="mt-1 text-sm font-medium text-foreground">{formatAmount(booking.experienceCustomOfferAmount)}</div>
                              </div>
                            ) : null}
                            {booking.experienceCustomOfferMessage ? (
                              <div className="rounded-md bg-muted/40 p-3">
                                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Offer Note</div>
                                <div className="mt-1 text-sm text-muted-foreground">{booking.experienceCustomOfferMessage}</div>
                              </div>
                            ) : null}
                            {booking.experienceCustomOfferDeclineReason ? (
                              <div className="rounded-md bg-muted/40 p-3">
                                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Decline Reason</div>
                                <div className="mt-1 text-sm text-muted-foreground">{booking.experienceCustomOfferDeclineReason}</div>
                              </div>
                            ) : null}
                            {false && booking.experienceCustomOfferStatus === "proposed" && booking.experienceCustomOfferAmount ? (
                              <div className="text-sm text-muted-foreground">
                                Quote sent to client: <span className="font-medium text-foreground">{formatAmount(booking.experienceCustomOfferAmount ?? 0)}</span>
                                {booking.experienceCustomOfferMessage ? ` / ${booking.experienceCustomOfferMessage}` : ""}
                              </div>
                            ) : null}
                            {false && booking.experienceCustomOfferStatus === "pending-admin-approval" ? (
                              <div className="text-sm text-muted-foreground">
                                {booking.experienceCustomOfferAmount
                                  ? <>Partner submitted full quote: <span className="font-medium text-foreground">{formatAmount(booking.experienceCustomOfferAmount ?? 0)}</span>{booking.experienceCustomOfferMessage ? ` / ${booking.experienceCustomOfferMessage}` : ""}</>
                                  : booking.experienceCustomOfferDeclineReason
                                    ? <>Partner submitted decline reason: {booking.experienceCustomOfferDeclineReason}</>
                                    : "A partner response is waiting for your approval."}
                              </div>
                            ) : null}
                            {false && booking.experienceCustomOfferStatus === "declined" && booking.experienceCustomOfferDeclineReason ? (
                              <div className="text-sm text-muted-foreground">
                                Decline reason: {booking.experienceCustomOfferDeclineReason}
                              </div>
                            ) : null}
                            {isFinalizedBooking(booking) ? (
                              <div className="text-sm text-muted-foreground rounded-md bg-muted/40 p-3">
                                {booking.status === "cancelled"
                                  ? "This booking was cancelled by admin. Offer actions are now locked."
                                  : "This booking was marked completed by admin. Offer actions are now locked."}
                              </div>
                            ) : isClosedExperienceOffer(booking) ? (
                              <div className="text-sm text-muted-foreground rounded-md bg-muted/40 p-3">
                                {isAcceptedExperienceOfferAwaitingPayment(booking)
                                  ? "Accepted by client. Payment is still pending, and the offer stays locked while checkout completes."
                                  : "Accepted by client and paid. Editing is now locked for delivery."}
                              </div>
                            ) : null}
                            {!isFinalizedBooking(booking) && !isClosedExperienceOffer(booking) && !isAwaitingClientExperienceDecision(booking) ? <Input
                              type="number"
                              min="1"
                              placeholder={`Offer total (${selectedCurrency})`}
                              value={proposalAmounts[booking.id] ?? ""}
                              onChange={(e) => setProposalAmounts((current) => ({ ...current, [booking.id]: e.target.value }))}
                            /> : null}
                            {!isFinalizedBooking(booking) && !isClosedExperienceOffer(booking) && !isAwaitingClientExperienceDecision(booking) ? <Textarea
                              rows={3}
                              placeholder="Offer note or decline reason"
                              value={booking.experienceCustomOfferDeclineReason
                                ? (declineReasons[booking.id] ?? booking.experienceCustomOfferDeclineReason ?? "")
                                : (proposalMessages[booking.id] ?? booking.experienceCustomOfferMessage ?? "")}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (booking.experienceCustomOfferDeclineReason) {
                                  setDeclineReasons((current) => ({ ...current, [booking.id]: value }));
                                  return;
                                }
                                setProposalMessages((current) => ({ ...current, [booking.id]: value }));
                                setDeclineReasons((current) => ({ ...current, [booking.id]: value }));
                              }}
                            /> : null}
                            {!isFinalizedBooking(booking) && !isClosedExperienceOffer(booking) && !isAwaitingClientExperienceDecision(booking) ? <div className="flex flex-col gap-2 sm:flex-row">
                              <Button
                                variant="outline"
                                disabled={reviewExperienceOfferMutation.isPending}
                                onClick={() => reviewExperienceOfferMutation.mutate({
                                  id: booking.id,
                                  payload: {
                                    action: "propose",
                                    proposedAmount: getSubmittedProposalAmountUsd(
                                      proposalAmounts[booking.id],
                                      booking.experienceCustomOfferAmount,
                                    ),
                                    proposalMessage: proposalMessages[booking.id] ?? booking.experienceCustomOfferMessage ?? "",
                                  },
                                })}
                              >
                                {booking.experienceCustomOfferStatus === "pending-admin-approval" ? "Approve Offer" : "Send Offer"}
                              </Button>
                              {isAdminManagedCustomServiceBooking(booking) && getBudgetAmountUsd(booking) ? (
                                <Button
                                  variant="secondary"
                                  disabled={reviewExperienceOfferMutation.isPending}
                                  onClick={() => submitEnteredBudgetAsOffer(booking)}
                                >
                                  Accept Budget
                                </Button>
                              ) : null}
                              <Button
                                variant="destructive"
                                disabled={reviewExperienceOfferMutation.isPending}
                                onClick={() => reviewExperienceOfferMutation.mutate({
                                  id: booking.id,
                                  payload: {
                                    action: "decline",
                                    declineReason: declineReasons[booking.id] ?? proposalMessages[booking.id] ?? booking.experienceCustomOfferDeclineReason ?? "",
                                  },
                                })}
                              >
                                {booking.experienceCustomOfferStatus === "pending-admin-approval" ? "Approve Decline" : "Decline"}
                              </Button>
                              {booking.experienceCustomOfferStatus === "pending-admin-approval" ? (
                                <Button
                                  variant="secondary"
                                  disabled={reviewExperienceOfferMutation.isPending}
                                  onClick={() => reviewExperienceOfferMutation.mutate({
                                    id: booking.id,
                                    payload: { action: "reopen" },
                                  })}
                                >
                                  Reopen
                                </Button>
                              ) : null}
                            </div> : null}
                          </div>
                        )}

                        {booking.providerStatusRequest ? (
                          <div className="rounded-lg border border-blue-200 bg-blue-50/80 p-3 space-y-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="text-sm font-medium">Partner Status Request</div>
                                <div className="text-sm text-muted-foreground">
                                  Requested change: {getRequestedStatusLabel(booking.providerStatusRequest)}
                                </div>
                              </div>
                              {getProviderRequestBadge(booking.providerStatusRequest)}
                            </div>
                            {booking.providerStatusRequestedAt ? (
                              <div className="text-xs text-muted-foreground">
                                Requested on {formatDate(booking.providerStatusRequestedAt)}
                              </div>
                            ) : null}
                            {booking.providerStatusRequestNote ? (
                              <div className="text-sm text-muted-foreground rounded-md bg-white/80 p-3">
                                {booking.providerStatusRequestNote}
                              </div>
                            ) : null}
                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                              <Button
                                variant="outline"
                                className="w-full sm:w-auto"
                                disabled={reviewProviderStatusRequestMutation.isPending}
                                onClick={() => reviewProviderStatusRequestMutation.mutate({ id: booking.id, action: "approve" })}
                              >
                                Approve Request
                              </Button>
                              <Button
                                variant="destructive"
                                className="w-full sm:w-auto"
                                disabled={reviewProviderStatusRequestMutation.isPending}
                                onClick={() => reviewProviderStatusRequestMutation.mutate({ id: booking.id, action: "decline" })}
                              >
                                Decline Request
                              </Button>
                            </div>
                          </div>
                        ) : null}

                        {hasOutstandingPayment ? (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 space-y-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="text-sm font-medium">Payment Override</div>
                                <div className="text-sm text-muted-foreground">
                                  {fullPaymentOnlyBooking
                                    ? amountPaid > 0
                                      ? `${formatAmount(outstandingAmount)} is still outstanding. This booking stays full-pay only rather than using a deposit.`
                                      : `Full payment of ${formatAmount(outstandingAmount)} is still outstanding. Deposits are not used for this booking.`
                                    : isDepositLockedBooking
                                    ? `Deposit received. ${formatAmount(outstandingAmount)} is still outstanding before the booking can move fully into delivery.`
                                    : isDepositCashCollection
                                      ? `Record the ${formatAmount(cashCollectionAmount)} deposit in cash to lock these dates.`
                                      : hasConfiguredDepositRule
                                        ? `A ${isFiftyPercentDepositRule ? "50%" : ""} deposit of ${formatAmount(cashCollectionAmount)} is required before these dates lock.`
                                        : `This booking is saved with ${formatAmount(outstandingAmount)} still outstanding. Require a 50% deposit first, or collect ${formatAmount(cashCollectionAmount)} in cash to settle it.`}
                                </div>
                              </div>
                              <Badge className="bg-amber-600">
                                {isDepositLockedBooking ? "Pending Payment" : "Pending"}
                              </Badge>
                            </div>
                            <div className="grid gap-2 text-sm sm:grid-cols-2">
                              <div className="rounded-md bg-white/80 p-3">
                                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Total</div>
                                <div className="mt-1 font-medium text-foreground">{formatAmount(booking.totalPrice)}</div>
                              </div>
                              <div className="rounded-md bg-white/80 p-3">
                                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                  {isDepositCashCollection
                                    ? "Deposit Due Now"
                                    : amountPaid > 0
                                      ? "Balance Due Now"
                                      : fullPaymentOnlyBooking
                                        ? "Full Amount Due"
                                        : "Outstanding"}
                                </div>
                                <div className="mt-1 font-medium text-foreground">
                                  {formatAmount(cashCollectionAmount)}
                                </div>
                              </div>
                            </div>
                            {amountPaid > 0 ? (
                              <div className="rounded-md bg-white/80 p-3 text-sm text-muted-foreground">
                                Paid so far: <span className="font-medium text-foreground">{formatAmount(amountPaid)}</span>
                              </div>
                            ) : null}
                            {!hasConfiguredDepositRule && amountPaid === 0 ? (
                              <div className="rounded-md bg-white/80 p-3 text-sm text-muted-foreground">
                                {fullPaymentOnlyBooking
                                  ? "This booking stays full-pay only. Collect the full amount in cash or send a reminder instead."
                                  : "Dates are not locked yet. Requiring a 50% deposit lets the client lock them without paying the full amount upfront."}
                              </div>
                            ) : null}
                            {hasConfiguredDepositRule && !isDepositLockedBooking ? (
                              <div className="rounded-md bg-white/80 p-3 text-sm text-muted-foreground">
                                Deposit required to lock dates: <span className="font-medium text-foreground">{formatAmount(booking.paymentDepositAmount ?? requiredDepositAmount)}</span>
                              </div>
                            ) : null}
                            {isDepositCashCollection ? (
                              <div className="rounded-md bg-white/80 p-3 text-sm text-muted-foreground">
                                Remaining after deposit: <span className="font-medium text-foreground">{formatAmount(balanceAfterCashCollection)}</span>
                              </div>
                            ) : null}
                            {amountPaid > 0 && outstandingAmount > 0 ? (
                              <div className="rounded-md bg-white/80 p-3 text-sm text-muted-foreground">
                                Remaining balance: <span className="font-medium text-foreground">{formatAmount(outstandingAmount)}</span>
                              </div>
                            ) : null}
                            <Textarea
                              rows={3}
                              placeholder="Add a note for a cash update, reminder, or cancellation update. Reminder notes are sent to the customer."
                              value={paymentActionNotes[booking.id] ?? ""}
                              onChange={(e) => setPaymentActionNotes((current) => ({ ...current, [booking.id]: e.target.value }))}
                            />
                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                              {!fullPaymentOnlyBooking && !hasConfiguredDepositRule && amountPaid === 0 ? (
                                <Button
                                  variant="secondary"
                                  className="w-full sm:w-auto"
                                  disabled={requireDepositMutation.isPending}
                                  onClick={() => requireDepositMutation.mutate({ id: booking.id })}
                                >
                                  Require 50% Deposit
                                </Button>
                              ) : null}
                              <Button
                                variant="outline"
                                className="w-full sm:w-auto"
                                disabled={paymentActionMutation.isPending || requireDepositMutation.isPending}
                                onClick={() => paymentActionMutation.mutate({
                                  id: booking.id,
                                  payload: {
                                    action: "payment-received-cash",
                                    note: paymentActionNotes[booking.id] ?? "",
                                  },
                                })}
                              >
                                {cashActionLabel}
                              </Button>
                              {isTemporaryMpesaReview ? (
                                <Button
                                  variant="outline"
                                  className="w-full sm:w-auto"
                                  disabled={paymentActionMutation.isPending || requireDepositMutation.isPending}
                                  onClick={() => paymentActionMutation.mutate({
                                    id: booking.id,
                                    payload: {
                                      action: "payment-received-mpesa",
                                      note: paymentActionNotes[booking.id] ?? "",
                                    },
                                  })}
                                >
                                  {manualMpesaActionLabel}
                                </Button>
                              ) : null}
                              <Button
                                variant="secondary"
                                className="w-full sm:w-auto"
                                disabled={paymentActionMutation.isPending || requireDepositMutation.isPending}
                                onClick={() => paymentActionMutation.mutate({
                                  id: booking.id,
                                  payload: {
                                    action: "send-reminder",
                                    note: paymentActionNotes[booking.id] ?? "",
                                  },
                                })}
                              >
                                Send Reminder
                              </Button>
                              <Button
                                variant="destructive"
                                className="w-full sm:w-auto"
                                disabled={paymentActionMutation.isPending || requireDepositMutation.isPending}
                                onClick={() => paymentActionMutation.mutate({
                                  id: booking.id,
                                  payload: {
                                    action: "cancel-booking",
                                    note: paymentActionNotes[booking.id] ?? "",
                                  },
                                })}
                              >
                                Cancelled
                              </Button>
                            </div>
                          </div>
                        ) : null}

                        <div className="space-y-2">
                          <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-sm font-medium">Update Status</div>
                            {isLockedBookingStatus(booking.status) ? (
                              <span className="text-xs text-muted-foreground">
                                Archived bookings are locked
                              </span>
                            ) : null}
                          </div>
                          <Select
                            value={booking.status}
                            onValueChange={(status) => {
                              if (status === "late") {
                                return;
                              }
                              updateStatusMutation.mutate({ id: booking.id, status: status as BookingStatus });
                            }}
                            disabled={updateStatusMutation.isPending || isLockedBookingStatus(booking.status)}
                          >
                            <SelectTrigger className="w-full" data-testid={`select-status-${booking.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {getAdminStatusOptions(booking.status).map((statusOption) => (
                                <SelectItem key={statusOption.value} value={statusOption.value} disabled={statusOption.disabled}>
                                  {statusOption.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {booking.status === "pending" ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              This booking is awaiting payment before it can move into the active workflow.
                            </p>
                          ) : null}
                          {booking.status === "pending-payment" ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              A deposit has been received, but the remaining balance is still pending.
                            </p>
                          ) : null}
                          {booking.status === "late" ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              This booking is overdue. It can only be closed as completed or cancelled.
                            </p>
                          ) : null}
                        </div>
                        <BookingThread
                          bookingId={booking.id}
                          title="Booking Chat"
                          initialMessage={booking.serviceRequestDetails}
                          initialMessageLabel={getBookingThreadInitialLabel(booking)}
                          composerPlaceholder="Reply to the customer or assigned partner..."
                          defaultOpen={pageIntent.openThread && pageIntent.bookingId === booking.id}
                        />
                      </div>
                    </div>
                    </AccordionContent>
                  </Card>
                </AccordionItem>
              );
            })}
            </Accordion>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
