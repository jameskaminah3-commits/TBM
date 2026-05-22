import React, { useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Calendar, Users, CheckCircle2, Car, ChefHat, ShoppingBag, Compass, ArrowLeft, Clock, MapPin, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { CurrencyAmount } from "@/components/currency-amount";
import { CheckoutPaymentPreview, bookingCheckoutPreviewCopy, customRequestCheckoutPreviewCopy } from "@/components/payment-provider-picker";
import { useCurrency } from "@/lib/currency";
import {
  calculateCookInclusivePrice,
  calculateCookInclusiveTotal,
  calculateCookServicePrice,
  calculateCookServiceTotal,
  getCookCustomMenuRequestFee,
  getCookExtraGuestInclusivePrice,
  getCookExtraGuestServiceFee,
  getCookInclusivePrice,
  getCookMinimumGuests,
  getCookServiceFee,
} from "@shared/cook-pricing";
import {
  calculateHelpMamaPackagePrice,
  HELP_MAMA_HOURLY_MINIMUM_HOURS,
  getHelpMamaAgeBandId,
  getHelpMamaRateId,
  getHelpMamaRateOptions,
  getHelpMamaStartingPrice,
  hasHelpMamaPricing,
  isHelpMamaHourlyRate,
  normalizeHelpMamaPricing,
} from "@shared/errand-pricing";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  Car as CarType,
  Cook as CookType,
  Errand as ErrandType,
  Experience as ExperienceType,
  MarketingAttributionPayload,
  MarketingPromoPreviewResult,
} from "@shared/schema";
import { cookBookingModes, insertBookingSchema, serviceScheduleSlotSchema, type ServiceScheduleSlot } from "@shared/schema";
import { customServiceRequestFeeUsd } from "@shared/custom-service";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  captureMarketingQueryParams,
  clearMarketingAttributionContext,
  getMarketingAttributionPayload,
  trackMarketingPageView,
} from "@/lib/marketing-attribution";
import {
  clearPendingBookingDraft,
  getCurrentBookingPath,
  loadPendingBookingDraft,
  savePendingBookingDraft,
  isPendingBookingPathMatch,
} from "@/lib/pending-booking";

function getDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateInputValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isBeforeToday(value: string) {
  return isDateInputValue(value) && value < getDateInputValue(new Date());
}

const serviceBookingFormSchema = insertBookingSchema.omit({
  accommodationId: true,
}).extend({
  checkIn: z.string().default(""),
  checkOut: z.string().default(""),
  guests: z.coerce.number().min(1, "At least 1 person required"),
  guestName: z.string().min(2, "Name is required"),
  guestPhone: z.string().optional(),
  serviceMode: z.string().optional(),
  serviceHours: z.preprocess(
    (val) => (val === "" || val == null ? undefined : val),
    z.coerce.number().min(1, "Hours must be at least 1").optional(),
  ),
  serviceLocation: z.string().optional(),
  servicePickupLocation: z.string().optional(),
  serviceReturnLocation: z.string().optional(),
  serviceZone: z.string().optional(),
  serviceStartTime: z.string().optional(),
  serviceEndTime: z.string().optional(),
  serviceRequestDetails: z.string().optional(),
  serviceRequestFee: z.coerce.number().optional(),
  serviceAddonSelections: z.array(z.string()).optional(),
  serviceScheduleSlots: z.array(serviceScheduleSlotSchema).optional(),
  serviceBudgetAmount: z.preprocess(
    (val) => (val === "" || val == null ? undefined : val),
    z.coerce.number().min(1, "Estimated receipt value must be at least 1").optional(),
  ),
  serviceLaundryWeightKg: z.preprocess(
    (val) => (val === "" || val == null ? undefined : val),
    z.coerce.number().min(1, "Laundry weight must be at least 1 kg").optional(),
  ),
}).superRefine((value, ctx) => {
  if (!value.serviceMode?.startsWith("errand-")) {
    if (!value.checkIn?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkIn"],
        message: "Start date is required",
      });
    }

    if (!value.checkOut?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkOut"],
        message: "End date is required",
      });
    }
  }

  if (value.checkIn?.trim() && isBeforeToday(value.checkIn)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["checkIn"],
      message: "Start date cannot be in the past",
    });
  }

  if (value.checkOut?.trim() && isBeforeToday(value.checkOut)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["checkOut"],
      message: "End date cannot be in the past",
    });
  }

  if (value.serviceMode?.startsWith("car-")) {
    if (!value.servicePickupLocation?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["servicePickupLocation"],
        message: "Pickup location is required for car bookings",
      });
    }
    if (!value.serviceReturnLocation?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceReturnLocation"],
        message: "Drop-off location is required for car bookings",
      });
    }
  }

  if (value.serviceMode === "car-chauffeur-hourly") {
    if (!value.serviceStartTime || !value.serviceEndTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceEndTime"],
        message: "Minimum booking required 3 hours",
      });
      return;
    }

    const [startHours, startMinutes] = value.serviceStartTime.split(":").map(Number);
    const [endHours, endMinutes] = value.serviceEndTime.split(":").map(Number);
    const diffMinutes = ((endHours * 60) + endMinutes) - ((startHours * 60) + startMinutes);
    if (diffMinutes < 180) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceEndTime"],
        message: "Minimum booking required 3 hours",
      });
    }
  }

  if (value.serviceMode === "cook-custom-menu") {
    if (!value.serviceLocation?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceLocation"],
        message: "Service location is required for custom menu requests",
      });
    }

    if (!value.serviceRequestDetails?.trim() || value.serviceRequestDetails.trim().length < 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceRequestDetails"],
        message: "Share a few details about the custom menu you want",
      });
    }
  }

  if (value.serviceMode?.startsWith("cook-")) {
    if (!value.serviceLocation?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceLocation"],
        message: "Service location is required for chef bookings",
      });
    }
  }

  if (value.serviceMode === "errand-shopping" && !value.serviceBudgetAmount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["serviceBudgetAmount"],
      message: "Estimated receipt value is required",
    });
  }

  if (value.serviceMode === "errand-shopping" && !value.serviceRequestDetails?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["serviceRequestDetails"],
      message: "Please share the shopping list or items needed",
    });
  }

  if (value.serviceMode === "errand-childcare" && (!value.serviceRequestDetails?.trim() || value.serviceRequestDetails.trim().length < 20)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["serviceRequestDetails"],
      message: "Share the child ages, care needs, timing, and any safety notes",
    });
  }

  if (value.serviceMode === "errand-childcare") {
    const selectedRateId = getHelpMamaRateId(value.serviceAddonSelections);
    if (selectedRateId && isHelpMamaHourlyRate(selectedRateId) && (!value.serviceHours || value.serviceHours < HELP_MAMA_HOURLY_MINIMUM_HOURS)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceHours"],
        message: `Hourly Mama Care bookings require at least ${HELP_MAMA_HOURLY_MINIMUM_HOURS} hours`,
      });
    }
  }

  if (value.serviceMode?.startsWith("errand-")) {
    if (!value.serviceLocation?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceLocation"],
        message: "Service location is required for errands",
      });
    }

    if (!value.serviceScheduleSlots?.length || value.serviceScheduleSlots.some((slot) => !slot.date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceScheduleSlots"],
        message: "Add at least one errand package date",
      });
    }

    value.serviceScheduleSlots?.forEach((slot, index) => {
      if (slot.date && isBeforeToday(slot.date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["serviceScheduleSlots", index, "date"],
          message: "Package date cannot be in the past",
        });
      }
    });
  }

  if (value.serviceMode === "experience-shared" && !value.serviceDepartureId?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["serviceDepartureId"],
      message: "Choose a shared departure to continue",
    });
  }

  if (value.serviceMode === "experience-custom-offer" && (!value.serviceRequestDetails?.trim() || value.serviceRequestDetails.trim().length < 20)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["serviceRequestDetails"],
      message: "Tell us the kind of custom experience you want",
    });
  }

});

type ServiceBookingFormValues = z.infer<typeof serviceBookingFormSchema>;
type ServiceBookingSubmission = ServiceBookingFormValues & {
  promoCode?: string | null;
  marketingAttribution?: MarketingAttributionPayload;
};
type BookingCheckoutResponse = {
  payment?: {
    redirectUrl?: string | null;
  } | null;
  warning?: string | null;
};
type ServiceItem = CarType | CookType | ErrandType | ExperienceType;

const helpMamaPublicDescription = [
  "Trusted in-villa childcare and family support provided by a certified social worker and experienced mother.",
  "Ideal for travelling families who need a few hours for dinner, a conference, rest after travel, or gentle overnight support while children stay comfortable in your villa, apartment, or accommodation.",
];

const helpMamaIncludedServices = [
  "Daytime childcare and supervision",
  "Evening or overnight support",
  "Feeding, bottle preparation, and diaper routines",
  "Age-appropriate play and bedtime support",
  "Short clinic visit accompaniment when needed",
  "Light child-related support during your stay",
];

const shoppingErrandHighlights = [
  "Fresh groceries, pantry staples, drinks, and snacks",
  "Household items, toiletries, and cleaning supplies",
  "Pharmacy and personal care pick-ups",
  "Villa, Airbnb, and apartment pre-arrival stocking",
];

const shoppingErrandTrustNotes = [
  "Clear list confirmation",
  "Receipt-based budget",
  "Delivery to your address",
];

const DEFAULT_SHOPPING_COMMISSION_PERCENT = 5;

type CarServiceMode = "car-chauffeur-day" | "car-chauffeur-hourly" | "car-self-drive-day";
type CookServiceMode = typeof cookBookingModes[number];
type ErrandServiceMode = "errand-base" | "errand-shopping" | "errand-laundry" | "errand-house-cleaning" | "errand-childcare";
type ExperienceServiceMode = "experience-private" | "experience-shared" | "experience-custom-offer";
type ServiceBookingMode = CarServiceMode | CookServiceMode | ErrandServiceMode | ExperienceServiceMode;

type ExperienceDepartureAvailabilityItem = {
  id: string;
  date: string;
  time: string;
  bookedGuests: number;
  maxCapacity: number;
  spotsLeft: number;
  departureDateTime: string;
};

const EMPTY_EXPERIENCE_SHARED_DEPARTURES: ExperienceDepartureAvailabilityItem[] = [];

type CarAvailability = {
  blockedRanges: Array<{
    id: string;
    source: "booking" | "manual";
    startDate: string;
    endDate: string;
    checkoutDate: string;
    status: string;
    guestName: string;
    serviceMode?: string;
  }>;
  availableFrom: string;
};

type CookAvailability = CarAvailability;

const SERVICE_CONFIG = {
  car: {
    endpoint: "/api/cars",
    icon: Car,
    label: "Car Rental",
    backPath: "/services/drive",
  },
  cook: {
    endpoint: "/api/cooks",
    icon: ChefHat,
    label: "Personal Chef",
    backPath: "/services/dine",
  },
  errand: {
    endpoint: "/api/errands",
    icon: ShoppingBag,
    label: "Errand Service",
    backPath: "/services/relax",
  },
  experience: {
    endpoint: "/api/experiences",
    icon: Compass,
    label: "Experience",
    backPath: "/services/experience",
  },
} as const;

function calculateDays(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  const diff = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function sortServiceScheduleSlots(slots: ServiceScheduleSlot[]): ServiceScheduleSlot[] {
  return [...slots].sort((a, b) => a.date.localeCompare(b.date));
}

function getScheduleRange(slots: ServiceScheduleSlot[] | undefined) {
  const validSlots = sortServiceScheduleSlots(
    (slots || []).filter((slot): slot is ServiceScheduleSlot => !!slot?.date),
  );

  if (!validSlots.length) {
    return null;
  }

  return {
    checkIn: validSlots[0].date,
    checkOut: validSlots[validSlots.length - 1].date,
  };
}

function getErrandPackagePrice(
  service: ErrandType,
  serviceMode: ErrandServiceMode | undefined,
  budgetAmount: number,
  addonSelections: string[],
  serviceHours?: number | null,
): number {
  if (serviceMode === "errand-shopping") {
    const commissionPercent = service.shoppingCommissionPercent ?? DEFAULT_SHOPPING_COMMISSION_PERCENT;
    return service.basePrice + Math.ceil((Math.max(0, budgetAmount) * commissionPercent) / 100);
  }

  if (serviceMode === "errand-laundry") {
    const selectedAddons = (service.laundryAddons || []).filter((addon) => addonSelections.includes(addon.id));
    return service.basePrice + selectedAddons.reduce((sum, addon) => sum + addon.price, 0);
  }

  if (serviceMode === "errand-house-cleaning") {
    const selectedAddons = (service.houseCleaningAddons || []).filter((addon) => addonSelections.includes(addon.id));
    return service.basePrice + selectedAddons.reduce((sum, addon) => sum + addon.price, 0);
  }

  if (serviceMode === "errand-childcare" && hasHelpMamaPricing(service)) {
    return calculateHelpMamaPackagePrice(service, addonSelections, serviceHours);
  }

  return service.basePrice;
}

function supportsChildcareErrand(service: ErrandType): boolean {
  const text = [
    service.serviceName,
    service.description,
    ...(service.features || []),
  ].join(" ").toLowerCase();

  return hasHelpMamaPricing(service) || /\b(childcare|child care|children|kids|baby|babies|infant|mama|mother|family|clinic|supervision|nanny|carer)\b/.test(text);
}

function getExperienceAddonTotal(
  service: ExperienceType,
  serviceMode: ExperienceServiceMode | undefined,
  addonSelections: string[],
) {
  const addons = serviceMode === "experience-private"
    ? service.privateAddons || []
    : serviceMode === "experience-shared"
      ? service.sharedAddons || []
      : [];
  return addons
    .filter((addon) => addonSelections.includes(addon.id))
    .reduce((sum, addon) => sum + addon.price, 0);
}

function getServiceName(svc: ServiceItem): string {
  if ("model" in svc) return svc.model;
  if ("speciality" in svc) return svc.serviceType ? `${svc.serviceType} by ${svc.title}` : svc.title;
  if ("experienceType" in svc) return svc.title;
  if ("serviceName" in svc) return svc.serviceName;
  return "Service";
}

function getDescriptionPreview(description: string, maxLength = 220): string {
  if (description.length <= maxLength) return description;

  const truncated = description.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  const preview = lastSpace > Math.floor(maxLength * 0.6) ? truncated.slice(0, lastSpace) : truncated;

  return `${preview.trimEnd()}...`;
}

function cleanPublicDescription(description: string): string {
  return description
    .replace(/\s+/g, " ")
    .replace(/([.!?])(?=[A-Z0-9])/g, "$1 ")
    .replace(/:([A-Z0-9])/g, ": $1")
    .trim();
}

function getErrandMobileSummary(serviceMode: ServiceBookingMode | undefined, count: number): string {
  if (count <= 0) return "Add dates to price this request";
  if (serviceMode === "errand-shopping") return `${count} shopping run${count === 1 ? "" : "s"} selected`;
  if (serviceMode === "errand-laundry") return `${count} laundry package${count === 1 ? "" : "s"} selected`;
  if (serviceMode === "errand-house-cleaning") return `${count} cleaning package${count === 1 ? "" : "s"} selected`;
  if (serviceMode === "errand-childcare") return `${count} Mama Care package${count === 1 ? "" : "s"} selected`;
  return `${count} errand package${count === 1 ? "" : "s"} selected`;
}

export default function ServiceBooking() {
  const { serviceType, id } = useParams<{ serviceType: string; id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { formatAmount, formatDualAmount, usdToKes, selectedCurrency, convertFromUsd, convertToUsd } = useCurrency();
  const [hasRestoredPendingDraft, setHasRestoredPendingDraft] = React.useState(false);
  const [promoCode, setPromoCode] = React.useState("");
  const [isDescriptionExpanded, setIsDescriptionExpanded] = React.useState(false);
  const bookingPath = getCurrentBookingPath();

  const config = SERVICE_CONFIG[serviceType as keyof typeof SERVICE_CONFIG];

  const { data: allServices, isLoading } = useQuery<ServiceItem[]>({
    queryKey: [config?.endpoint],
    enabled: !!config,
  });

  const service = useMemo(() => allServices?.find((s) => s.id === id), [allServices, id]);
  const isHelpMamaErrand = serviceType === "errand" && service && "basePrice" in service && hasHelpMamaPricing(service);
  const isShoppingErrand = serviceType === "errand" && service && "basePrice" in service && service.shoppingEnabled && !isHelpMamaErrand;
  const serviceDescription = cleanPublicDescription(service?.description ?? "");
  const hasLongDescription = !isHelpMamaErrand && serviceDescription.length > 220;
  const visibleDescription = hasLongDescription && !isDescriptionExpanded
    ? getDescriptionPreview(serviceDescription)
    : serviceDescription;
  const todayDateInputValue = useMemo(() => getDateInputValue(new Date()), []);
  const bookingPrefill = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        requestedMode: null as ServiceBookingMode | null,
        checkIn: "",
        checkOut: "",
        guests: undefined as number | undefined,
        serviceLocation: "",
        servicePickupLocation: "",
        serviceReturnLocation: "",
      };
    }

    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const guestsParam = Number(params.get("guests"));
    const requestedMode = (() => {
      if (!mode) return null;
      if (
        mode === "car-chauffeur-day" ||
        mode === "car-chauffeur-hourly" ||
        mode === "car-self-drive-day" ||
        mode === "cook-service-fee" ||
        mode === "cook-inclusive" ||
        mode === "cook-custom-menu" ||
        mode === "errand-base" ||
        mode === "errand-shopping" ||
        mode === "errand-laundry" ||
        mode === "errand-house-cleaning" ||
        mode === "errand-childcare" ||
        mode === "experience-private" ||
        mode === "experience-shared" ||
        mode === "experience-custom-offer"
      ) {
        return mode;
      }
      return null;
    })();

    return {
      requestedMode,
      checkIn: params.get("checkIn") || "",
      checkOut: params.get("checkOut") || "",
      guests: Number.isFinite(guestsParam) && guestsParam > 0 ? Math.round(guestsParam) : undefined,
      serviceLocation: params.get("serviceLocation") || "",
      servicePickupLocation: params.get("servicePickupLocation") || "",
      serviceReturnLocation: params.get("serviceReturnLocation") || "",
    };
  }, []);

  const { data: carAvailability } = useQuery<CarAvailability>({
    queryKey: ["/api/cars", id, "availability"],
    enabled: serviceType === "car" && !!id,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const response = await fetch(`/api/cars/${id}/availability`, { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to load car availability");
      }
      return response.json();
    },
  });

  const { data: cookAvailability } = useQuery<CookAvailability>({
    queryKey: ["/api/cooks", id, "availability"],
    enabled: serviceType === "cook" && !!id,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const response = await fetch(`/api/cooks/${id}/availability`, { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to load chef availability");
      }
      return response.json();
    },
  });

  const { data: experienceSharedDeparturesData } = useQuery<ExperienceDepartureAvailabilityItem[]>({
    queryKey: ["/api/experiences", id, "shared-departures"],
    enabled: serviceType === "experience" && !!id && !!service && "experienceType" in service && !!service.sharedEnabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const response = await fetch(`/api/experiences/${id}/shared-departures`, { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to load shared departures");
      }
      return response.json();
    },
  });
  const experienceSharedDepartures = experienceSharedDeparturesData ?? EMPTY_EXPERIENCE_SHARED_DEPARTURES;

  const defaultGuestName = user
    ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || ""
    : "";
  const defaultGuestPhone = user?.phone || "";

  const form = useForm<ServiceBookingFormValues>({
    resolver: zodResolver(serviceBookingFormSchema),
    defaultValues: {
      guestName: defaultGuestName,
      guestPhone: defaultGuestPhone,
      checkIn: bookingPrefill.checkIn,
      checkOut: bookingPrefill.checkOut,
      guests: bookingPrefill.guests ?? 2,
      selectedServices: [id || ""],
      serviceMode: serviceType === "car"
        ? (bookingPrefill.requestedMode === "car-chauffeur-day" || bookingPrefill.requestedMode === "car-chauffeur-hourly" || bookingPrefill.requestedMode === "car-self-drive-day"
            ? bookingPrefill.requestedMode
            : "car-chauffeur-day")
        : serviceType === "cook"
          ? (bookingPrefill.requestedMode === "cook-service-fee" || bookingPrefill.requestedMode === "cook-inclusive" || bookingPrefill.requestedMode === "cook-custom-menu"
              ? bookingPrefill.requestedMode
              : "cook-service-fee")
          : serviceType === "errand"
            ? (bookingPrefill.requestedMode === "errand-base" || bookingPrefill.requestedMode === "errand-shopping" || bookingPrefill.requestedMode === "errand-laundry" || bookingPrefill.requestedMode === "errand-house-cleaning" || bookingPrefill.requestedMode === "errand-childcare"
                ? bookingPrefill.requestedMode
                : "errand-base")
            : serviceType === "experience"
              ? (bookingPrefill.requestedMode === "experience-private" || bookingPrefill.requestedMode === "experience-shared" || bookingPrefill.requestedMode === "experience-custom-offer"
                  ? bookingPrefill.requestedMode
                  : "experience-private")
              : undefined,
      serviceHours: undefined,
      serviceLocation: bookingPrefill.serviceLocation,
      servicePickupLocation: bookingPrefill.servicePickupLocation,
      serviceReturnLocation: bookingPrefill.serviceReturnLocation,
      serviceZone: "",
      serviceStartTime: "",
      serviceEndTime: "",
      serviceRequestDetails: "",
      serviceRequestFee: undefined,
      serviceAddonSelections: [],
      serviceDepartureId: "",
      serviceScheduleSlots: serviceType === "errand" ? [{ date: bookingPrefill.checkIn, note: "" }] : [],
      serviceBudgetAmount: undefined,
      serviceLaundryWeightKg: undefined,
      totalPrice: 0,
      status: "upcoming",
    },
  });
  const watchedServiceBookingDraft = useWatch({ control: form.control });
  const isServiceBookingFormDirty = form.formState.isDirty;

  React.useEffect(() => {
    setIsDescriptionExpanded(false);
  }, [id]);

  React.useEffect(() => {
    captureMarketingQueryParams();
    void trackMarketingPageView();
    const savedPromoCode = getMarketingAttributionPayload().promoCode;
    if (savedPromoCode) {
      setPromoCode(savedPromoCode);
    }
  }, []);

  const { fields: errandSlotFields, append: appendErrandSlot, remove: removeErrandSlot } = useFieldArray({
    control: form.control,
    name: "serviceScheduleSlots",
  });

  React.useEffect(() => {
    if (user && !form.getValues("guestName")) {
      const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim();
      if (fullName) {
        form.setValue("guestName", fullName);
      }
    }

    if (user?.phone && !form.getValues("guestPhone")) {
      form.setValue("guestPhone", user.phone);
    }
  }, [user, form]);

  const serviceMode = form.watch("serviceMode") as ServiceBookingMode | undefined;
  const watchedCheckIn = form.watch("checkIn");
  const watchedCheckOut = form.watch("checkOut");
  const watchedServiceStartTime = form.watch("serviceStartTime");
  const watchedServiceEndTime = form.watch("serviceEndTime");
  const watchedErrandSlots = form.watch("serviceScheduleSlots") || [];
  const watchedServiceDepartureId = form.watch("serviceDepartureId");
  const isCookService = serviceType === "cook" && !!service && "pricePerSession" in service;
  const cookCustomMenuFeeUsd = isCookService ? getCookCustomMenuRequestFee(service, usdToKes) : 0;

  React.useEffect(() => {
    if (serviceType === "cook" && service && "minimumGuests" in service) {
      const minimumGuests = getCookMinimumGuests(service);
      if ((form.getValues("guests") || 0) < minimumGuests) {
        form.setValue("guests", minimumGuests, {
          shouldDirty: false,
          shouldTouch: false,
          shouldValidate: false,
        });
      }
    }
  }, [form, service, serviceType]);

  React.useEffect(() => {
    if (serviceType === "errand" && form.getValues("guests") !== 1) {
      form.setValue("guests", 1, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [form, serviceType]);

  React.useEffect(() => {
    if (serviceType !== "errand" || !service || !("basePrice" in service)) {
      return;
    }

    const requestedMode = bookingPrefill.requestedMode;
    if (requestedMode === "errand-shopping" && service.shoppingEnabled) return;
    if (requestedMode === "errand-laundry" && service.laundryEnabled) return;
    if (requestedMode === "errand-house-cleaning" && service.houseCleaningEnabled) return;
    if (requestedMode === "errand-childcare" && supportsChildcareErrand(service)) return;

    const currentMode = form.getValues("serviceMode");
    if (currentMode === "errand-base" && service.shoppingEnabled && !hasHelpMamaPricing(service)) {
      form.setValue("serviceMode", "errand-shopping", {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
      return;
    }

    if (currentMode !== "errand-base" || !hasHelpMamaPricing(service)) {
      return;
    }

    form.setValue("serviceMode", "errand-childcare", {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: false,
    });
  }, [bookingPrefill.requestedMode, form, service, serviceType]);

  React.useEffect(() => {
    if (serviceType !== "experience" || !service || !("experienceType" in service)) {
      return;
    }

    const nextMode: ExperienceServiceMode =
      bookingPrefill.requestedMode && (
        (bookingPrefill.requestedMode === "experience-private" && service.privateEnabled) ||
        (bookingPrefill.requestedMode === "experience-shared" && service.sharedEnabled) ||
        (bookingPrefill.requestedMode === "experience-custom-offer" && service.customQuoteEnabled)
      )
        ? bookingPrefill.requestedMode
        : service.privateEnabled
          ? "experience-private"
          : service.sharedEnabled
            ? "experience-shared"
            : "experience-custom-offer";

    if (form.getValues("serviceMode") !== nextMode) {
      form.setValue("serviceMode", nextMode, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    }
  }, [bookingPrefill.requestedMode, form, service, serviceType]);

  React.useEffect(() => {
    if (serviceType !== "errand") {
      return;
    }

    const scheduleRange = getScheduleRange(watchedErrandSlots);

    if (!scheduleRange) {
      if (form.getValues("checkIn") !== "") {
        form.setValue("checkIn", "", { shouldDirty: false, shouldTouch: false, shouldValidate: false });
      }
      if (form.getValues("checkOut") !== "") {
        form.setValue("checkOut", "", { shouldDirty: false, shouldTouch: false, shouldValidate: false });
      }
      return;
    }

    if (form.getValues("checkIn") !== scheduleRange.checkIn) {
      form.setValue("checkIn", scheduleRange.checkIn, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    }
    if (form.getValues("checkOut") !== scheduleRange.checkOut) {
      form.setValue("checkOut", scheduleRange.checkOut, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    }
  }, [form, serviceType, watchedErrandSlots]);

  React.useEffect(() => {
    if (serviceType === "car" && serviceMode === "car-chauffeur-hourly" && watchedCheckIn && form.getValues("checkOut") !== watchedCheckIn) {
      form.setValue("checkOut", watchedCheckIn, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [form, serviceMode, serviceType, watchedCheckIn]);

  React.useEffect(() => {
    if (serviceType === "experience" && watchedCheckIn && form.getValues("checkOut") !== watchedCheckIn) {
      form.setValue("checkOut", watchedCheckIn, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [form, serviceType, watchedCheckIn]);

  React.useEffect(() => {
    if (serviceType !== "experience" || serviceMode !== "experience-shared") {
      return;
    }

    const selectedDeparture = experienceSharedDepartures.find((departure) => departure.id === watchedServiceDepartureId);
    if (!selectedDeparture) {
      return;
    }

    if (form.getValues("checkIn") !== selectedDeparture.date) {
      form.setValue("checkIn", selectedDeparture.date, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    }
    if (form.getValues("checkOut") !== selectedDeparture.date) {
      form.setValue("checkOut", selectedDeparture.date, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    }
    if (form.getValues("serviceStartTime") !== selectedDeparture.time) {
      form.setValue("serviceStartTime", selectedDeparture.time, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    }
  }, [experienceSharedDepartures, form, serviceMode, serviceType, watchedServiceDepartureId]);

  React.useEffect(() => {
    if (serviceMode !== "car-chauffeur-hourly") {
      form.setValue("serviceStartTime", "");
      form.setValue("serviceEndTime", "");
      form.setValue("serviceHours", undefined);
    }

    if (serviceType === "cook") {
      if (serviceMode === "cook-custom-menu") {
        form.setValue("serviceRequestFee", cookCustomMenuFeeUsd);
      } else {
        form.setValue("serviceRequestFee", undefined);
        form.setValue("serviceRequestDetails", "");
      }
    }

    if (serviceType === "errand") {
      if (serviceMode !== "errand-shopping" && serviceMode !== "errand-childcare") {
        form.setValue("serviceBudgetAmount", undefined);
        form.setValue("serviceRequestDetails", "");
      }

      const selectedHelpMamaRateId = getHelpMamaRateId(form.getValues("serviceAddonSelections"));
      if (serviceMode !== "errand-childcare" || !isHelpMamaHourlyRate(selectedHelpMamaRateId)) {
        form.setValue("serviceHours", undefined);
      }

      if (serviceMode !== "errand-laundry") {
        form.setValue("serviceLaundryWeightKg", undefined);
      }

      if (serviceMode !== "errand-laundry" && serviceMode !== "errand-house-cleaning") {
        form.setValue("serviceAddonSelections", []);
      }

      if (!(form.getValues("serviceScheduleSlots") || []).length) {
        form.setValue("serviceScheduleSlots", [{ date: "", note: "" }], {
          shouldDirty: false,
          shouldTouch: false,
          shouldValidate: false,
        });
      }
    }

    if (serviceType === "experience" && service && "experienceType" in service) {
      if (serviceMode === "experience-private") {
        const minimumGuests = Math.max(2, service.privateMinimumGuests || 2);
        if ((form.getValues("guests") || 0) < minimumGuests) {
          form.setValue("guests", minimumGuests, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
        }
        form.setValue("serviceDepartureId", "", { shouldDirty: false, shouldTouch: false, shouldValidate: false });
      }

      if (serviceMode === "experience-shared") {
        if ((form.getValues("guests") || 0) < 1) {
          form.setValue("guests", 1, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
        }
        if (!(form.getValues("serviceDepartureId") || "") && experienceSharedDepartures.length > 0) {
          const nextDeparture = experienceSharedDepartures.find((departure) => departure.spotsLeft > 0) || experienceSharedDepartures[0];
          if (nextDeparture) {
            form.setValue("serviceDepartureId", nextDeparture.id, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
          }
        }
      }

      if (serviceMode === "experience-custom-offer") {
        form.setValue("serviceDepartureId", "", { shouldDirty: false, shouldTouch: false, shouldValidate: false });
        form.setValue("serviceAddonSelections", [], { shouldDirty: false, shouldTouch: false, shouldValidate: false });
        form.setValue("serviceRequestFee", customServiceRequestFeeUsd, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
      } else {
        form.setValue("serviceRequestFee", undefined, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
      }
    }
  }, [cookCustomMenuFeeUsd, experienceSharedDepartures, form, service, serviceMode, serviceType]);

  const calculatePrice = (): number => {
    if (!service) return 0;

    if ("priceWithDriver" in service) {
      const selectedZone = service.chauffeurZones.find((zone) => zone.name === form.watch("serviceZone"));
      if (serviceMode === "car-chauffeur-hourly") {
        const hourlyRate = selectedZone?.hourlyPrice || service.priceWithDriverHourly || 0;
        return (form.watch("serviceHours") || 0) * hourlyRate;
      }

      const days = calculateDays(form.watch("checkIn"), form.watch("checkOut"));
      if (serviceMode === "car-self-drive-day") {
        return days * (selectedZone?.selfDrivePrice || service.pricePerDay || 0);
      }

      const dailyRate = selectedZone?.dailyPrice || service.priceWithDriver;
      return days * dailyRate;
    }

    if ("pricePerSession" in service) {
      const pricedGuests = Math.max(form.watch("guests") || 0, getCookMinimumGuests(service));
      const bookedDays = calculateDays(form.watch("checkIn"), form.watch("checkOut"));

      if (serviceMode === "cook-custom-menu") {
        return cookCustomMenuFeeUsd;
      }

      if (serviceMode === "cook-inclusive") {
        return calculateCookInclusiveTotal(service, pricedGuests, bookedDays);
      }

      return calculateCookServiceTotal(service, pricedGuests, bookedDays);
    }

    if ("basePrice" in service) {
      const packagePrice = getErrandPackagePrice(
        service,
        serviceMode as ErrandServiceMode | undefined,
        form.watch("serviceBudgetAmount") || 0,
        form.watch("serviceAddonSelections") || [],
        form.watch("serviceHours") || null,
      );
      const packageCount = Math.max(1, (form.watch("serviceScheduleSlots") || []).filter((slot) => slot?.date).length);
      return packagePrice * packageCount;
    }

    if ("experienceType" in service) {
      const addonTotal = getExperienceAddonTotal(service, serviceMode as ExperienceServiceMode | undefined, form.watch("serviceAddonSelections") || []);
      if (serviceMode === "experience-custom-offer") {
        return customServiceRequestFeeUsd;
      }
      if (serviceMode === "experience-shared") {
        return ((service.sharedPricePerPerson || service.price || 0) * Math.max(1, form.watch("guests") || 1)) + addonTotal;
      }

      return ((service.privatePricePerPerson || service.price || 0) * Math.max(service.privateMinimumGuests || 2, form.watch("guests") || 0)) + addonTotal;
    }

    return 0;
  };
  const normalizedPromoCode = promoCode.trim().toUpperCase();
  const selectedPromoCategories = useMemo(() => {
    if (serviceType === "car") return ["cars"] as const;
    if (serviceType === "cook") return ["cooks"] as const;
    if (serviceType === "errand") return ["errands"] as const;
    if (serviceType === "experience") return ["experiences"] as const;
    return [];
  }, [serviceType]);
  const previewSubtotal = calculatePrice();
  const effectiveCheckOut = serviceMode === "car-chauffeur-hourly"
    || serviceMode === "experience-private"
    || serviceMode === "experience-shared"
    || serviceMode === "experience-custom-offer"
    ? watchedCheckIn
    : watchedCheckOut;
  const promoPreviewQuery = useQuery<MarketingPromoPreviewResult>({
    queryKey: [
      "/api/marketing/promos/preview",
      serviceType,
      id,
      previewSubtotal,
      watchedCheckIn,
      effectiveCheckOut,
      form.watch("guests"),
      normalizedPromoCode,
    ],
    enabled: Boolean(service && watchedCheckIn && effectiveCheckOut && form.watch("guests") > 0 && previewSubtotal > 0),
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/marketing/promos/preview", {
        subtotal: previewSubtotal,
        selectedCategories: selectedPromoCategories,
        selectedServiceIds: id ? [id] : [],
        accommodationId: null,
        guests: form.watch("guests"),
        checkIn: watchedCheckIn,
        checkOut: effectiveCheckOut,
        promoCode: normalizedPromoCode || null,
      });
      return response.json() as Promise<MarketingPromoPreviewResult>;
    },
  });
  const promoPreview = promoPreviewQuery.data?.promo ?? null;
  const discountedTotalPrice = promoPreview?.discountedSubtotal ?? previewSubtotal;
  const promoSavings = promoPreview?.discountAmount ?? 0;
  const promoRejectionReason = normalizedPromoCode ? (promoPreviewQuery.data?.rejectionReason ?? null) : null;

  const buildServiceBookingSubmission = (
    values: ServiceBookingFormValues,
    options?: {
      promoCodeOverride?: string | null;
    },
  ): ServiceBookingSubmission => {
    const nextPromoCode = options?.promoCodeOverride?.trim().toUpperCase() || normalizedPromoCode || null;
    const scheduleRange = values.serviceMode?.startsWith("errand-")
      ? getScheduleRange(values.serviceScheduleSlots)
      : null;
    const normalizedCheckIn = scheduleRange?.checkIn ?? values.checkIn;
    const normalizedCheckOut = values.serviceMode === "car-chauffeur-hourly"
      || values.serviceMode === "experience-private"
      || values.serviceMode === "experience-shared"
      || values.serviceMode === "experience-custom-offer"
      ? normalizedCheckIn
      : scheduleRange?.checkOut ?? values.checkOut;

    return {
      ...values,
      checkIn: normalizedCheckIn,
      checkOut: normalizedCheckOut,
      promoCode: nextPromoCode,
      marketingAttribution: getMarketingAttributionPayload({
        landingPath: getCurrentBookingPath(),
        promoCode: nextPromoCode ?? undefined,
      }),
    };
  };

  const buildCurrentServiceBookingSubmission = (values: ServiceBookingFormValues) => buildServiceBookingSubmission({
    ...values,
    totalPrice: calculatePrice(),
    serviceRequestFee: values.serviceMode === "cook-custom-menu"
      ? cookCustomMenuFeeUsd
      : values.serviceMode === "experience-custom-offer"
        ? customServiceRequestFeeUsd
        : undefined,
  });

  React.useEffect(() => {
    if (authLoading || isAuthenticated) {
      return;
    }

    if (!isServiceBookingFormDirty && !normalizedPromoCode) {
      return;
    }

    savePendingBookingDraft({
      kind: "service",
      path: bookingPath,
      payload: buildCurrentServiceBookingSubmission(form.getValues()),
    });
  }, [
    authLoading,
    bookingPath,
    buildCurrentServiceBookingSubmission,
    form,
    isAuthenticated,
    isServiceBookingFormDirty,
    normalizedPromoCode,
    watchedServiceBookingDraft,
  ]);

  const createBookingMutation = useMutation({
    mutationFn: async (data: ServiceBookingSubmission) => {
      const response = await apiRequest("POST", "/api/bookings", {
        ...data,
        bookingType: "service",
        accommodationId: null,
      });
      return response.json() as Promise<BookingCheckoutResponse>;
    },
    onSuccess: (_, variables) => {
      clearPendingBookingDraft();
      clearMarketingAttributionContext();
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cars", id, "availability"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cooks", id, "availability"] });
      toast({
        title: variables.serviceMode === "cook-custom-menu" || variables.serviceMode === "experience-custom-offer"
          ? "Request submitted"
          : "Booking saved",
        description: variables.serviceMode === "cook-custom-menu" || variables.serviceMode === "experience-custom-offer"
          ? "We saved it to My Bookings, where you can complete the full payment whenever you're ready."
          : "Your booking is in. Secure payment stays ready in My Bookings whenever you are.",
      });
      setLocation("/bookings");
    },
    onError: (error: Error) => {
      toast({
        title: "Booking failed",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const continueAfterLogin = (data: ServiceBookingFormValues) => {
    const payload = buildCurrentServiceBookingSubmission(data);
    savePendingBookingDraft({
      kind: "service",
      path: bookingPath,
      payload,
    });
    toast({
      title: "Continue after login",
      description: "Sign in or create an account and we will bring you back to finish saving this booking.",
    });
    setLocation(`/auth?next=${encodeURIComponent(bookingPath)}`);
  };

  const submitServiceBooking = (data: ServiceBookingFormValues) => {
    if (!isAuthenticated) {
      continueAfterLogin(data);
      return;
    }

    createBookingMutation.mutate(buildCurrentServiceBookingSubmission(data));
  };

  const handleInvalidServiceBooking = () => {
    toast({
      title: "Complete the required fields",
      description: "Review the booking form and try again.",
      variant: "destructive",
    });
  };

  React.useEffect(() => {
    setHasRestoredPendingDraft(false);
  }, [bookingPath]);

  React.useEffect(() => {
    if (authLoading || !isAuthenticated || hasRestoredPendingDraft) {
      return;
    }

    const pendingDraft = loadPendingBookingDraft();
    if (!pendingDraft || pendingDraft.kind !== "service" || !isPendingBookingPathMatch(pendingDraft.path, bookingPath)) {
      setHasRestoredPendingDraft(true);
      return;
    }

    const payload = pendingDraft.payload as Partial<ServiceBookingFormValues> & {
      promoCode?: string | null;
    };
    const restoredPromoCode = typeof payload.promoCode === "string" ? payload.promoCode : "";
    const restoredFormValues: ServiceBookingFormValues = {
      ...form.getValues(),
      ...payload,
    };
    form.reset({
      ...restoredFormValues,
    });
    setPromoCode(restoredPromoCode);
    clearPendingBookingDraft();
    setHasRestoredPendingDraft(true);

    toast({
      title: "Booking restored",
      description: "We brought back your saved booking details. Review them and submit when you're ready.",
    });
  }, [authLoading, bookingPath, form, hasRestoredPendingDraft, isAuthenticated, toast]);

  const totalPrice = calculatePrice();
  const days = calculateDays(form.watch("checkIn"), form.watch("checkOut"));
  const guestsCount = form.watch("guests") || 0;
  const serviceHours = form.watch("serviceHours") || 0;
  const errandPackageCount = serviceType === "errand"
    ? (watchedErrandSlots || []).filter((slot) => slot?.date).length
    : 0;
  const errandPackagePrice = serviceType === "errand" && service && "basePrice" in service
    ? getErrandPackagePrice(service, serviceMode as ErrandServiceMode | undefined, form.watch("serviceBudgetAmount") || 0, form.watch("serviceAddonSelections") || [], form.watch("serviceHours") || null)
    : 0;
  const selectedExperienceDeparture = serviceType === "experience"
    ? experienceSharedDepartures.find((departure) => departure.id === watchedServiceDepartureId)
    : undefined;
  const isCustomRequestMode = serviceMode === "cook-custom-menu" || serviceMode === "experience-custom-offer";
  const checkoutPreviewCopy = isCustomRequestMode ? customRequestCheckoutPreviewCopy : bookingCheckoutPreviewCopy;
  const submitActionLabel = isCustomRequestMode ? "Submit request" : "Book";
  const experienceAddonTotal = serviceType === "experience" && service && "experienceType" in service
    ? getExperienceAddonTotal(service, serviceMode as ExperienceServiceMode | undefined, form.watch("serviceAddonSelections") || [])
    : 0;
  const mobileBookingSummary = (() => {
    if (serviceType === "errand") {
      return getErrandMobileSummary(serviceMode, errandPackageCount);
    }

    if (serviceType === "car" && serviceMode === "car-chauffeur-hourly") {
      return serviceHours > 0
        ? `${serviceHours} hour${serviceHours === 1 ? "" : "s"} selected`
        : "Choose your hours to lock the total";
    }

    if (serviceType === "experience" && serviceMode === "experience-shared" && selectedExperienceDeparture) {
      return `${guestsCount} guest${guestsCount === 1 ? "" : "s"} on ${new Date(selectedExperienceDeparture.departureDateTime).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}`;
    }

    if (serviceType === "experience" && serviceMode === "experience-custom-offer") {
      return "Submit your brief and we will request a tailored offer";
    }

    if (days > 0) {
      return `${days} day${days === 1 ? "" : "s"}${guestsCount > 0 ? ` - ${guestsCount} guest${guestsCount === 1 ? "" : "s"}` : ""}`;
    }

    if (guestsCount > 0) {
      return `${guestsCount} guest${guestsCount === 1 ? "" : "s"} selected`;
    }

    return "Complete the form to review your total";
  })();

  React.useEffect(() => {
    if (serviceMode !== "car-chauffeur-hourly") {
      return;
    }

    const start = watchedServiceStartTime;
    const end = watchedServiceEndTime;
    if (!start || !end) {
      form.setValue("serviceHours", undefined);
      return;
    }

    const [startHours, startMinutes] = start.split(":").map(Number);
    const [endHours, endMinutes] = end.split(":").map(Number);
    const diffMinutes = ((endHours * 60) + endMinutes) - ((startHours * 60) + startMinutes);
    if (diffMinutes > 0) {
      form.setValue("serviceHours", Math.ceil(diffMinutes / 60));
      return;
    }

    form.setValue("serviceHours", undefined);
  }, [form, serviceMode, watchedServiceEndTime, watchedServiceStartTime]);

  if (!config) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Invalid service type</h1>
          <Button onClick={() => setLocation("/")} data-testid="button-back-home">
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 sm:py-8">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-muted rounded w-1/3 mb-4"></div>
            <div className="h-64 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Service not found</h1>
          <Button onClick={() => setLocation(config.backPath)} data-testid="button-back-home">
            Back to {config.label}s
          </Button>
        </div>
      </div>
    );
  }

  const ServiceIcon = config.icon;
  const serviceName = getServiceName(service);
  const showHourlyOption = serviceType === "car" && "priceWithDriverHourly" in service && !!service.priceWithDriverHourly;
  const showSelfDriveOption = serviceType === "car" && "pricePerDay" in service && !!service.pricePerDay;
  const showZoneSelector = serviceType === "car" && "chauffeurZones" in service && service.chauffeurZones.length > 0;
  const showCookCustomMenu = serviceType === "cook" && "customMenuEnabled" in service && service.customMenuEnabled;
  const serviceFeatureBadges = "features" in service ? service.features.filter(Boolean).slice(0, 4) : [];

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <div className="container mx-auto px-4 py-8 pb-28 lg:pb-8">
        <div className="max-w-4xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => setLocation(config.backPath)}
            className="mb-4 sm:mb-6"
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>

          <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
            <div className="lg:col-span-2">
              <Card className="min-w-0 p-4 sm:p-6">
                <div className="mb-6">
                  <div className="mb-4 flex items-start gap-3 sm:gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 sm:h-12 sm:w-12">
                      <ServiceIcon className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
                    </div>
                    <div className="min-w-0">
                      <h1 className="break-words text-xl font-bold leading-tight sm:text-2xl" data-testid="text-service-name">
                        {serviceName}
                      </h1>
                      {isHelpMamaErrand ? (
                        <div className="mt-2 space-y-4">
                          <div className="space-y-2 text-sm leading-6 text-muted-foreground sm:leading-7">
                            {helpMamaPublicDescription.map((paragraph) => (
                              <p key={paragraph}>{paragraph}</p>
                            ))}
                          </div>
                          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                            {helpMamaIncludedServices.map((item) => (
                              <div key={item} className="flex min-w-0 items-start gap-2">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                <span className="leading-5">{item}</span>
                              </div>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {[
                              "Certified care",
                              "In-villa support",
                              `${HELP_MAMA_HOURLY_MINIMUM_HOURS}h hourly minimum`,
                            ].map((item) => (
                              <Badge key={item} variant="secondary" className="rounded-md">
                                {item}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ) : isShoppingErrand && "basePrice" in service ? (
                        <div className="mt-3 space-y-4">
                          <p className="text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                            Send your list and budget. A local shopper picks up groceries, household essentials, or pharmacy items,
                            keeps the receipt trail clear, and delivers to {"location" in service && service.location ? `${service.location} or nearby addresses` : "your preferred address"}.
                          </p>

                          <div className="grid gap-2 text-sm sm:grid-cols-2">
                            {shoppingErrandHighlights.map((item) => (
                              <div key={item} className="flex min-w-0 items-start gap-2 text-muted-foreground">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                <span className="leading-5">{item}</span>
                              </div>
                            ))}
                          </div>

                          <div className="grid gap-3 rounded-md border border-primary/15 bg-primary/5 p-3 text-sm sm:grid-cols-3">
                            <div>
                              <div className="font-semibold text-foreground">Base Service Fee</div>
                              <div className="mt-1 text-muted-foreground">{formatDualAmount(service.basePrice)} per shopping trip</div>
                            </div>
                            <div>
                              <div className="font-semibold text-foreground">Variable Commission</div>
                              <div className="mt-1 text-muted-foreground">{service.shoppingCommissionPercent ?? DEFAULT_SHOPPING_COMMISSION_PERCENT}% of the receipt value</div>
                            </div>
                            <div>
                              <div className="font-semibold text-foreground">Receipt Value</div>
                              <div className="mt-1 text-muted-foreground">Used only to calculate the commission</div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {[...shoppingErrandTrustNotes, ...serviceFeatureBadges].slice(0, 6).map((item) => (
                              <Badge key={item} variant="secondary" className="rounded-md">
                                {item}
                              </Badge>
                            ))}
                          </div>

                          {serviceDescription ? (
                            <div>
                              {isDescriptionExpanded ? (
                                <p className="text-sm leading-6 text-muted-foreground">
                                  {serviceDescription}
                                </p>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => setIsDescriptionExpanded((current) => !current)}
                                className="mt-1 inline-flex items-center text-sm font-medium text-primary underline-offset-4 transition-colors hover:text-primary/80 hover:underline"
                                aria-expanded={isDescriptionExpanded}
                              >
                                {isDescriptionExpanded ? "Hide listing note" : "Read listing note"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : serviceDescription ? (
                        <>
                          <p className="text-sm leading-7 text-muted-foreground">
                            {visibleDescription}
                          </p>
                          {hasLongDescription ? (
                            <button
                              type="button"
                              onClick={() => setIsDescriptionExpanded((current) => !current)}
                              className="mt-2 inline-flex items-center text-sm font-medium text-primary underline-offset-4 transition-colors hover:text-primary/80 hover:underline"
                              aria-expanded={isDescriptionExpanded}
                            >
                              {isDescriptionExpanded ? "Show less" : "Show more"}
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" data-testid="badge-service-type">
                      {config.label}
                    </Badge>
                    {"transmission" in service && (
                      <Badge variant="outline" className="capitalize">
                        {service.transmission}
                      </Badge>
                    )}
                    {"seats" in service && (
                      <Badge variant="outline">
                        {service.seats} seats
                      </Badge>
                    )}
                    {"location" in service && service.location && (
                      <Badge variant="outline">
                        {"experienceType" in service ? `Host base: ${service.location}` : service.location}
                      </Badge>
                    )}
                    {"experienceType" in service && service.experienceLocation && (
                      <Badge variant="outline">
                        Destination: {service.experienceLocation}
                      </Badge>
                    )}
                    {"speciality" in service && (
                      <Badge variant="outline" className="capitalize">
                        {service.speciality}
                      </Badge>
                    )}
                    {"serviceType" in service && (
                      <Badge variant="outline">
                        {service.serviceType}
                      </Badge>
                    )}
                    {"experienceType" in service && (
                      <Badge variant="outline">
                        {service.experienceType}
                      </Badge>
                    )}
                    {"minimumGuests" in service && (
                      <Badge variant="outline">
                        Minimum {getCookMinimumGuests(service)} guests
                      </Badge>
                    )}
                    {"minGuests" in service && (
                      <Badge variant="outline">
                        {service.minGuests} to {service.maxGuests} guests
                      </Badge>
                    )}
                  </div>
                </div>

                {serviceType === "car" && carAvailability && (
                  <>
                    <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Calendar className="w-4 h-4" />
                        <span>Availability</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Available from {carAvailability.availableFrom}.
                      </p>
                      {carAvailability.blockedRanges.length > 0 && (
                        <div className="space-y-1 text-sm text-muted-foreground">
                          {carAvailability.blockedRanges.slice(0, 3).map((range) => (
                            <div key={range.id}>
                              {range.startDate} to {range.endDate} • reserved
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <Separator className="my-6" />
                  </>
                )}

                {serviceType === "cook" && cookAvailability && (
                  <>
                    <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Calendar className="w-4 h-4" />
                        <span>Chef Availability</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Next available date: {cookAvailability.availableFrom}.
                      </p>
                      {cookAvailability.blockedRanges.length > 0 && (
                        <div className="space-y-1 text-sm text-muted-foreground">
                          {cookAvailability.blockedRanges.slice(0, 3).map((range) => (
                            <div key={range.id}>
                              {range.startDate} to {range.endDate} • reserved
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <Separator className="my-6" />
                  </>
                )}

                {serviceType === "cook" && "sampleMenus" in service && service.sampleMenus.length > 0 && (
                  <div className="mb-6 rounded-lg border bg-muted/30 p-4">
                    <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Sample Menus
                    </h2>
                    <div className="space-y-2">
                      {service.sampleMenus.map((menu, index) => (
                        <div key={`${service.id}-sample-menu-${index}`} className="rounded-md bg-background/80 px-3 py-2 text-sm">
                          {menu}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {serviceType === "experience" && "inclusions" in service && (service.inclusions.length > 0 || service.exclusions.length > 0 || service.meetingPoint) && (
                  <div className="mb-6 rounded-lg border bg-muted/30 p-4">
                    <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Experience Details
                    </h2>
                    <div className="space-y-3 text-sm">
                      {service.meetingPoint ? (
                        <div>
                          <div className="font-medium text-foreground">Meeting Point</div>
                          <div className="text-muted-foreground">{service.meetingPoint}</div>
                        </div>
                      ) : null}
                      {service.inclusions.length > 0 ? (
                        <div>
                          <div className="font-medium text-foreground">Included</div>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {service.inclusions.map((item) => (
                              <Badge key={item} variant="secondary">{item}</Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {service.exclusions.length > 0 ? (
                        <div>
                          <div className="font-medium text-foreground">Not Included</div>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {service.exclusions.map((item) => (
                              <Badge key={item} variant="outline">{item}</Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

                <Form {...form}>
                  <form id="service-booking-form" onSubmit={form.handleSubmit(submitServiceBooking, handleInvalidServiceBooking)} className="space-y-6">
                    {serviceType === "car" && "priceWithDriver" in service && (
                      <FormField
                        control={form.control}
                        name="serviceMode"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel>Booking Option</FormLabel>
                            <FormControl>
                              <RadioGroup
                                value={field.value}
                                onValueChange={field.onChange}
                                className="space-y-3"
                              >
                                <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                  <RadioGroupItem value="car-chauffeur-day" className="mt-1" />
                                  <div>
                                    <div className="font-medium">Chauffeur per day</div>
                                    <div className="text-sm text-muted-foreground">
                                      {formatAmount(service.priceWithDriver)}/day
                                    </div>
                                  </div>
                                </label>
                                {showHourlyOption && (
                                  <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                    <RadioGroupItem value="car-chauffeur-hourly" className="mt-1" />
                                    <div>
                                      <div className="font-medium">Chauffeur per hour</div>
                                      <div className="text-sm text-muted-foreground">
                                        {formatAmount(service.priceWithDriverHourly ?? 0)}/hour, minimum 3 hours
                                      </div>
                                    </div>
                                  </label>
                                )}
                                {showSelfDriveOption && (
                                  <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                    <RadioGroupItem value="car-self-drive-day" className="mt-1" />
                                    <div>
                                      <div className="font-medium">Self-drive per day</div>
                                      <div className="text-sm text-muted-foreground">
                                        {formatAmount(service.pricePerDay ?? 0)}/day
                                      </div>
                                    </div>
                                  </label>
                                )}
                              </RadioGroup>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {serviceType === "cook" && "pricePerSession" in service && (
                      <FormField
                        control={form.control}
                        name="serviceMode"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel>Chef Booking Option</FormLabel>
                            <FormControl>
                              <RadioGroup
                                value={field.value}
                                onValueChange={field.onChange}
                                className="space-y-3"
                              >
                                <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                  <RadioGroupItem value="cook-service-fee" className="mt-1" />
                                  <div>
                                    <div className="font-medium">Service fee</div>
                                    <div className="text-sm text-muted-foreground">
                                      Base package at {formatAmount(getCookServiceFee(service))} for {getCookMinimumGuests(service)} guests
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      Extra guest: {formatAmount(getCookExtraGuestServiceFee(service))} each
                                    </div>
                                  </div>
                                </label>

                                <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                  <RadioGroupItem value="cook-inclusive" className="mt-1" />
                                  <div>
                                    <div className="font-medium">Ingredients + shopping inclusive</div>
                                    <div className="text-sm text-muted-foreground">
                                      Base package at {formatAmount(getCookInclusivePrice(service))} for {getCookMinimumGuests(service)} guests
                                    </div>
                                    {(service.ingredientsIncluded || service.shoppingIncluded) && (
                                      <div className="mt-1 text-xs text-muted-foreground">
                                        {[service.ingredientsIncluded ? "Ingredients included" : null, service.shoppingIncluded ? "Shopping included" : null].filter(Boolean).join(" • ")}
                                      </div>
                                    )}
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      Extra guest inclusive: {formatAmount(getCookExtraGuestInclusivePrice(service))} each
                                    </div>
                                  </div>
                                </label>

                                {showCookCustomMenu && (
                                  <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                    <RadioGroupItem value="cook-custom-menu" className="mt-1" />
                                    <div>
                                      <div className="font-medium">Custom menu proposal</div>
                                      <div className="text-sm text-muted-foreground">
                                        Submit your brief for {formatAmount(cookCustomMenuFeeUsd)}. The fee is credited to the final booking.
                                      </div>
                                      <div className="mt-1 text-xs text-muted-foreground">
                                        Pay only after you approve a chef proposal.
                                      </div>
                                    </div>
                                  </label>
                                )}
                              </RadioGroup>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {serviceType === "errand" && "basePrice" in service && (
                      <FormField
                        control={form.control}
                        name="serviceMode"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel>Errand Option</FormLabel>
                            <FormControl>
                              <RadioGroup
                                value={field.value}
                                onValueChange={field.onChange}
                                className="space-y-3"
                              >
                                {!hasHelpMamaPricing(service) && !service.shoppingEnabled ? (
                                  <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                    <RadioGroupItem value="errand-base" className="mt-1" />
                                    <div>
                                      <div className="font-medium">Base service fee</div>
                                      <div className="text-sm text-muted-foreground">
                                        Starting at {formatAmount(service.basePrice)}
                                      </div>
                                    </div>
                                  </label>
                                ) : null}

                                {service.shoppingEnabled && (
                                  <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                    <RadioGroupItem value="errand-shopping" className="mt-1" />
                                    <div>
                                      <div className="font-medium">Grocery and personal shopping</div>
                                      <div className="text-sm text-muted-foreground">
                                        Base service fee + {(service.shoppingCommissionPercent ?? DEFAULT_SHOPPING_COMMISSION_PERCENT)}% receipt-based commission
                                      </div>
                                    </div>
                                  </label>
                                )}

                                {service.laundryEnabled && (
                                  <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                    <RadioGroupItem value="errand-laundry" className="mt-1" />
                                    <div>
                                      <div className="font-medium">Laundry</div>
                                      <div className="text-sm text-muted-foreground">
                                        Base package plus any laundry add-ons you select
                                      </div>
                                    </div>
                                  </label>
                                )}

                                {service.houseCleaningEnabled && (
                                  <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                    <RadioGroupItem value="errand-house-cleaning" className="mt-1" />
                                    <div>
                                      <div className="font-medium">House Cleaning</div>
                                      <div className="text-sm text-muted-foreground">
                                        Base cleaning package plus optional cleaning add-ons
                                      </div>
                                    </div>
                                  </label>
                                )}

                                {supportsChildcareErrand(service) && (
                                  <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                    <RadioGroupItem value="errand-childcare" className="mt-1" />
                                    <div>
                                      <div className="font-medium">Mama Care family support</div>
                                      <div className="text-sm text-muted-foreground">
                                        {hasHelpMamaPricing(service)
                                          ? `Starting at ${formatAmount(getHelpMamaStartingPrice(service.helpMamaPricing))}`
                                          : "Childcare, clinic visit support, feeding, diaper changing, or gentle supervision"}
                                      </div>
                                    </div>
                                  </label>
                                )}
                              </RadioGroup>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {serviceType === "experience" && "experienceType" in service && (
                      <FormField
                        control={form.control}
                        name="serviceMode"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel>Booking Option</FormLabel>
                            <FormControl>
                              <RadioGroup value={field.value ?? undefined} onValueChange={field.onChange} className="space-y-3">
                                {service.privateEnabled ? (
                                  <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                    <RadioGroupItem value="experience-private" className="mt-1" />
                                    <div>
                                      <div className="font-medium">Book Private (Flexible Date)</div>
                                      <div className="text-sm text-muted-foreground">
                                        {formatAmount(service.privatePricePerPerson)} per person for your own private group
                                      </div>
                                      <div className="mt-1 text-xs text-muted-foreground">
                                        Minimum {service.privateMinimumGuests} guests ? up to {service.maxGuests} guests
                                      </div>
                                    </div>
                                  </label>
                                ) : null}
                                {service.sharedEnabled ? (
                                  <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                    <RadioGroupItem value="experience-shared" className="mt-1" />
                                    <div>
                                      <div className="font-medium">Join a Shared Group (Fixed Dates)</div>
                                      <div className="text-sm text-muted-foreground">
                                        {formatAmount(service.sharedPricePerPerson)} per person on scheduled departures
                                      </div>
                                      <div className="mt-1 text-xs text-muted-foreground">
                                        Trip runs from {service.sharedMinimumGuests} guests ? up to {service.sharedMaxCapacity} spots
                                      </div>
                                    </div>
                                  </label>
                                ) : null}
                                {service.customQuoteEnabled ? (
                                  <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                    <RadioGroupItem value="experience-custom-offer" className="mt-1" />
                                    <div>
                                      <div className="font-medium">Request a Custom Offer</div>
                                      <div className="text-sm text-muted-foreground">
                                        Share your ideal plan and receive a tailored quote from the host
                                      </div>
                                      <div className="mt-1 text-xs text-muted-foreground">
                                        Perfect for a custom route, special occasion, or a more personalized experience
                                      </div>
                                    </div>
                                  </label>
                                ) : null}
                              </RadioGroup>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {serviceType === "experience" && serviceMode === "experience-shared" && "experienceType" in service && (
                      <FormField
                        control={form.control}
                        name="serviceDepartureId"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel>Choose a Shared Departure</FormLabel>
                            <FormControl>
                              <RadioGroup value={field.value ?? undefined} onValueChange={field.onChange} className="space-y-3">
                                {experienceSharedDepartures.map((departure) => (
                                  <label key={departure.id} className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                    <RadioGroupItem value={departure.id} className="mt-1" />
                                    <div>
                                      <div className="font-medium">
                                        {new Date(departure.departureDateTime).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                      </div>
                                      <div className="text-sm text-muted-foreground">
                                        {departure.spotsLeft} spots left out of {departure.maxCapacity}
                                      </div>
                                    </div>
                                  </label>
                                ))}
                              </RadioGroup>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {serviceType === "experience" && "experienceType" in service && ((serviceMode === "experience-private" && service.privateAddons.length > 0) || (serviceMode === "experience-shared" && service.sharedAddons.length > 0)) && (
                      <FormField
                        control={form.control}
                        name="serviceAddonSelections"
                        render={({ field }) => {
                          const addons = serviceMode === "experience-private" ? service.privateAddons : service.sharedAddons;
                          const selectedValues = field.value || [];
                          return (
                            <FormItem className="space-y-3">
                              <FormLabel>{serviceMode === "experience-private" ? "Private Add-Ons" : "Shared Trip Add-Ons"}</FormLabel>
                              <div className="space-y-3">
                                {addons.map((addon) => (
                                  <label key={addon.id} className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
                                    <Checkbox
                                      checked={selectedValues.includes(addon.id)}
                                      onCheckedChange={(checked) => {
                                        const next = checked
                                          ? [...selectedValues, addon.id]
                                          : selectedValues.filter((value) => value !== addon.id);
                                        field.onChange(next);
                                      }}
                                    />
                                    <div className="flex-1">
                                      <div className="flex items-center justify-between gap-3">
                                        <span className="font-medium">{addon.name}</span>
                                        <span className="text-sm text-muted-foreground">{formatAmount(addon.price)}</span>
                                      </div>
                                    </div>
                                  </label>
                                ))}
                              </div>
                              <FormMessage />
                            </FormItem>
                          );
                        }}
                      />
                    )}

                    {serviceType === "errand" ? (
                      <FormField
                        control={form.control}
                        name="serviceScheduleSlots"
                        render={() => (
                          <FormItem className="space-y-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <FormLabel>Package Dates</FormLabel>
                                <FormDescription>
                                  Book one package per date. Add a short note like a preferred time or access instruction.
                                </FormDescription>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => appendErrandSlot({ date: "", note: "" })}
                                className="w-full sm:w-auto"
                              >
                                <Plus className="mr-2 h-4 w-4" />
                                Add Package
                              </Button>
                            </div>
                            <div className="space-y-3">
                              {errandSlotFields.map((slot, index) => (
                                <div key={slot.id} className="rounded-lg border p-4 space-y-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm font-medium">Package {index + 1}</div>
                                    {errandSlotFields.length > 1 ? (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeErrandSlot(index)}
                                      >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Remove
                                      </Button>
                                    ) : null}
                                  </div>
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <FormField
                                      control={form.control}
                                      name={`serviceScheduleSlots.${index}.date`}
                                      render={({ field }) => (
                                        <FormItem>
                                          <FormLabel>Date</FormLabel>
                                          <FormControl>
                                            <div className="relative">
                                              <Calendar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                              <Input
                                                type="date"
                                                min={todayDateInputValue}
                                                className="pl-10"
                                                {...field}
                                                data-testid={`input-errand-package-date-${index}`}
                                              />
                                            </div>
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />
                                    <FormField
                                      control={form.control}
                                      name={`serviceScheduleSlots.${index}.note`}
                                      render={({ field }) => (
                                        <FormItem>
                                          <FormLabel>Note</FormLabel>
                                          <FormControl>
                                            <Input
                                              placeholder="9am, after 4pm, call on arrival..."
                                              {...field}
                                              value={field.value ?? ""}
                                              data-testid={`input-errand-package-note-${index}`}
                                            />
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : serviceType === "experience" && serviceMode === "experience-shared" ? null : (
                      <div className="grid md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="checkIn"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                {serviceType === "cook" ? "Start Date" : "Start Date"}
                              </FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Calendar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                  <Input
                                    type="date"
                                    min={todayDateInputValue}
                                    className="pl-10"
                                    data-testid="input-start-date"
                                    {...field}
                                  />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {serviceMode !== "car-chauffeur-hourly" && serviceType !== "experience" && (
                          <FormField
                            control={form.control}
                            name="checkOut"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>End Date</FormLabel>
                                <FormControl>
                                  <div className="relative">
                                    <Calendar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <Input
                                      type="date"
                                      min={todayDateInputValue}
                                      className="pl-10"
                                      data-testid="input-end-date"
                                      {...field}
                                    />
                                  </div>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}

                        {serviceMode === "car-chauffeur-hourly" && (
                          <>
                            <FormField
                              control={form.control}
                              name="serviceStartTime"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Pickup Time</FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <Clock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                      <Input type="time" className="pl-10" data-testid="input-service-start-time" {...field} />
                                    </div>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="serviceEndTime"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Drop-off Time</FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <Clock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                      <Input type="time" className="pl-10" data-testid="input-service-end-time" {...field} />
                                    </div>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </>
                        )}
                      </div>
                    )}

                    {serviceType === "car" ? (
                      <div className="grid md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="servicePickupLocation"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Pickup Location</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                  <Input
                                    className="pl-10"
                                    placeholder={serviceMode === "car-self-drive-day"
                                      ? "Where the client will collect the car"
                                      : "Where the client will be picked up"}
                                    data-testid="input-service-pickup-location"
                                    {...field}
                                  />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="serviceReturnLocation"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Drop-off Location</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                  <Input
                                    className="pl-10"
                                    placeholder={serviceMode === "car-self-drive-day"
                                      ? "Where the car will be returned"
                                      : "Where the client will be dropped off"}
                                    data-testid="input-service-return-location"
                                    {...field}
                                  />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    ) : (
                      <FormField
                        control={form.control}
                        name="serviceLocation"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{serviceType === "car" ? "Pickup / Service Location" : "Service Location"}</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                  className="pl-10"
                                  placeholder={serviceType === "car"
                                    ? "Airport, SGR, hotel, or town pickup point"
                                    : serviceType === "errand"
                                      ? "Pickup, delivery, or service address"
                                      : serviceType === "experience"
                                        ? "Pickup point, hotel, or preferred meeting note"
                                      : "Where the service will happen"}
                                  data-testid="input-service-location"
                                  {...field}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {serviceType === "cook" && serviceMode === "cook-custom-menu" && (
                      <FormField
                        control={form.control}
                        name="serviceRequestDetails"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Custom Menu Brief</FormLabel>
                            <FormControl>
                              <Textarea
                                rows={5}
                                placeholder="Tell us the cuisine, occasion, dishes you have in mind, dietary needs, serving style, and anything the chef should price for."
                                data-testid="input-cook-custom-menu-brief"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              Chefs will send tailored proposals with pricing after reviewing your request.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {serviceType === "errand" && serviceMode === "errand-shopping" && (
                      <>
                        <FormField
                          control={form.control}
                          name="serviceBudgetAmount"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{selectedCurrency === "KES" ? "Estimated Receipt Value (KSh)" : "Estimated Receipt Value (USD)"}</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="1"
                                  placeholder={selectedCurrency === "KES" ? "19500" : "150"}
                                  data-testid="input-errand-shopping-budget"
                                  value={field.value == null ? "" : String(Math.round(convertFromUsd(field.value, selectedCurrency)))}
                                  onChange={(e) => {
                                    const nextValue = e.target.value;
                                    if (nextValue === "") {
                                      field.onChange(undefined);
                                      return;
                                    }
                                    const numericValue = Number(nextValue);
                                    field.onChange(
                                      Number.isFinite(numericValue)
                                        ? convertToUsd(numericValue, selectedCurrency)
                                        : undefined,
                                    );
                                  }}
                                />
                              </FormControl>
                              <FormDescription>
                                Your service charge is the base service fee plus {("shoppingCommissionPercent" in service ? (service.shoppingCommissionPercent ?? DEFAULT_SHOPPING_COMMISSION_PERCENT) : DEFAULT_SHOPPING_COMMISSION_PERCENT)}% of the shopping receipt value.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="serviceRequestDetails"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Shopping List</FormLabel>
                              <FormControl>
                                <Textarea
                                  rows={4}
                                  placeholder="Write the items you want bought, quantities, preferred brands, and any delivery notes."
                                  data-testid="input-errand-shopping-list"
                                  {...field}
                                />
                              </FormControl>
                              <FormDescription>
                                This helps the errand team know exactly what to shop for.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </>
                    )}

                    {serviceType === "errand" && serviceMode === "errand-childcare" && (
                      <>
                        {"basePrice" in service && hasHelpMamaPricing(service) ? (
                          <FormField
                            control={form.control}
                            name="serviceAddonSelections"
                            render={({ field }) => {
                              const ageBands = normalizeHelpMamaPricing(service.helpMamaPricing).ageBands;
                              const currentSelections = field.value || [];
                              const selectedRateId = getHelpMamaRateId(currentSelections);
                              const selectedAgeBandId = getHelpMamaAgeBandId(currentSelections, service.helpMamaPricing);
                              const rateOptions = getHelpMamaRateOptions(service.helpMamaPricing, selectedAgeBandId);
                              return (
                                <FormItem className="space-y-4">
                                  <FormLabel>Mama Care Pricing</FormLabel>
                                  <div className="space-y-2">
                                    <Label>Age band</Label>
                                    {ageBands.map((band) => {
                                      const checked = currentSelections.includes(band.id);
                                      return (
                                        <label
                                          key={band.id}
                                          className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors ${checked ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                                        >
                                          <div className="min-w-0 font-medium leading-5">{band.label}</div>
                                          <Checkbox
                                            checked={checked}
                                            onCheckedChange={() => {
                                              const rateSelections = currentSelections.filter((selection) => selection === selectedRateId);
                                              field.onChange([...rateSelections, band.id]);
                                            }}
                                          />
                                        </label>
                                      );
                                    })}
                                  </div>
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    {rateOptions.map((rate) => {
                                      const checked = selectedRateId === rate.id;
                                      return (
                                        <label
                                          key={rate.id}
                                          className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors sm:p-4 ${checked ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                                        >
                                          <Checkbox
                                            checked={checked}
                                            onCheckedChange={() => {
                                              const ageSelections = currentSelections.filter((selection) => selection === selectedAgeBandId);
                                              field.onChange([...ageSelections, rate.id]);
                                            }}
                                            className="mt-1"
                                          />
                                          <div className="min-w-0">
                                            <div className="font-medium leading-5">{rate.label}</div>
                                            <div className="text-sm text-muted-foreground">{formatAmount(rate.price)}/{rate.unit}</div>
                                          </div>
                                        </label>
                                      );
                                    })}
                                  </div>
                                  {isHelpMamaHourlyRate(selectedRateId) ? (
                                    <FormField
                                      control={form.control}
                                      name="serviceHours"
                                      render={({ field: hoursField }) => (
                                        <FormItem>
                                          <FormLabel>Hours needed</FormLabel>
                                          <FormControl>
                                            <Input
                                              type="number"
                                              min={HELP_MAMA_HOURLY_MINIMUM_HOURS}
                                              value={hoursField.value || ""}
                                              onChange={(event) => hoursField.onChange(Math.max(HELP_MAMA_HOURLY_MINIMUM_HOURS, Number(event.target.value) || HELP_MAMA_HOURLY_MINIMUM_HOURS))}
                                            />
                                          </FormControl>
                                          <FormDescription>
                                            Hourly Mama Care bookings start from {HELP_MAMA_HOURLY_MINIMUM_HOURS} hours.
                                          </FormDescription>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />
                                  ) : null}
                                  <FormDescription>Select a time package and age band for accurate pricing.</FormDescription>
                                  <FormMessage />
                                </FormItem>
                              );
                            }}
                          />
                        ) : null}

                        <FormField
                          control={form.control}
                          name="serviceRequestDetails"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Family Care Notes</FormLabel>
                              <FormControl>
                                <Textarea
                                  rows={4}
                                  placeholder="Share child ages, feeding or diaper needs, clinic visit details, supervision times, allergies, and any safety notes."
                                  data-testid="input-errand-childcare-notes"
                                  {...field}
                                />
                              </FormControl>
                              <FormDescription>
                                This helps the carer prepare safely and gently for the family.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </>
                    )}

                    {serviceType === "errand" && "basePrice" in service && (serviceMode === "errand-laundry" || serviceMode === "errand-house-cleaning") && (
                      <FormField
                        control={form.control}
                        name="serviceAddonSelections"
                        render={({ field }) => {
                          const addons = serviceMode === "errand-laundry" ? service.laundryAddons || [] : service.houseCleaningAddons || [];
                          return (
                            <FormItem>
                              <FormLabel>{serviceMode === "errand-laundry" ? "Laundry Add-Ons" : "Cleaning Add-Ons"}</FormLabel>
                              <div className="space-y-2">
                                {addons.length ? addons.map((addon: { id: string; name: string; price: number }) => {
                                  const checked = (field.value || []).includes(addon.id);
                                  return (
                                    <label key={addon.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                                      <div>
                                        <div className="font-medium">{addon.name}</div>
                                        <div className="text-sm text-muted-foreground">{formatAmount(addon.price)}</div>
                                      </div>
                                      <Checkbox
                                        checked={checked}
                                        onCheckedChange={(nextChecked: boolean) => {
                                          const current = field.value || [];
                                          field.onChange(nextChecked ? [...current, addon.id] : current.filter((id) => id !== addon.id));
                                        }}
                                      />
                                    </label>
                                  );
                                }) : (
                                  <div className="text-sm text-muted-foreground">No add-ons configured for this service yet.</div>
                                )}
                              </div>
                              <FormDescription>
                                {serviceMode === "errand-laundry"
                                  ? "Choose any extra laundry items like duvets or heavy blankets."
                                  : "Choose any extra house cleaning tasks you want added."}
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          );
                        }}
                      />
                    )}

                    {serviceType === "experience" && serviceMode !== "experience-custom-offer" && (
                      <FormField
                        control={form.control}
                        name="serviceRequestDetails"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Special Request</FormLabel>
                            <FormControl>
                              <Textarea
                                rows={4}
                                placeholder="Share anything the host should prepare for, like celebration notes, dietary needs, or pickup preferences."
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>Optional, but helpful for a smoother experience.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {serviceType === "experience" && serviceMode === "experience-custom-offer" && (
                      <FormField
                        control={form.control}
                        name="serviceRequestDetails"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Custom Offer Brief</FormLabel>
                            <FormControl>
                              <Textarea
                                rows={5}
                                placeholder="Describe the experience you want, preferred timing, your group, route ideas, special occasion details, pickup plans, and anything else the host should use to price it."
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>The host or admin will review this and send you a tailored offer with the total cost.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {showZoneSelector && "chauffeurZones" in service && (
                      <FormField
                        control={form.control}
                        name="serviceZone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Zone Pricing</FormLabel>
                            <Select value={field.value || "default"} onValueChange={(value) => field.onChange(value === "default" ? "" : value)}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Mombasa" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="default">Mombasa</SelectItem>
                                {service.chauffeurZones.map((zone) => (
                                  <SelectItem key={zone.id} value={zone.name}>
                                    {zone.name}
                                    {serviceMode === "car-chauffeur-hourly" && zone.hourlyPrice ? ` - ${formatAmount(zone.hourlyPrice)}/hour` : ""}
                                    {serviceMode === "car-chauffeur-day" && zone.dailyPrice ? ` - ${formatAmount(zone.dailyPrice)}/day` : ""}
                                    {serviceMode === "car-self-drive-day" && zone.selfDrivePrice ? ` - ${formatAmount(zone.selfDrivePrice)}/day self-drive` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {serviceType === "car" && serviceMode === "car-self-drive-day" && "selfDriveMileageLimitKm" in service && (service.selfDriveMileageLimitKm || service.selfDriveExtraKmRate) && (
                      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                        {service.selfDriveMileageLimitKm ? `${service.selfDriveMileageLimitKm} km/day included.` : "Mileage charged separately after trip review."}
                        {service.selfDriveExtraKmRate ? ` Extra km charged at ${formatAmount(service.selfDriveExtraKmRate)}/km.` : ""}
                      </div>
                    )}

                    {serviceType !== "errand" && (
                      <FormField
                        control={form.control}
                        name="guests"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Number of People</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Users className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                  type="number"
                                  min="1"
                                  className="pl-10"
                                  data-testid="input-guests"
                                  {...field}
                                  onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    <Separator />

                    <div className="space-y-4">
                      <h3 className="font-semibold">Your Information</h3>

                      <FormField
                        control={form.control}
                        name="guestName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Full Name</FormLabel>
                            <FormControl>
                              <Input placeholder="John Doe" data-testid="input-guest-name" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="guestPhone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone (Optional)</FormLabel>
                            <FormControl>
                              <Input
                                type="tel"
                                placeholder="+254 700 000000"
                                data-testid="input-guest-phone"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </form>
                </Form>
              </Card>
            </div>

            <div className="lg:col-span-1">
              <Card className="min-w-0 p-4 sm:p-6 lg:sticky lg:top-8">
                <h3 className="font-semibold text-lg mb-4">Booking Summary</h3>

                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Service</span>
                    <span className="max-w-[58%] break-words text-right font-medium" data-testid="text-summary-service">
                      {serviceName}
                    </span>
                  </div>

                  {serviceType === "car" && serviceMode !== "car-chauffeur-hourly" && days > 0 && (
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-medium" data-testid="text-summary-duration">
                        {days} {days === 1 ? "day" : "days"}
                      </span>
                    </div>
                  )}

                  {serviceType === "cook" && days > 0 && (
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-medium" data-testid="text-summary-duration-cook">
                        {days} {days === 1 ? "day" : "days"}
                      </span>
                    </div>
                  )}

                  {serviceType === "errand" && errandPackageCount > 0 && (
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Packages</span>
                      <span className="font-medium" data-testid="text-summary-errand-packages">
                        {errandPackageCount} {errandPackageCount === 1 ? "package" : "packages"}
                      </span>
                    </div>
                  )}

                  {serviceType === "car" && serviceMode === "car-chauffeur-hourly" && (
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-medium" data-testid="text-summary-duration-hours">
                        {form.watch("serviceHours") || 0} hours
                      </span>
                    </div>
                  )}

                  {serviceType === "experience" && "durationHours" in service && (
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-medium">{service.durationHours} {service.durationHours === 1 ? "hour" : "hours"}</span>
                    </div>
                  )}

                  {serviceType === "experience" && (
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Guests</span>
                      <span className="font-medium">{form.watch("guests") || 0}</span>
                    </div>
                  )}

                  {serviceType === "experience" && serviceMode === "experience-shared" && selectedExperienceDeparture ? (
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Departure</span>
                      <span className="max-w-[58%] break-words text-right font-medium">
                        {new Date(selectedExperienceDeparture.departureDateTime).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                  ) : null}

                  <div className="rounded-lg border bg-muted/30 p-3">
                    <Label htmlFor="service-promo-code" className="text-sm font-medium">
                      Promo code
                    </Label>
                    <Input
                      id="service-promo-code"
                      value={promoCode}
                      onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
                      placeholder="APRIL-BUNDLE"
                      className="mt-2"
                    />
                    <div className="mt-2 text-xs text-muted-foreground">
                      {promoPreviewQuery.isFetching
                        ? "Checking the best offer for this service..."
                        : promoPreview
                          ? promoPreview.appliedAutomatically
                            ? `${promoPreview.promoName} is applying automatically.`
                            : `${promoPreview.promoName} is ready for this booking.`
                          : promoRejectionReason
                            ? promoRejectionReason
                            : "Bundle offers can auto-apply when this booking qualifies."}
                    </div>
                    {promoPreview ? (
                      <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-emerald-700">Promo applied</div>
                            <div className="mt-1 text-sm font-semibold text-emerald-950">
                              {promoPreview.bundleLabel || promoPreview.promoName}
                            </div>
                            <div className="mt-1 text-xs text-emerald-800">
                              {promoPreview.promoCode
                                ? `Code ${promoPreview.promoCode} is applied to this booking.`
                                : "This offer is applying automatically to this booking."}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-emerald-700">You save</div>
                            <div className="mt-1 text-sm font-semibold text-emerald-950">
                              <CurrencyAmount amountUsd={promoSavings} />
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {"priceWithDriver" in service
                        ? serviceMode === "car-chauffeur-hourly"
                          ? "Price per hour"
                          : serviceMode === "car-self-drive-day"
                            ? "Price per day"
                            : "Chauffeur per day"
                          : "pricePerSession" in service
                            ? serviceMode === "cook-custom-menu"
                              ? "Request fee"
                              : serviceMode === "cook-inclusive"
                                ? "Inclusive package / day"
                                : "Service fee package / day"
                          : serviceType === "errand"
                            ? serviceMode === "errand-childcare"
                              ? "Mama Care package"
                              : serviceMode === "errand-shopping"
                                ? "Base fee + commission"
                                : serviceMode === "errand-laundry"
                                  ? "Base + laundry add-ons"
                                  : serviceMode === "errand-house-cleaning"
                                    ? "Base + cleaning add-ons"
                                    : "Price per package"
                            : "experienceType" in service
                              ? serviceMode === "experience-shared"
                                ? "Shared price per person"
                                : "Private price per person"
                              : "Base service fee"}
                    </span>
                    <span className="font-medium" data-testid="text-summary-unit-price">
                      {"pricePerSession" in service && serviceMode === "cook-custom-menu" ? (
                        <CurrencyAmount amountUsd={cookCustomMenuFeeUsd} />
                      ) : (
                        <CurrencyAmount
                          amountUsd={
                            "priceWithDriver" in service
                              ? serviceMode === "car-chauffeur-hourly"
                                ? service.chauffeurZones.find((zone) => zone.name === form.watch("serviceZone"))?.hourlyPrice || service.priceWithDriverHourly || 0
                                : serviceMode === "car-self-drive-day"
                                  ? service.chauffeurZones.find((zone) => zone.name === form.watch("serviceZone"))?.selfDrivePrice || service.pricePerDay || 0
                                  : service.chauffeurZones.find((zone) => zone.name === form.watch("serviceZone"))?.dailyPrice || service.priceWithDriver
                              : "pricePerSession" in service
                                ? serviceMode === "cook-inclusive"
                                  ? getCookInclusivePrice(service)
                                  : getCookServiceFee(service)
                                : "basePrice" in service
                                  ? errandPackagePrice
                                  : "experienceType" in service
                                    ? serviceMode === "experience-shared"
                                      ? service.sharedPricePerPerson
                                      : service.privatePricePerPerson
                                    : 0
                          }
                        />
                      )}
                    </span>
                  </div>

                  {serviceType === "errand" && errandPackageCount > 0 && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                      <div className="mb-2 font-medium text-foreground">Selected package dates</div>
                      <div className="space-y-1">
                        {sortServiceScheduleSlots((watchedErrandSlots || []).filter((slot): slot is ServiceScheduleSlot => !!slot?.date)).map((slot, index) => (
                          <div key={`${slot.date}-${slot.note}-${index}`}>
                            {slot.date}{slot.note?.trim() ? ` - ${slot.note.trim()}` : ""}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {"basePrice" in service && serviceMode === "errand-shopping" && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                      Each shopping trip = base service fee + {(service.shoppingCommissionPercent ?? DEFAULT_SHOPPING_COMMISSION_PERCENT)}% of the receipt value.
                    </div>
                  )}

                  {"basePrice" in service && serviceMode === "errand-laundry" && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                      Each laundry package = base package + the laundry add-ons you select.
                    </div>
                  )}

                  {"basePrice" in service && serviceMode === "errand-house-cleaning" && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                      Each cleaning package = base package + the cleaning add-ons you select.
                    </div>
                  )}

                  {"basePrice" in service && serviceMode === "errand-childcare" && hasHelpMamaPricing(service) && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                      Each Mama Care package uses the time rate and age band you select.
                    </div>
                  )}

                  {"pricePerSession" in service && serviceMode === "cook-custom-menu" && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                      Submit this brief with a {formatAmount(cookCustomMenuFeeUsd)} creditable fee. Chefs send proposals first, and the final payment only happens after you approve one.
                    </div>
                  )}

                  {"pricePerSession" in service && serviceMode !== "cook-custom-menu" && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                      This chef starts with a base day package for {getCookMinimumGuests(service)} guests, then applies an extra guest fee above that for each booked day.
                    </div>
                  )}

                  {"experienceType" in service && serviceMode === "experience-private" && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                      Private experience pricing is per person, with a minimum of {service.privateMinimumGuests} guests for your own group.
                    </div>
                  )}

                  {"experienceType" in service && serviceMode === "experience-shared" && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                      You're joining a scheduled group departure. After booking, we'll hold your spot and share the final trip note from the host.
                    </div>
                  )}

                  {"experienceType" in service && serviceMode === "experience-custom-offer" && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                      Submit your idea with a {formatAmount(customServiceRequestFeeUsd)} creditable fee. The host or admin will review it and send back a tailored offer for you to accept or decline.
                    </div>
                  )}

                  {"experienceType" in service && experienceAddonTotal > 0 && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                      Add-ons selected: <CurrencyAmount amountUsd={experienceAddonTotal} />
                    </div>
                  )}

                  {promoPreview ? (
                    <div className="flex justify-between text-sm text-emerald-700">
                      <span>{promoPreview.bundleLabel || promoPreview.promoName}</span>
                      <span>-<CurrencyAmount amountUsd={promoSavings} /></span>
                    </div>
                  ) : null}

                  <Separator />

                  <div className="flex justify-between">
                    <span className="font-semibold">Total</span>
                    <div className="text-right">
                      {promoPreview ? (
                        <div className="text-sm text-muted-foreground line-through">
                          <CurrencyAmount amountUsd={totalPrice} />
                        </div>
                      ) : null}
                      {serviceType === "cook" && serviceMode === "cook-custom-menu" ? (
                        <CurrencyAmount
                          amountUsd={discountedTotalPrice}
                          primaryClassName="font-bold text-xl text-primary"
                          data-testid="text-summary-total"
                        />
                      ) : (
                        <CurrencyAmount
                          amountUsd={discountedTotalPrice}
                          primaryClassName="font-bold text-xl text-primary"
                          secondaryClassName="text-sm text-muted-foreground"
                          data-testid="text-summary-total"
                        />
                      )}
                    </div>
                  </div>

                  <CheckoutPaymentPreview
                    title={checkoutPreviewCopy.title}
                    description={checkoutPreviewCopy.description}
                  />

                  <Button
                    type="submit"
                    form="service-booking-form"
                    className="hidden w-full lg:inline-flex"
                    size="lg"
                    disabled={createBookingMutation.isPending}
                    data-testid="button-confirm-booking-desktop"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    {submitActionLabel}
                  </Button>

                  <p className="text-xs text-muted-foreground text-center">
                    {serviceType === "cook" && serviceMode === "cook-custom-menu"
                      ? "Your request fee is credited toward the approved menu. Once you accept the quote, the remaining balance is settled in full."
                      : serviceType === "experience" && serviceMode === "experience-custom-offer"
                        ? `Your ${formatAmount(customServiceRequestFeeUsd)} request fee is credited toward the approved offer. Once you accept it, the remaining balance is settled in full.`
                        : "If checkout pauses, your booking stays safely saved and you can finish payment later from My Bookings."}
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 px-4 py-3 shadow-[0_-18px_40px_rgba(15,23,42,0.16)] backdrop-blur lg:hidden">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {discountedTotalPrice > 0 ? "Total" : "Booking"}
            </div>
            <div className="mt-1 text-base font-semibold text-foreground">
              {discountedTotalPrice > 0 ? <CurrencyAmount amountUsd={discountedTotalPrice} /> : "Review details"}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {mobileBookingSummary}
            </div>
          </div>

          <Button
            type="submit"
            form="service-booking-form"
            className="min-h-11 shrink-0 px-5"
            disabled={createBookingMutation.isPending}
            data-testid="button-confirm-booking"
          >
            {submitActionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
