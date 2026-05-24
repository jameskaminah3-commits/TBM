import { useState, useMemo, useEffect } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Calendar, Users, CheckCircle2, Car, ChefHat, ShoppingBag, Compass, Clock, ArrowRight, ChevronDown, MapPin, BedDouble, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { CurrencyAmount } from "@/components/currency-amount";
import { CheckoutPaymentPreview, bookingCheckoutPreviewCopy } from "@/components/payment-provider-picker";
import { useCurrency } from "@/lib/currency";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { calculateCookServiceTotal, getCookMinimumGuests, getCookServiceFee } from "@shared/cook-pricing";
import {
  calculateHelpMamaPackagePrice,
  calculateHouseCleaningPackagePrice,
  HOUSE_CLEANING_BASE_ROOM_LABEL,
  getHelpMamaAgeBandId,
  getHelpMamaRateId,
  getHelpMamaRateOptions,
  getHelpMamaStartingPrice,
  getHouseCleaningBedroomCount,
  hasHelpMamaPricing,
  isHelpMamaHourlyRate,
  normalizeHelpMamaPricing,
} from "@shared/errand-pricing";
import type {
  Stay,
  Car as CarType,
  Cook as CookType,
  Errand as ErrandType,
  Experience as ExperienceType,
  MarketingAttributionPayload,
  MarketingPromoPreviewResult,
  StayServiceSelection,
} from "@shared/schema";
import { insertBookingSchema } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  captureMarketingQueryParams,
  clearMarketingAttributionContext,
  getMarketingAttributionPayload,
  trackMarketingPageView,
} from "@/lib/marketing-attribution";
import {
  clearPendingBookingDraft,
  loadPendingBookingDraft,
  savePendingBookingDraft,
  isPendingBookingPathMatch,
} from "@/lib/pending-booking";
import { readStaySearchState, toSearchSuffix } from "@/lib/stay-search";

type StayAvailability = {
  blockedRanges: Array<{
    id: string;
    source: "booking" | "manual";
    startDate: string;
    endDate: string;
    checkoutDate: string;
    status: string;
    guestName: string;
  }>;
  availableFrom: string;
};

type CarAddonService = CarType & { category: "cars" };
type CookAddonService = CookType & { category: "cooks" };
type ErrandAddonService = ErrandType & { category: "errands" };
type ExperienceConciergeService = ExperienceType & { category: "experiences" };
type AddonService = CarAddonService | CookAddonService | ErrandAddonService;
type ConciergeService = AddonService | ExperienceConciergeService;

type ConciergeRecommendation = {
  key: string;
  serviceId: string;
  category: ConciergeService["category"];
  title: string;
  summary: string;
  priceLabel: string;
  score: number;
  stage: "Arrival" | "Stay" | "Explore";
  reasons: string[];
  actionLabel: string;
  suggestedMode?: string;
};

type RankedAddonService = {
  service: AddonService;
  score: number;
  reasons: string[];
};

const addonServiceSections = [
  { key: "cars", label: "Transport", description: "Cars and chauffeur options", icon: Car },
  { key: "cooks", label: "Chefs", description: "Private chefs and in-stay dining", icon: ChefHat },
  { key: "errands", label: "Errands", description: "Shopping, laundry, and home support", icon: ShoppingBag },
] as const;

const bookingFormSchema = insertBookingSchema.extend({
  checkIn: z.string().min(1, "Check-in date is required"),
  checkOut: z.string().min(1, "Check-out date is required"),
  guests: z.coerce.number().min(1, "At least 1 guest required"),
  guestName: z.string().min(2, "Name is required"),
  guestPhone: z.string().optional(),
}).refine((data) => {
  if (!data.checkIn || !data.checkOut) return true;
  return new Date(data.checkOut) >= new Date(data.checkIn);
}, {
  message: "Check-out date cannot be before check-in date",
  path: ["checkOut"],
});

type BookingFormValues = z.infer<typeof bookingFormSchema>;
type StayBookingSubmission = BookingFormValues & {
  promoCode?: string | null;
  marketingAttribution?: MarketingAttributionPayload;
};

type BookingCheckoutResponse = {
  payment?: {
    redirectUrl?: string | null;
  } | null;
  warning?: string | null;
};

function normalizeText(value: string) {
  return value.toLowerCase();
}

function tokenize(value: string) {
  return Array.from(new Set(normalizeText(value).split(/[^a-z0-9]+/).filter((token) => token.length > 2)));
}

function scoreLocationMatch(stayLocation: string, serviceLocation?: string | null) {
  if (!serviceLocation?.trim()) return 4;
  const stayTokens = new Set(tokenize(stayLocation));
  const serviceTokens = tokenize(serviceLocation);
  const overlap = serviceTokens.filter((token) => stayTokens.has(token)).length;
  if (overlap >= 2) return 18;
  if (overlap === 1) return 10;
  return 0;
}

function includesAny(haystack: string, keywords: string[]) {
  return keywords.some((keyword) => haystack.includes(keyword));
}

function upsertStaySelection(
  selections: StayServiceSelection[],
  nextSelection: StayServiceSelection,
) {
  const filtered = selections.filter((selection) => selection.serviceId !== nextSelection.serviceId);
  return [...filtered, nextSelection];
}

function getSupportedModes(service: ConciergeService): string[] {
  if (service.category === "cars") {
    return [
      "car-chauffeur-day",
      ...(service.priceWithDriverHourly ? ["car-chauffeur-hourly"] : []),
      ...(service.pricePerDay ? ["car-self-drive-day"] : []),
    ];
  }

  if (service.category === "cooks") {
    return ["cook-service-fee", "cook-inclusive"];
  }

  if (service.category === "errands") {
    return [
      ...(hasHelpMamaPricing(service) || service.shoppingEnabled || service.laundryEnabled || service.houseCleaningEnabled ? [] : ["errand-base"]),
      ...(service.shoppingEnabled ? ["errand-shopping"] : []),
      ...(service.laundryEnabled ? ["errand-laundry"] : []),
      ...(service.houseCleaningEnabled ? ["errand-house-cleaning"] : []),
      ...(supportsChildcareErrand(service) ? ["errand-childcare"] : []),
    ];
  }

  return [
    ...(service.privateEnabled ? ["experience-private"] : []),
    ...(service.sharedEnabled ? ["experience-shared"] : []),
    ...(service.customQuoteEnabled ? ["experience-custom-offer"] : []),
  ];
}

function supportsChildcareErrand(service: ConciergeService): boolean {
  if (service.category !== "errands") return false;

  const text = [
    service.serviceName,
    service.description,
    ...(service.features || []),
  ].join(" ").toLowerCase();

  return hasHelpMamaPricing(service) || /\b(childcare|child care|children|kids|baby|babies|infant|mama|mother|family|clinic|supervision|nanny|carer)\b/.test(text);
}

function getServiceModeLabel(mode?: string | null) {
  switch (mode) {
    case "car-chauffeur-day":
      return "Chauffeur day";
    case "car-chauffeur-hourly":
      return "Chauffeur per hour";
    case "car-self-drive-day":
      return "Self-drive day";
    case "cook-service-fee":
      return "Chef service fee";
    case "cook-inclusive":
      return "Chef inclusive";
    case "errand-base":
      return "Base support";
    case "errand-shopping":
      return "Shopping support";
    case "errand-laundry":
      return "Laundry support";
    case "errand-house-cleaning":
      return "House cleaning";
    case "errand-childcare":
      return "Help Mama support";
    case "experience-private":
      return "Private experience";
    case "experience-shared":
      return "Shared departure";
    case "experience-custom-offer":
      return "Tailored experience";
    default:
      return "Offer";
  }
}

function getPreferredMode(service: ConciergeService, suggestedMode?: string) {
  const supportedModes = getSupportedModes(service);
  if (suggestedMode && supportedModes.includes(suggestedMode)) {
    return suggestedMode;
  }

  return supportedModes[0] || "";
}

export default function Booking() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { formatAmount } = useCurrency();
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [stayServiceSelections, setStayServiceSelections] = useState<StayServiceSelection[]>([]);
  const [configuringServiceId, setConfiguringServiceId] = useState<string | null>(null);
  const [draftSelection, setDraftSelection] = useState<StayServiceSelection | null>(null);
  const [hasRestoredPendingDraft, setHasRestoredPendingDraft] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const staySearch = useMemo(() => readStaySearchState(search), [search]);
  const bookingPath = `/book/${id}${toSearchSuffix(search)}`;

  const { data: accommodation } = useQuery<Stay>({
    queryKey: ["/api/stays", id],
    queryFn: async () => {
      const response = await fetch(`/api/stays/${id}`);
      if (!response.ok) throw new Error("Failed to fetch stay");
      return response.json();
    },
  });

  const { data: conciergeServices = [] } = useQuery<ConciergeService[]>({
    queryKey: ["/api/stay-concierge-services"],
    queryFn: async () => {
      const [cars, cooks, errands, experiences] = await Promise.all([
        fetch("/api/cars").then((r) => r.json()),
        fetch("/api/cooks").then((r) => r.json()),
        fetch("/api/errands").then((r) => r.json()),
        fetch("/api/experiences").then((r) => r.json()),
      ]);

      return [
        ...(cars as CarType[]).map((car) => ({ ...car, category: "cars" as const })),
        ...(cooks as CookType[]).map((cook) => ({ ...cook, category: "cooks" as const })),
        ...(errands as ErrandType[]).map((errand) => ({ ...errand, category: "errands" as const })),
        ...(experiences as ExperienceType[]).map((experience) => ({ ...experience, category: "experiences" as const })),
      ];
    },
  });
  const availabilityAwareServiceIds = useMemo(
    () => conciergeServices
      .filter((service) => service.category === "cars" || service.category === "cooks")
      .map((service) => service.id),
    [conciergeServices],
  );

  const { data: availability } = useQuery<StayAvailability>({
    queryKey: ["/api/stays", id, "availability"],
    enabled: !!id,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const response = await fetch(`/api/stays/${id}/availability`);
      if (!response.ok) throw new Error("Failed to fetch availability");
      return response.json();
    },
  });

  const defaultGuestName = user
    ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || ""
    : "";
  const defaultGuestPhone = user?.phone || "";

  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: {
      accommodationId: id || "",
      guestName: defaultGuestName,
      guestPhone: defaultGuestPhone,
      checkIn: staySearch.checkIn,
      checkOut: staySearch.checkOut,
      guests: staySearch.guests || 2,
      selectedServices: [],
      totalPrice: 0,
      status: "upcoming",
    },
  });
  const watchedBookingDraft = useWatch({ control: form.control });
  const isBookingFormDirty = form.formState.isDirty;

  useEffect(() => {
    captureMarketingQueryParams();
    void trackMarketingPageView();
    const savedPromoCode = getMarketingAttributionPayload().promoCode;
    if (savedPromoCode) {
      setPromoCode(savedPromoCode);
    }
  }, []);

  useEffect(() => {
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

  const buildBookingSubmission = (
    values: BookingFormValues,
    options?: {
      promoCodeOverride?: string | null;
      selectedServiceIds?: string[];
      selections?: StayServiceSelection[];
    },
  ): StayBookingSubmission => {
    const nextPromoCode = options?.promoCodeOverride?.trim().toUpperCase() || normalizedPromoCode || null;
    const nextSelectedServices = options?.selectedServiceIds ?? selectedServices;
    const nextSelections = options?.selections ?? stayServiceSelections;

    return {
      ...values,
      selectedServices: nextSelectedServices,
      stayServiceSelections: nextSelections,
      totalPrice,
      promoCode: nextPromoCode,
      marketingAttribution: getMarketingAttributionPayload({
        landingPath: bookingPath,
        promoCode: nextPromoCode ?? undefined,
      }),
    };
  };

  const createBookingMutation = useMutation({
    mutationFn: async (data: StayBookingSubmission) => {
      const response = await apiRequest("POST", "/api/bookings", data);
      return response.json() as Promise<BookingCheckoutResponse>;
    },
    onSuccess: () => {
      clearPendingBookingDraft();
      clearMarketingAttributionContext();
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      toast({
        title: "Booking saved",
        description: "Your booking is in. Secure payment stays ready in My Bookings whenever you are.",
      });
      setLocation("/bookings");
    },
    onError: (error: Error) => {
      toast({
        title: "Booking failed",
        description: error.message.replace(/^\d+:\s*/, "") || "Please try again or contact support.",
        variant: "destructive",
      });
    },
  });

  const removeSelectedService = (serviceId: string) => {
    setSelectedServices((current) => current.filter((currentId) => currentId !== serviceId));
    setStayServiceSelections((current) => current.filter((selection) => selection.serviceId !== serviceId));
  };

  const getServicePrice = (service: AddonService): number => {
    if (service.category === "cars") {
      return service.pricePerDay ?? service.priceWithDriver;
    }
    if (service.category === "cooks") {
      return getCookServiceFee(service);
    }
    return service.basePrice;
  };

  const getExistingSelection = (serviceId: string) => (
    stayServiceSelections.find((selection) => selection.serviceId === serviceId) || null
  );

  const buildDefaultStaySelection = (service: ConciergeService, suggestedMode?: string): StayServiceSelection => {
    const existing = getExistingSelection(service.id);
    if (existing) return existing;
    const preferredMode = getPreferredMode(service, suggestedMode);

    if (service.category === "cars") {
      return {
        serviceId: service.id,
        category: "cars",
        serviceMode: preferredMode,
        units: preferredMode === "car-chauffeur-hourly" ? 3 : Math.max(1, nights || 1),
        guests: guestsValue,
        serviceHours: preferredMode === "car-chauffeur-hourly" ? 3 : null,
        servicePickupLocation: accommodation?.location || "",
        serviceReturnLocation: accommodation?.location || "",
        serviceStartTime: preferredMode === "car-chauffeur-hourly" ? "09:00" : null,
        serviceAddonSelections: [],
        serviceRequestDetails: "",
      };
    }

    if (service.category === "cooks") {
      return {
        serviceId: service.id,
        category: "cooks",
        serviceMode: preferredMode,
        units: Math.max(1, nights || 1),
        guests: guestsValue,
        serviceLocation: accommodation?.location || "",
        serviceAddonSelections: [],
        serviceRequestDetails: "",
      };
    }

    if (service.category === "errands") {
      return {
        serviceId: service.id,
        category: "errands",
        serviceMode: preferredMode,
        units: 1,
        guests: 1,
        serviceHours: preferredMode === "errand-house-cleaning" ? 1 : null,
        serviceLocation: accommodation?.location || "",
        serviceBudgetAmount: service.shoppingEnabled ? 50 : null,
        serviceAddonSelections: [],
        serviceRequestDetails: service.shoppingEnabled ? "Arrival groceries" : "",
      };
    }

      return {
        serviceId: service.id,
        category: "experiences",
        serviceMode: preferredMode,
        units: 1,
        guests: guestsValue,
        serviceAddonSelections: [],
        serviceDepartureId: "",
        serviceRequestDetails: "",
      };
  };

  const openSelectionDialog = (serviceId: string, suggestedMode?: string) => {
    const service = availableConciergeServices.find((item) => item.id === serviceId);
    if (!service) return;
    const nextDraft = buildDefaultStaySelection(service, suggestedMode);
    setDraftSelection(nextDraft);
    setConfiguringServiceId(serviceId);
  };

  const saveDraftSelection = () => {
    if (!draftSelection) return;
    setStayServiceSelections((current) => upsertStaySelection(current, draftSelection));
    setSelectedServices((current) => (
      current.includes(draftSelection.serviceId) ? current : [...current, draftSelection.serviceId]
    ));
    setConfiguringServiceId(null);
    setDraftSelection(null);
  };

  const getServiceTitle = (service: AddonService): string => {
    if (service.category === "cars") return service.model;
    if (service.category === "cooks") return service.title;
    return service.serviceName;
  };

  const getServicePriceLabel = (service: AddonService): string => {
    const price = getServicePrice(service);
    if (service.category === "cars") return `${formatAmount(price)}/day`;
    if (service.category === "cooks") return `${formatAmount(price)}/day chef fee`;
    if (hasHelpMamaPricing(service)) return `From ${formatAmount(getHelpMamaStartingPrice(service.helpMamaPricing))}`;
    if (service.houseCleaningEnabled && !service.shoppingEnabled && !service.laundryEnabled) return `${formatAmount(price)} studio / 1-bedroom clean`;
    return `${formatAmount(price)} base`;
  };

  const calculateServiceTotal = (service: AddonService, nights: number): number => {
    const configured = getExistingSelection(service.id);

    if (service.category === "cars") {
      if (configured?.serviceMode === "car-chauffeur-hourly") {
        return (configured.serviceHours || configured.units || 3) * (service.priceWithDriverHourly || service.priceWithDriver);
      }
      return getServicePrice(service) * (configured?.units || nights);
    }

    if (service.category === "cooks") {
      const units = configured?.units || nights;
      return calculateCookServiceTotal(service, configured?.guests || guestsValue, units);
    }

    if (configured?.serviceMode === "errand-shopping") {
      const budgetAmount = configured.serviceBudgetAmount || 0;
      return service.basePrice + budgetAmount + Math.ceil((budgetAmount * service.shoppingCommissionPercent) / 100);
    }

    if (configured?.serviceMode === "errand-childcare" && hasHelpMamaPricing(service)) {
      return calculateHelpMamaPackagePrice(service, configured.serviceAddonSelections || [], configured.serviceHours) * (configured.units || 1);
    }

    const selectedAddons = configured?.serviceAddonSelections || [];
    if (configured?.serviceMode === "errand-house-cleaning") {
      return calculateHouseCleaningPackagePrice(service, selectedAddons, configured.serviceHours) * (configured?.units || 1);
    }

    const addonTotal = configured?.serviceMode === "errand-laundry"
      ? (service.laundryAddons || []).filter((addon) => selectedAddons.includes(addon.id)).reduce((sum, addon) => sum + addon.price, 0)
      : 0;

    return service.basePrice + addonTotal;
  };

  const calculateNights = (checkIn: string, checkOut: string): number => {
    if (!checkIn || !checkOut) return 0;
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diff = end.getTime() - start.getTime();
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const checkInValue = useWatch({ control: form.control, name: "checkIn" });
  const checkOutValue = useWatch({ control: form.control, name: "checkOut" });
  const guestsValue = useWatch({ control: form.control, name: "guests" });
  const { data: conciergeAvailability } = useQuery<{ unavailableServiceIds: string[] }>({
    queryKey: ["/api/stay-concierge-availability", checkInValue, checkOutValue, availabilityAwareServiceIds.join(",")],
    enabled: !!checkInValue && !!checkOutValue && availabilityAwareServiceIds.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const params = new URLSearchParams({
        checkIn: checkInValue,
        checkOut: checkOutValue,
        serviceIds: availabilityAwareServiceIds.join(","),
      });
      const response = await fetch(`/api/stay-concierge-availability?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch concierge availability");
      return response.json();
    },
  });
  const unavailableConciergeServiceIds = useMemo(
    () => new Set(conciergeAvailability?.unavailableServiceIds || []),
    [conciergeAvailability],
  );
  const availableConciergeServices = useMemo(
    () => conciergeServices.filter((service) => !unavailableConciergeServiceIds.has(service.id)),
    [conciergeServices, unavailableConciergeServiceIds],
  );
  const addonServices = useMemo(
    () => availableConciergeServices.filter((service): service is AddonService => service.category !== "experiences"),
    [availableConciergeServices],
  );
  const configuringService = useMemo(
    () => availableConciergeServices.find((service) => service.id === configuringServiceId) || null,
    [availableConciergeServices, configuringServiceId],
  );
  const configuringServiceModes = useMemo(
    () => (configuringService ? getSupportedModes(configuringService) : []),
    [configuringService],
  );
  const configuringErrandAddons = useMemo(() => {
    if (!configuringService || configuringService.category !== "errands" || !draftSelection) {
      return [];
    }

    if (draftSelection.serviceMode === "errand-laundry") {
      return configuringService.laundryAddons || [];
    }

    if (draftSelection.serviceMode === "errand-house-cleaning") {
      return configuringService.houseCleaningAddons || [];
    }

    return [];
  }, [configuringService, draftSelection]);
  const { data: sharedDepartures = [] } = useQuery<Array<{ id: string; date: string; time: string; spotsLeft: number }>>({
    queryKey: ["/api/experiences", configuringServiceId, "shared-departures"],
    enabled: !!configuringServiceId && !!configuringService && configuringService.category === "experiences" && draftSelection?.serviceMode === "experience-shared",
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const response = await fetch(`/api/experiences/${configuringServiceId}/shared-departures`);
      if (!response.ok) throw new Error("Failed to fetch shared departures");
      return response.json();
    },
  });

  const nights = useMemo(() => calculateNights(checkInValue || "", checkOutValue || ""), [checkInValue, checkOutValue]);
  const accommodationTotal = useMemo(() => (accommodation?.price || 0) * nights, [accommodation?.price, nights]);
  const servicesTotal = useMemo(() => {
    return conciergeServices
      .filter((service) => selectedServices.includes(service.id))
      .reduce((sum, service) => {
        if (service.category === "experiences") {
          const selection = getExistingSelection(service.id);
          const experienceGuests = selection?.guests || guestsValue;
          if (selection?.serviceMode === "experience-custom-offer") {
            return sum;
          }
          const experiencePrice = selection?.serviceMode === "experience-shared"
            ? service.sharedPricePerPerson || service.price
            : service.privatePricePerPerson || service.price;
          return sum + (experiencePrice * experienceGuests);
        }

        return sum + calculateServiceTotal(service, nights);
      }, 0);
  }, [conciergeServices, guestsValue, nights, selectedServices, stayServiceSelections]);
  const selectedSummaryServices = useMemo(
    () => conciergeServices.filter((service) => selectedServices.includes(service.id)),
    [conciergeServices, selectedServices],
  );
  const totalPrice = useMemo(() => accommodationTotal + servicesTotal, [accommodationTotal, servicesTotal]);
  const normalizedPromoCode = promoCode.trim().toUpperCase();
  const selectedPromoCategories = useMemo(
    () => Array.from(new Set(
      selectedServices
        .map((serviceId) => conciergeServices.find((service) => service.id === serviceId)?.category)
        .filter((category): category is StayServiceSelection["category"] => Boolean(category)),
    )),
    [conciergeServices, selectedServices],
  );
  const promoPreviewQuery = useQuery<MarketingPromoPreviewResult>({
    queryKey: [
      "/api/marketing/promos/preview",
      id,
      totalPrice,
      checkInValue,
      checkOutValue,
      guestsValue,
      normalizedPromoCode,
      selectedServices.join(","),
      selectedPromoCategories.join(","),
    ],
    enabled: Boolean(accommodation && checkInValue && checkOutValue && guestsValue > 0 && totalPrice > 0),
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/marketing/promos/preview", {
        subtotal: totalPrice,
        selectedCategories: selectedPromoCategories,
        selectedServiceIds: selectedServices,
        accommodationId: id || null,
        guests: guestsValue,
        checkIn: checkInValue,
        checkOut: checkOutValue,
        promoCode: normalizedPromoCode || null,
      });
      return response.json() as Promise<MarketingPromoPreviewResult>;
    },
  });
  const promoPreview = promoPreviewQuery.data?.promo ?? null;
  const discountedTotalPrice = promoPreview?.discountedSubtotal ?? totalPrice;
  const promoSavings = promoPreview?.discountAmount ?? 0;
  const promoRejectionReason = normalizedPromoCode ? (promoPreviewQuery.data?.rejectionReason ?? null) : null;
  const hasCustomQuoteAddon = useMemo(
    () => stayServiceSelections.some((selection) => selection.serviceMode === "experience-custom-offer"),
    [stayServiceSelections],
  );
  const [isBrowseAllAddonsOpen, setIsBrowseAllAddonsOpen] = useState(false);
  const [expandedAddonSections, setExpandedAddonSections] = useState<Record<AddonService["category"], boolean>>({
    cars: true,
    cooks: true,
    errands: true,
  });

  useEffect(() => {
    if (authLoading || isAuthenticated) {
      return;
    }

    if (!isBookingFormDirty && selectedServices.length === 0 && stayServiceSelections.length === 0 && !normalizedPromoCode) {
      return;
    }

    savePendingBookingDraft({
      kind: "stay",
      path: bookingPath,
      payload: buildBookingSubmission(form.getValues()),
    });
  }, [
    authLoading,
    bookingPath,
    buildBookingSubmission,
    form,
    isAuthenticated,
    isBookingFormDirty,
    normalizedPromoCode,
    selectedServices,
    stayServiceSelections,
    watchedBookingDraft,
  ]);

  const rankedAddonServices = useMemo<RankedAddonService[]>(() => {
    if (!accommodation) return [];

    const stayText = normalizeText([
      accommodation.title,
      accommodation.location,
      accommodation.description,
      ...accommodation.features,
    ].join(" "));

    const hasKitchen = includesAny(stayText, ["kitchen", "self catering", "chef", "villa", "apartment"]);
    const isLuxuryStay = accommodation.price >= 280 || includesAny(stayText, ["luxury", "private pool", "villa"]);
    const isLongStay = nights >= 4;
    const isShortStay = nights > 0 && nights <= 2;
    const isFamilyTrip = guestsValue >= 4 || accommodation.bedrooms >= 2;

    return addonServices
      .map((service) => {
        const reasons: string[] = [];
        let score = scoreLocationMatch(accommodation.location, service.location);

        if (service.category === "cars") {
          if (service.seats >= guestsValue) score += 14;
          if (isFamilyTrip && service.seats >= guestsValue) {
            score += 12;
            reasons.push(`Fits ${guestsValue} guests comfortably`);
          }
          if (isLongStay) {
            score += 6;
            reasons.push("Useful for a multi-day stay");
          }
          if (isShortStay) {
            score += 4;
            reasons.push("Good for airport runs and quick city movement");
          }
        }

        if (service.category === "cooks") {
          const minimumGuests = getCookMinimumGuests(service);
          if (guestsValue < minimumGuests || service.maxGuests < guestsValue) {
            return { service, score: -1, reasons: [`Starts from ${minimumGuests} guest${minimumGuests === 1 ? "" : "s"}`] };
          }
          score += 15;
          if (isFamilyTrip) {
            score += 10;
            reasons.push("Works well for group meals at the stay");
          }
          if (isLuxuryStay || hasKitchen) {
            score += 10;
            reasons.push("Strong fit for in-villa dining");
          }
          if (isLongStay) {
            score += 5;
          }
        }

        if (service.category === "errands") {
          if (service.shoppingEnabled && (hasKitchen || isLongStay)) {
            score += 16;
            reasons.push("Helps stock the stay without losing your first day");
          }
          if (service.laundryEnabled && nights >= 5) {
            score += 12;
            reasons.push("Useful once the stay stretches past a few nights");
          }
          if (service.houseCleaningEnabled && (isLongStay || isFamilyTrip || accommodation.bathrooms >= 2)) {
            score += 11;
            reasons.push("Keeps the space comfortable during longer stays");
          }
          if (!reasons.length) {
            reasons.push("Good support for day-to-day convenience");
          }
        }

        if (!reasons.length) {
          reasons.push("Relevant to this stay");
        }

        return { service, score, reasons: reasons.slice(0, 3) };
      })
      .filter(({ score }) => score >= 0)
      .sort((left, right) => right.score - left.score);
  }, [accommodation, addonServices, guestsValue, nights]);
  const rankedAddonServiceSections = useMemo(
    () => addonServiceSections.map((section) => ({
      ...section,
      items: rankedAddonServices.filter(({ service }) => service.category === section.key),
    })),
    [rankedAddonServices],
  );

  const conciergeRecommendations = useMemo<ConciergeRecommendation[]>(() => {
    if (!accommodation) return [];

    const stayText = normalizeText([
      accommodation.title,
      accommodation.location,
      accommodation.description,
      ...accommodation.features,
    ].join(" "));

    const isLuxuryStay = accommodation.price >= 280 || includesAny(stayText, ["luxury", "villa", "private pool", "sea view"]);
    const isLongStay = nights >= 4;
    const isShortStay = nights > 0 && nights <= 2;
    const isFamilyTrip = guestsValue >= 4 || accommodation.bedrooms >= 2;
    const isCityStay = includesAny(stayText, ["nairobi", "city", "kilimani", "westlands", "urban"]);
    const isCoastalStay = includesAny(stayText, ["diani", "watamu", "nyali", "mombasa", "beach", "coast", "ocean"]);
    const hasKitchen = includesAny(stayText, ["kitchen", "self catering", "villa", "apartment"]);

    const recommendations: ConciergeRecommendation[] = [];

    availableConciergeServices.forEach((service) => {
      const locationScore = scoreLocationMatch(accommodation.location, service.location);

      if (service.category === "cars" && service.seats >= guestsValue) {
        if (service.priceWithDriverHourly && (isShortStay || isCityStay)) {
          const reasons = [
            isShortStay ? "Better for airport runs and one-off plans" : "Useful when you only need a car for specific windows",
            isCityStay ? "A strong fit for city movement without paying for a full day" : "Lets you stay flexible without committing a whole day",
          ];
          recommendations.push({
            key: `${service.id}-hourly`,
            serviceId: service.id,
            category: service.category,
            title: `${service.model} hourly chauffeur`,
            summary: "Pre-book a driver for arrivals, dinner transfers, meetings, or a few planned stops.",
            priceLabel: `${formatAmount(service.priceWithDriverHourly)}/hour`,
            score: 54 + locationScore + (isShortStay ? 14 : 0) + (isCityStay ? 10 : 0),
            stage: "Arrival",
            reasons,
            actionLabel: selectedServices.includes(service.id) ? "Edit stay transport" : "Add stay transport",
            suggestedMode: "car-chauffeur-hourly",
          });
        }

        if (service.pricePerDay || service.priceWithDriver) {
          const dailyPrice = service.pricePerDay ?? service.priceWithDriver;
          const reasons = [
            isFamilyTrip ? `Well suited for ${guestsValue} guests` : "Keeps local transport simple during the stay",
            isLongStay ? "Worth it when you have multiple days to cover" : "Good if you want flexible movement around the area",
          ];
          recommendations.push({
            key: `${service.id}-day`,
            serviceId: service.id,
            category: service.category,
            title: `${service.model} day support`,
            summary: "A dependable car option for airport transfers, errands, dining plans, and day movement around the stay.",
            priceLabel: `${formatAmount(dailyPrice)}/day`,
            score: 42 + locationScore + (isFamilyTrip ? 12 : 0) + (isLongStay ? 8 : 0),
            stage: "Arrival",
            reasons,
            actionLabel: selectedServices.includes(service.id) ? "Edit stay transport" : "Add car to stay",
            suggestedMode: "car-chauffeur-day",
          });
        }
      }

      if (service.category === "cooks") {
        const minimumGuests = getCookMinimumGuests(service);
        if (guestsValue < minimumGuests || service.maxGuests < guestsValue) {
          return;
        }
        const reasons = [
          isFamilyTrip ? "Useful when several people are dining at the stay" : "Takes meal planning off the trip",
          isLuxuryStay || hasKitchen ? "Fits a stay designed for dining in" : "Good for your arrival night or one special meal",
        ];
        recommendations.push({
          key: `${service.id}-chef`,
          serviceId: service.id,
          category: service.category,
          title: service.title,
          summary: "A chef recommendation that matches the size and comfort level of this stay.",
          priceLabel: `${formatAmount(getCookServiceFee(service))} chef fee`,
          score: 48 + locationScore + (isFamilyTrip ? 14 : 0) + (isLuxuryStay ? 8 : 0) + (hasKitchen ? 8 : 0),
          stage: "Stay",
          reasons,
          actionLabel: selectedServices.includes(service.id) ? "Edit chef setup" : "Add chef to stay",
          suggestedMode: "cook-service-fee",
        });
      }

      if (service.category === "errands") {
        if (service.shoppingEnabled && (hasKitchen || isLongStay || isShortStay)) {
          recommendations.push({
            key: `${service.id}-shopping`,
            serviceId: service.id,
            category: service.category,
            title: `${service.serviceName} shopping support`,
            summary: "Ideal if you want the stay stocked before arrival or want to avoid the first grocery run.",
            priceLabel: `${formatAmount(service.basePrice)} base`,
            score: 46 + locationScore + (hasKitchen ? 12 : 0) + (isLongStay ? 8 : 0) + (isShortStay ? 5 : 0),
            stage: "Arrival",
            reasons: [
              hasKitchen ? "Matches a self-catering stay" : "Useful for first-day convenience",
              isLongStay ? "Especially helpful for longer stays" : "Good if you want to settle in faster",
            ],
            actionLabel: selectedServices.includes(service.id) ? "Edit grocery support" : "Add grocery support",
            suggestedMode: "errand-shopping",
          });
        }

        if (supportsChildcareErrand(service) && isFamilyTrip) {
          recommendations.push({
            key: `${service.id}-childcare`,
            serviceId: service.id,
            category: service.category,
            title: `${service.serviceName} family support`,
            summary: "Useful when parents need gentle supervision, feeding help, clinic visit support, or quiet coverage during work plans.",
            priceLabel: hasHelpMamaPricing(service)
              ? `From ${formatAmount(getHelpMamaStartingPrice(service.helpMamaPricing))}`
              : `${formatAmount(service.basePrice)} base`,
            score: 49 + locationScore + 12,
            stage: "Stay",
            reasons: [
              "Designed for travelling families",
              "Helpful when parents need conference, work, or rest time",
            ],
            actionLabel: selectedServices.includes(service.id) ? "Edit family support" : "Add family support",
            suggestedMode: "errand-childcare",
          });
        }

        if (service.houseCleaningEnabled && (isLongStay || isFamilyTrip || accommodation.bathrooms >= 2)) {
          recommendations.push({
            key: `${service.id}-cleaning`,
            serviceId: service.id,
            category: service.category,
            title: `${service.serviceName} cleaning support`,
            summary: "A comfort-focused recommendation to keep the stay feeling reset when several people are using it.",
            priceLabel: `${formatAmount(service.basePrice)} ${HOUSE_CLEANING_BASE_ROOM_LABEL}`,
            score: 43 + locationScore + (isLongStay ? 12 : 0) + (isFamilyTrip ? 9 : 0),
            stage: "Stay",
            reasons: [
              isLongStay ? "A strong fit for a multi-night booking" : "Helpful when the villa gets busy",
              accommodation.bathrooms >= 2 ? "Makes sense for a larger stay footprint" : "Good for comfort between plans",
            ],
            actionLabel: selectedServices.includes(service.id) ? "Edit cleaning support" : "Add cleaning support",
            suggestedMode: "errand-house-cleaning",
          });
        }

        if (service.laundryEnabled && nights >= 5) {
          recommendations.push({
            key: `${service.id}-laundry`,
            serviceId: service.id,
            category: service.category,
            title: `${service.serviceName} laundry support`,
            summary: "Worth planning early so a longer stay does not turn into suitcase management.",
            priceLabel: `${formatAmount(service.basePrice)} base`,
            score: 40 + locationScore + 14,
            stage: "Stay",
            reasons: [
              "Most useful once the stay stretches past a few nights",
              isFamilyTrip ? "Especially practical for group packing" : "Helps keep the trip light and easy",
            ],
            actionLabel: selectedServices.includes(service.id) ? "Edit laundry support" : "Plan laundry support",
            suggestedMode: "errand-laundry",
          });
        }
      }

      if (service.category === "experiences" && service.maxGuests >= guestsValue) {
        const preferredExperienceMode =
          guestsValue <= 3 && service.privateEnabled
            ? "experience-private"
            : service.sharedEnabled
              ? "experience-shared"
              : service.privateEnabled
                ? "experience-private"
                : service.customQuoteEnabled
                  ? "experience-custom-offer"
                  : null;

        if (preferredExperienceMode) {
          const price =
            preferredExperienceMode === "experience-shared"
              ? service.sharedPricePerPerson || service.price
              : preferredExperienceMode === "experience-private"
                ? service.privatePricePerPerson || service.price
                : 0;

          const reasons = [
            isCoastalStay ? "Pairs naturally with a leisure-style stay" : "Gives the trip a clear day plan beyond the villa",
            preferredExperienceMode === "experience-shared"
              ? "Shared departures make sense when flexibility matters"
              : "Private format keeps the trip tailored to your group",
          ];

          recommendations.push({
            key: `${service.id}-${preferredExperienceMode}`,
            serviceId: service.id,
            category: service.category,
            title: service.title,
            summary: "An experience that complements the mood and pace of this stay rather than feeling tacked on.",
            priceLabel: preferredExperienceMode === "experience-custom-offer" ? "Tailored quote" : `${formatAmount(price)}/person`,
            score: 49 + locationScore + (isCoastalStay ? 14 : 0) + (isLuxuryStay ? 6 : 0),
            stage: "Explore",
            reasons,
            actionLabel:
              preferredExperienceMode === "experience-shared"
                ? (selectedServices.includes(service.id) ? "Edit shared experience" : "Add shared experience")
                : preferredExperienceMode === "experience-custom-offer"
                  ? (selectedServices.includes(service.id) ? "Edit tailored experience" : "Request tailored experience")
                  : (selectedServices.includes(service.id) ? "Edit private experience" : "Book private experience"),
            suggestedMode: preferredExperienceMode,
          });
        }
      }
    });

    return recommendations
      .sort((left, right) => right.score - left.score)
      .filter((recommendation, index, all) => index === all.findIndex((entry) => entry.key === recommendation.key))
      .slice(0, 6);
  }, [accommodation, availableConciergeServices, formatAmount, guestsValue, nights, selectedServices]);

  const hasBookingOverlap = (data: BookingFormValues) => {
    return availability?.blockedRanges.some((range) => {
      const selectedStart = new Date(`${data.checkIn}T00:00:00.000Z`).getTime();
      const selectedEnd = new Date(`${data.checkOut}T00:00:00.000Z`).getTime();
      const bookedStart = new Date(`${range.startDate}T00:00:00.000Z`).getTime();
      const bookedEnd = new Date(`${range.endDate}T00:00:00.000Z`).getTime();
      const effectiveSelectedEnd = selectedEnd === selectedStart ? selectedEnd : selectedEnd - 86400000;

      return selectedStart <= bookedEnd && effectiveSelectedEnd >= bookedStart;
    });
  };

  const canProceedToCheckout = (data: BookingFormValues) => {
    if (hasBookingOverlap(data)) {
      toast({
        title: "Stay unavailable",
        description: "Those dates are reserved. Please choose different dates.",
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const continueAfterLogin = (data: BookingFormValues) => {
    const payload = buildBookingSubmission(data);

    savePendingBookingDraft({
      kind: "stay",
      path: bookingPath,
      payload,
    });
    toast({
      title: "Continue after login",
      description: "Sign in or create an account and we will bring you back to finish saving this booking.",
    });
    setLocation(`/auth?next=${encodeURIComponent(bookingPath)}`);
  };

  const submitBooking = (data: BookingFormValues) => {
    if (!canProceedToCheckout(data)) {
      return;
    }

    if (!isAuthenticated) {
      continueAfterLogin(data);
      return;
    }

    createBookingMutation.mutate(buildBookingSubmission(data));
  };

  useEffect(() => {
    setHasRestoredPendingDraft(false);
  }, [bookingPath]);

  useEffect(() => {
    if (authLoading || !isAuthenticated || hasRestoredPendingDraft) {
      return;
    }

    const pendingDraft = loadPendingBookingDraft();
    if (!pendingDraft || pendingDraft.kind !== "stay" || !isPendingBookingPathMatch(pendingDraft.path, bookingPath)) {
      setHasRestoredPendingDraft(true);
      return;
    }

    const payload = pendingDraft.payload as Partial<BookingFormValues> & {
      selectedServices?: string[];
      stayServiceSelections?: StayServiceSelection[];
      totalPrice?: number;
      promoCode?: string | null;
    };
    const restoredSelectedServices = Array.isArray(payload.selectedServices) ? payload.selectedServices : [];
    const restoredSelections = Array.isArray(payload.stayServiceSelections) ? payload.stayServiceSelections : [];
    const restoredPromoCode = typeof payload.promoCode === "string" ? payload.promoCode : "";
    const restoredFormValues: BookingFormValues = {
      ...form.getValues(),
      accommodationId: id || "",
      guestName: typeof payload.guestName === "string" ? payload.guestName : form.getValues("guestName"),
      guestPhone: typeof payload.guestPhone === "string" ? payload.guestPhone : form.getValues("guestPhone"),
      checkIn: typeof payload.checkIn === "string" ? payload.checkIn : form.getValues("checkIn"),
      checkOut: typeof payload.checkOut === "string" ? payload.checkOut : form.getValues("checkOut"),
      guests: typeof payload.guests === "number" ? payload.guests : form.getValues("guests"),
      selectedServices: restoredSelectedServices,
      totalPrice: typeof payload.totalPrice === "number" ? payload.totalPrice : 0,
      status: "upcoming",
    };

    form.reset(restoredFormValues);
    setSelectedServices(restoredSelectedServices);
    setStayServiceSelections(restoredSelections);
    setPromoCode(restoredPromoCode);
    clearPendingBookingDraft();
    setHasRestoredPendingDraft(true);

    toast({
      title: "Booking restored",
      description: "We brought back your saved booking details. Review them and submit when you're ready.",
    });
  }, [authLoading, bookingPath, form, hasRestoredPendingDraft, id, isAuthenticated, toast]);

  if (!accommodation) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">Loading...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen pb-24 pt-6 sm:pb-10 sm:pt-8 lg:pb-12">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <Card className="surface-soft-card min-w-0 overflow-hidden border">
            <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
              <div className="aspect-[16/11] overflow-hidden bg-muted/55 sm:aspect-[16/9] lg:aspect-auto lg:h-full">
                <img
                  src={accommodation.imageUrl || "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=1200"}
                  alt={accommodation.title}
                  className="h-full w-full object-cover"
                />
              </div>

              <div className="space-y-5 p-5 sm:p-6 lg:p-7">
                <Badge variant="outline" className="surface-badge w-fit rounded-full border text-muted-foreground">
                  Stay Booking
                </Badge>

                <div className="space-y-2">
                  <h1 className="font-serif text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
                    Complete your stay booking
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                    Choose your dates, confirm guest details, and add only the extras that actually fit this trip.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="text-xl font-semibold text-foreground sm:text-2xl">{accommodation.title}</div>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      {accommodation.location}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <BedDouble className="h-4 w-4" />
                      {accommodation.bedrooms} bedroom{accommodation.bedrooms === 1 ? "" : "s"}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Up to {accommodation.maxOccupancy} guests
                    </span>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="surface-subtle rounded-2xl border p-4">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">From</div>
                    <div className="mt-2 flex items-baseline gap-1 text-lg font-semibold text-foreground">
                      <CurrencyAmount amountUsd={accommodation.price} />
                      <span className="text-sm font-normal text-muted-foreground">/ night</span>
                    </div>
                  </div>

                  <div className="surface-subtle rounded-2xl border p-4">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Trip</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">
                      {nights > 0 ? `${nights} night${nights === 1 ? "" : "s"}` : "Select dates"}
                    </div>
                  </div>

                  <div className="surface-subtle rounded-2xl border p-4">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Extras</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">
                      {selectedSummaryServices.length > 0 ? `${selectedSummaryServices.length} added` : "None yet"}
                    </div>
                  </div>
                </div>

                {accommodation.features.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {accommodation.features.slice(0, 4).map((feature, index) => (
                      <Badge
                        key={`${accommodation.id}-${feature}-${index}`}
                        variant="outline"
                        className="surface-badge rounded-full border text-foreground/78"
                      >
                        {feature}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </Card>

          <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_22rem] lg:items-start">
            <div className="order-2 min-w-0 space-y-6 lg:order-1">
            <Form {...form}>
              <form id="stay-booking-form" onSubmit={form.handleSubmit(submitBooking)} className="space-y-6">
                <Card className="surface-soft-card min-w-0 overflow-hidden border">
                  <div className="border-b border-border/60 px-5 py-5 sm:px-6">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Step 1</div>
                    <h2 className="mt-2 text-xl font-semibold text-foreground sm:text-2xl">Guest details</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      We use these details to hold the stay and contact you about arrival.
                    </p>
                  </div>
                  <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
                    <FormField
                      control={form.control}
                      name="guestName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="John Doe"
                              {...field}
                              className="text-base sm:text-sm"
                              data-testid="input-guest-name"
                            />
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
                              placeholder="+1 (555) 123-4567"
                              {...field}
                              className="text-base sm:text-sm"
                              data-testid="input-guest-phone"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </Card>

                <Card className="surface-soft-card min-w-0 overflow-hidden border">
                  <div className="border-b border-border/60 px-5 py-5 sm:px-6">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Step 2</div>
                    <h2 className="mt-2 text-xl font-semibold text-foreground sm:text-2xl">Stay details</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Pick your dates and group size so we can price the stay and tailor the right extras.
                    </p>
                  </div>
                  <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6 sm:py-6 xl:grid-cols-3">
                    <FormField
                      control={form.control}
                      name="checkIn"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Check-in Date</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                type="date"
                                className="pl-10 text-base sm:text-sm"
                                {...field}
                                data-testid="input-booking-checkin"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="checkOut"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Check-out Date</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                type="date"
                                className="pl-10 text-base sm:text-sm"
                                {...field}
                                data-testid="input-booking-checkout"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="guests"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Number of Guests</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                type="number"
                                min="1"
                                max={accommodation.maxOccupancy}
                                className="pl-10 text-base sm:text-sm"
                                {...field}
                                onChange={(e) => {
                                  const value = e.target.value === "" ? 1 : parseInt(e.target.value, 10);
                                  field.onChange(Number.isNaN(value) ? 1 : value);
                                }}
                                data-testid="input-booking-guests"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </Card>

                <Card className="min-w-0 overflow-hidden border-none bg-[linear-gradient(135deg,rgba(15,23,42,0.99),rgba(20,34,56,0.97),rgba(15,74,87,0.9))] text-white shadow-[0_22px_65px_rgba(15,23,42,0.42)]">
                  <div className="p-5 sm:p-6 lg:p-7">
                    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                      <div className="max-w-2xl">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-white/80">
                          <Compass className="h-3.5 w-3.5" />
                          Step 3
                        </div>
                        <h2 className="text-xl font-semibold text-white sm:text-2xl">Curated for your stay</h2>
                        <p className="mt-2 text-sm text-white/68">
                          Thoughtfully selected to match your stay, dates, and group size.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/15 bg-black/10 px-4 py-3 text-sm text-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                        {nights > 0 ? `${nights} night${nights === 1 ? "" : "s"}` : "Trip length pending"} - {guestsValue} guest{guestsValue === 1 ? "" : "s"}
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      {conciergeRecommendations.length > 0 ? conciergeRecommendations.map((recommendation) => {
                        const isSelected = selectedServices.includes(recommendation.serviceId);
                        const Icon = recommendation.category === "cars"
                          ? Car
                          : recommendation.category === "cooks"
                            ? ChefHat
                            : recommendation.category === "errands"
                              ? ShoppingBag
                              : Compass;

                        return (
                          <div
                            key={recommendation.key}
                            className="min-w-0 rounded-3xl border border-white/14 bg-[rgba(255,255,255,0.07)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm"
                          >
                            <div className="mb-4 flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                <div className="mt-0.5 rounded-2xl bg-black/15 p-3 ring-1 ring-white/10">
                                  <Icon className="h-5 w-5" />
                                </div>
                                <div className="min-w-0">
                                  <div className="mb-2 flex flex-wrap gap-2">
                                    <Badge variant="secondary" className="border-0 bg-white/12 text-white hover:bg-white/12">
                                      {recommendation.stage}
                                    </Badge>
                                    {recommendation.category === "cars" && recommendation.title.toLowerCase().includes("hourly") ? (
                                      <Badge variant="secondary" className="border-0 bg-white/12 text-white hover:bg-white/12">
                                        <Clock className="mr-1 h-3 w-3" />
                                        Hourly
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <h3 className="text-lg font-semibold text-white">{recommendation.title}</h3>
                                  <div className="text-sm text-white/74">{recommendation.priceLabel}</div>
                                </div>
                              </div>
                            </div>

                            <div className="mb-4 border-t border-white/10 pt-4">
                              <p className="text-sm leading-6 text-white/66">{recommendation.summary}</p>
                            </div>

                            <div className="mb-4 flex flex-wrap gap-2">
                              {recommendation.reasons.map((reason) => (
                                <span key={reason} className="rounded-full border border-white/14 bg-black/15 px-3 py-1 text-xs text-white/80">
                                  {reason}
                                </span>
                              ))}
                            </div>

                            <Button
                              type="button"
                              variant={isSelected ? "secondary" : "default"}
                              className={isSelected
                                ? "w-full border border-white/18 bg-white/10 text-white hover:bg-white/16"
                                : "w-full bg-primary text-primary-foreground shadow-[0_12px_24px_rgba(13,148,136,0.24)] hover:bg-primary/90"}
                              onClick={() => openSelectionDialog(recommendation.serviceId, recommendation.suggestedMode)}
                            >
                              {recommendation.actionLabel}
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </div>
                        );
                      }) : (
                        <div className="rounded-3xl border border-white/12 bg-[rgba(255,255,255,0.07)] p-5 text-sm text-white/72">
                          Set your dates and group size to unlock sharper stay-aware recommendations.
                        </div>
                      )}
                    </div>
                  </div>
                </Card>

                <Card className="surface-soft-card min-w-0 overflow-hidden border">
                  <Collapsible open={isBrowseAllAddonsOpen} onOpenChange={setIsBrowseAllAddonsOpen}>
                    <div className="rounded-3xl border border-border/70 bg-background/36 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-4 p-5 text-left sm:p-6"
                          data-testid="browse-all-stay-addons"
                        >
                          <div className="min-w-0">
                            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Step 4</div>
                            <h2 className="mt-2 text-xl font-semibold text-foreground sm:text-2xl">Browse all stay add-ons</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                              Optional: explore every ranked stay add-on beyond the tailored picks.
                            </p>
                          </div>
                          <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${isBrowseAllAddonsOpen ? "rotate-180" : ""}`} />
                        </button>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <div className="space-y-4 border-t border-border/60 p-5">
                          {rankedAddonServices.length > 0 ? rankedAddonServiceSections.map((section) => {
                            const SectionIcon = section.icon;
                            const isOpen = expandedAddonSections[section.key];

                            return (
                              <Collapsible
                                key={section.key}
                                open={isOpen}
                                onOpenChange={(open) => setExpandedAddonSections((current) => ({ ...current, [section.key]: open }))}
                              >
                                <div className="rounded-2xl border border-border/70 bg-card/72">
                                  <CollapsibleTrigger asChild>
                                    <button
                                      type="button"
                                      className="flex w-full items-center justify-between gap-4 p-4 text-left"
                                      data-testid={`addon-section-${section.key}`}
                                    >
                                      <div className="flex min-w-0 items-center gap-3">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/72">
                                          <SectionIcon className="h-5 w-5 text-foreground/80" />
                                        </div>
                                        <div className="min-w-0">
                                          <div className="font-semibold text-foreground">{section.label}</div>
                                          <div className="text-sm text-muted-foreground">
                                            {section.description} {section.items.length > 0 ? `(${section.items.length})` : "(0)"}
                                          </div>
                                        </div>
                                      </div>
                                      <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                                    </button>
                                  </CollapsibleTrigger>

                                  <CollapsibleContent>
                                    <div className="space-y-4 border-t border-border/60 p-4">
                                      {section.items.length > 0 ? section.items.map(({ service, reasons }) => {
                                        const Icon = service.category === "cars"
                                          ? Car
                                          : service.category === "cooks"
                                            ? ChefHat
                                            : ShoppingBag;
                                        const isSelected = selectedServices.includes(service.id);
                                        const existingSelection = getExistingSelection(service.id);
                                        const supportedModes = getSupportedModes(service);

                                        return (
                                          <div
                                            key={service.id}
                                            className={`rounded-2xl border p-4 transition-colors ${
                                              isSelected ? "border-primary/35 bg-primary/10" : "border-border/70 bg-background/42"
                                            }`}
                                            data-testid={`service-${service.id}`}
                                          >
                                            <div className="flex items-start gap-4">
                                              <Checkbox
                                                checked={isSelected}
                                                onCheckedChange={() => {
                                                  if (isSelected) {
                                                    removeSelectedService(service.id);
                                                    return;
                                                  }

                                                  openSelectionDialog(service.id);
                                                }}
                                                data-testid={`checkbox-service-${service.id}`}
                                              />
                                              <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-start justify-between gap-3">
                                                  <div className="flex min-w-0 items-center gap-3">
                                                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${isSelected ? "bg-primary/14" : "bg-muted/70"}`}>
                                                      <Icon className={`h-5 w-5 ${isSelected ? "text-primary" : "text-foreground/78"}`} />
                                                    </div>
                                                    <div className="min-w-0">
                                                      <div className="font-semibold text-foreground">{getServiceTitle(service)}</div>
                                                      <div className="text-sm text-muted-foreground">{getServicePriceLabel(service)}</div>
                                                    </div>
                                                  </div>
                                                  <Badge variant="secondary" className="border-0 bg-muted/78 capitalize text-foreground/74">
                                                    {service.category === "cooks" ? "Chef" : service.category === "cars" ? "Drive" : "Support"}
                                                  </Badge>
                                                </div>

                                                <p className="mt-3 border-t border-border/60 pt-3 text-sm text-muted-foreground line-clamp-2">
                                                  {service.description}
                                                </p>

                                                <div className="mt-3 flex flex-wrap gap-2">
                                                  {reasons.map((reason) => (
                                                    <span key={reason} className="rounded-full border border-border/60 bg-muted/52 px-3 py-1 text-xs text-muted-foreground">
                                                      {reason}
                                                    </span>
                                                  ))}
                                                </div>

                                                {service.features.length > 0 ? (
                                                  <div className="mt-3 flex flex-wrap gap-1">
                                                    {service.features.slice(0, 3).map((feature, index) => (
                                                      <Badge key={`${service.id}-${feature}-${index}`} variant="outline" className="text-xs">
                                                        {feature}
                                                      </Badge>
                                                    ))}
                                                  </div>
                                                ) : null}

                                                <div className="mt-3 flex flex-wrap gap-2">
                                                  {supportedModes.map((mode) => (
                                                    <Badge
                                                      key={`${service.id}-${mode}`}
                                                      variant="outline"
                                                      className={existingSelection?.serviceMode === mode ? "border-primary/40 bg-primary/10 text-primary" : "text-xs"}
                                                    >
                                                      {getServiceModeLabel(mode)}
                                                    </Badge>
                                                  ))}
                                                </div>

                                                {existingSelection ? (
                                                  <div className="mt-3 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-foreground">
                                                    Selected offer: {getServiceModeLabel(existingSelection.serviceMode)}
                                                  </div>
                                                ) : (
                                                  <p className="mt-3 text-sm text-muted-foreground">
                                                    Choose this add-on to pick the exact offer that fits this stay.
                                                  </p>
                                                )}

                                                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                                                  <Button
                                                    type="button"
                                                    className="sm:flex-1"
                                                    onClick={() => openSelectionDialog(service.id)}
                                                    data-testid={`button-service-offer-${service.id}`}
                                                  >
                                                    {isSelected ? "Edit selected offer" : "Choose offer"}
                                                  </Button>
                                                  {isSelected ? (
                                                    <Button
                                                      type="button"
                                                      variant="outline"
                                                      className="sm:w-auto"
                                                      onClick={() => removeSelectedService(service.id)}
                                                      data-testid={`button-remove-service-${service.id}`}
                                                    >
                                                      Remove
                                                    </Button>
                                                  ) : null}
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      }) : (
                                        <p className="text-sm text-muted-foreground">
                                          No {section.label.toLowerCase()} add-ons are available right now.
                                        </p>
                                      )}
                                    </div>
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                            );
                          }) : (
                            <p className="text-sm text-muted-foreground text-center py-4">
                              No partner-backed stay add-ons are available at the moment.
                            </p>
                          )}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                </Card>

              </form>
            </Form>
          </div>

          <div className="order-1 min-w-0 lg:order-2 lg:sticky lg:top-24">
            <Card className="surface-soft-card min-w-0 overflow-hidden border">
              <div className="border-b border-border/60 px-5 py-5 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Your trip</div>
                    <h2 className="mt-2 text-xl font-semibold text-foreground">Booking summary</h2>
                  </div>
                  <Badge variant="outline" className="surface-badge rounded-full border text-muted-foreground">
                    {selectedSummaryServices.length > 0 ? `${selectedSummaryServices.length} add-on${selectedSummaryServices.length === 1 ? "" : "s"}` : "Stay only"}
                  </Badge>
                </div>
              </div>

              <div className="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
                <div className="hidden rounded-2xl border border-border/70 bg-background/90 p-4 shadow-sm lg:block">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Ready to lock it in?</div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Secure payment stays ready in My Bookings, and if checkout pauses, we keep your dates and details safe.
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {promoPreview ? (
                        <div className="text-sm font-normal text-muted-foreground line-through">
                          <CurrencyAmount amountUsd={totalPrice} />
                        </div>
                      ) : null}
                      <CurrencyAmount amountUsd={discountedTotalPrice} data-testid="text-total-price-desktop-cta" />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    form="stay-booking-form"
                    size="lg"
                    className="mt-4 relative min-h-12 w-full overflow-hidden px-8 py-3.5 shadow-[0_14px_34px_rgba(8,145,178,0.24)] before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-white/45 before:content-['']"
                    disabled={createBookingMutation.isPending}
                    data-testid="button-complete-booking"
                  >
                    Book
                  </Button>
                </div>

                <div className="overflow-hidden rounded-3xl border border-border/70 bg-background/40">
                  <div className="aspect-[16/10] overflow-hidden">
                    <img
                      src={accommodation.imageUrl || "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800"}
                      alt={accommodation.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="space-y-4 p-4">
                    <div>
                      <div className="font-semibold text-foreground">{accommodation.title}</div>
                      <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        <span className="break-words">{accommodation.location}</span>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="surface-subtle rounded-2xl border p-3">
                        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">From</div>
                        <div className="mt-2 flex items-baseline gap-1 font-semibold text-foreground">
                          <CurrencyAmount amountUsd={accommodation.price} />
                          <span className="text-xs font-normal text-muted-foreground">/ night</span>
                        </div>
                      </div>

                      <div className="surface-subtle rounded-2xl border p-3">
                        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Guests</div>
                        <div className="mt-2 font-semibold text-foreground">
                          {nights > 0 ? guestsValue : `Up to ${accommodation.maxOccupancy}`}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="surface-subtle rounded-2xl border p-4 text-sm">
                  <div className="mb-2 flex justify-between gap-3">
                    <span className="text-muted-foreground">Trip length</span>
                    <span className="font-medium text-foreground">
                      {nights > 0 ? `${nights} night${nights === 1 ? "" : "s"}` : "Select dates"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Guests</span>
                    <span className="font-medium text-foreground">{guestsValue}</span>
                  </div>
                </div>

                <div className="surface-subtle rounded-2xl border p-4">
                  <Label htmlFor="stay-promo-code" className="text-sm font-medium">
                    Promo code
                  </Label>
                  <Input
                    id="stay-promo-code"
                    value={promoCode}
                    onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
                    placeholder="APRIL-BUNDLE"
                    className="mt-2 text-base sm:text-sm"
                  />
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">
                    {promoPreviewQuery.isFetching
                      ? "Checking the best available offer for this stay..."
                      : promoPreview
                        ? promoPreview.appliedAutomatically
                          ? `${promoPreview.promoName} is applying automatically.`
                          : `${promoPreview.promoName} is ready for this booking.`
                        : promoRejectionReason
                          ? promoRejectionReason
                          : "Bundle offers can apply automatically when this trip qualifies."}
                  </div>
                  {promoPreview ? (
                    <div className="mt-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-emerald-700">Promo applied</div>
                          <div className="mt-1 text-sm font-semibold text-emerald-950">
                            {promoPreview.bundleLabel || promoPreview.promoName}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-emerald-800">
                            {promoPreview.promoCode
                              ? `Code ${promoPreview.promoCode} is applied to this stay.`
                              : "This offer is applying automatically to this stay."}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-emerald-700">You save</div>
                          <div className="mt-1 text-sm font-semibold text-emerald-950">
                            <CurrencyAmount amountUsd={promoSavings} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

              </div>

              <div className="space-y-5 px-5 pb-5 sm:px-6 sm:pb-6">
                <div className="mb-3 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Price breakdown</div>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Accommodation</span>
                    <CurrencyAmount amountUsd={accommodationTotal} />
                  </div>

                  {selectedSummaryServices.length > 0 ? selectedSummaryServices.map((service) => (
                    <div key={service.id} className="flex justify-between gap-3">
                      <span className="break-words text-muted-foreground">
                        {service.category === "experiences" ? service.title : getServiceTitle(service)}
                      </span>
                      <span className="shrink-0">
                        <CurrencyAmount amountUsd={service.category === "experiences"
                          ? (getExistingSelection(service.id)?.serviceMode === "experience-custom-offer"
                              ? 0
                              : ((getExistingSelection(service.id)?.serviceMode === "experience-shared" ? service.sharedPricePerPerson || service.price : service.privatePricePerPerson || service.price) * (getExistingSelection(service.id)?.guests || guestsValue)))
                          : calculateServiceTotal(service, nights)} />
                      </span>
                    </div>
                  )) : (
                    <div className="text-sm text-muted-foreground">No stay extras added yet.</div>
                  )}

                  {promoPreview ? (
                    <div className="flex justify-between gap-3 text-emerald-700">
                      <span className="break-words">{promoPreview.bundleLabel || promoPreview.promoName}</span>
                      <span className="shrink-0">-<CurrencyAmount amountUsd={promoSavings} /></span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-5 border-t border-border/60 px-5 py-5 sm:px-6 sm:py-6">
                <div className="flex justify-between gap-3 text-lg font-semibold">
                  <span>Total</span>
                  <div className="text-right">
                    {promoPreview ? (
                      <div className="text-sm font-normal text-muted-foreground line-through">
                        <CurrencyAmount amountUsd={totalPrice} />
                      </div>
                    ) : null}
                    <CurrencyAmount amountUsd={discountedTotalPrice} data-testid="text-total-price" />
                  </div>
                </div>

                <CheckoutPaymentPreview
                  title={bookingCheckoutPreviewCopy.title}
                  description={bookingCheckoutPreviewCopy.description}
                />

                <div className="surface-subtle rounded-2xl border p-4 text-sm text-muted-foreground">
                  <div className="mb-3 flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                    <span>
                      Clear pricing, verified local providers, and support if your plans need to change.
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-primary" />
                      <span>Free cancellation up to 48 hours</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-primary" />
                      <span>24/7 customer support</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-primary" />
                      <span>Verified local providers</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/92 px-4 py-3 shadow-[0_-18px_40px_rgba(15,23,42,0.16)] backdrop-blur lg:hidden">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {nights > 0 ? "Total" : "From"}
            </div>
            <div className="mt-1 text-base font-semibold text-foreground">
              {nights > 0 ? <CurrencyAmount amountUsd={discountedTotalPrice} /> : <CurrencyAmount amountUsd={accommodation.price} />}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {nights > 0
                ? `${nights} night${nights === 1 ? "" : "s"} - ${selectedSummaryServices.length} add-on${selectedSummaryServices.length === 1 ? "" : "s"}`
                : "Choose dates to lock your total"}
            </div>
          </div>

          <Button
            type="submit"
            form="stay-booking-form"
            className="min-h-11 shrink-0 px-5"
            disabled={createBookingMutation.isPending}
          >
            Book
          </Button>
        </div>
      </div>
      <Dialog open={!!configuringServiceId && !!configuringService && !!draftSelection} onOpenChange={(open) => {
        if (!open) {
          setConfiguringServiceId(null);
          setDraftSelection(null);
        }
      }}>
        <DialogContent className="max-h-[95vh] w-[calc(100vw-1rem)] max-w-xl overflow-y-auto sm:w-full">
          <DialogHeader>
            <DialogTitle>
              {configuringService ? `Add ${"model" in configuringService ? configuringService.model : "title" in configuringService ? configuringService.title : "serviceName" in configuringService ? configuringService.serviceName : "service"} to this stay` : "Configure stay service"}
            </DialogTitle>
            <DialogDescription>
              Set the details once here and we will attach it directly to the stay booking.
            </DialogDescription>
          </DialogHeader>

          {configuringService && draftSelection ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Mode</Label>
                  <Select
                    value={draftSelection.serviceMode || ""}
                    onValueChange={(value) => setDraftSelection((current) => current ? {
                      ...current,
                      serviceMode: value,
                      serviceHours: value === "car-chauffeur-hourly" ? (current.serviceHours || current.units || 3) : value === "errand-house-cleaning" ? (current.serviceHours || 1) : null,
                      units: value === "car-chauffeur-hourly" ? (current.serviceHours || current.units || 3) : Math.max(1, current.units || 1),
                      serviceStartTime: value === "car-chauffeur-hourly" ? (current.serviceStartTime || "09:00") : current.serviceStartTime,
                      serviceDepartureId: value === "experience-shared" ? current.serviceDepartureId || "" : "",
                      serviceAddonSelections: value === "errand-childcare" ? current.serviceAddonSelections || [] : current.serviceAddonSelections,
                    } : current)}
                  >
                    <SelectTrigger className="text-base sm:text-sm">
                      <SelectValue placeholder="Choose mode" />
                    </SelectTrigger>
                      <SelectContent>
                        {configuringServiceModes.map((mode) => (
                          <SelectItem key={mode} value={mode}>
                            {getServiceModeLabel(mode)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                {(configuringService.category === "cars" || configuringService.category === "cooks" || configuringService.category === "errands") && draftSelection.serviceMode !== "car-chauffeur-hourly" ? (
                  <div className="space-y-2">
                    <Label>{configuringService.category === "cooks" ? "Sessions or service days" : configuringService.category === "cars" ? "Days needed" : draftSelection.serviceMode === "errand-house-cleaning" ? "Cleaning visits" : "Packages"}</Label>
                    <Input
                      type="number"
                      min="1"
                      value={draftSelection.units || 1}
                      className="text-base sm:text-sm"
                      onChange={(e) => setDraftSelection((current) => current ? { ...current, units: Math.max(1, Number(e.target.value) || 1) } : current)}
                    />
                  </div>
                ) : null}

                {draftSelection.serviceMode === "car-chauffeur-hourly" ? (
                  <div className="space-y-2">
                    <Label>Hours needed</Label>
                    <Input
                      type="number"
                      min="3"
                      value={draftSelection.serviceHours || draftSelection.units || 3}
                      className="text-base sm:text-sm"
                      onChange={(e) => setDraftSelection((current) => current ? {
                        ...current,
                        serviceHours: Math.max(3, Number(e.target.value) || 3),
                        units: Math.max(3, Number(e.target.value) || 3),
                      } : current)}
                    />
                  </div>
                ) : null}

                {draftSelection.serviceMode === "errand-house-cleaning" ? (
                  <div className="space-y-2">
                    <Label>Bedrooms / rooms to clean</Label>
                    <Input
                      type="number"
                      min="1"
                      value={draftSelection.serviceHours || 1}
                      className="text-base sm:text-sm"
                      onChange={(e) => setDraftSelection((current) => current ? {
                        ...current,
                        serviceHours: getHouseCleaningBedroomCount(Number(e.target.value) || 1),
                      } : current)}
                    />
                  </div>
                ) : null}

                {configuringService.category !== "errands" ? (
                  <div className="space-y-2">
                    <Label>Guests covered</Label>
                    <Input
                      type="number"
                      min="1"
                      value={draftSelection.guests || guestsValue}
                      className="text-base sm:text-sm"
                      onChange={(e) => setDraftSelection((current) => current ? { ...current, guests: Math.max(1, Number(e.target.value) || 1) } : current)}
                    />
                  </div>
                ) : null}

                {draftSelection.serviceMode === "errand-shopping" ? (
                  <div className="space-y-2">
                    <Label>Estimated receipt value</Label>
                    <Input
                      type="number"
                      min="1"
                      value={draftSelection.serviceBudgetAmount || 50}
                      className="text-base sm:text-sm"
                      onChange={(e) => setDraftSelection((current) => current ? { ...current, serviceBudgetAmount: Math.max(1, Number(e.target.value) || 1) } : current)}
                    />
                  </div>
                ) : null}

                {draftSelection.serviceMode === "experience-shared" ? (
                  <div className="space-y-2 md:col-span-2">
                    <Label>Shared departure</Label>
                    <Select
                      value={draftSelection.serviceDepartureId || ""}
                      onValueChange={(value) => setDraftSelection((current) => current ? { ...current, serviceDepartureId: value } : current)}
                    >
                      <SelectTrigger className="text-base sm:text-sm">
                        <SelectValue placeholder="Choose a departure" />
                      </SelectTrigger>
                      <SelectContent>
                        {sharedDepartures.map((departure) => (
                          <SelectItem key={departure.id} value={departure.id}>
                            {departure.date} at {departure.time} · {departure.spotsLeft} spots left
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>

              {configuringService.category === "cars" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Pickup location</Label>
                    <Input
                      value={draftSelection.servicePickupLocation || accommodation?.location || ""}
                      placeholder="Airport, SGR, hotel, or stay pickup point"
                      className="text-base sm:text-sm"
                      onChange={(e) => setDraftSelection((current) => current ? {
                        ...current,
                        servicePickupLocation: e.target.value,
                      } : current)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{draftSelection.serviceMode === "car-self-drive-day" ? "Return location" : "Drop-off location"}</Label>
                    <Input
                      value={draftSelection.serviceReturnLocation || draftSelection.servicePickupLocation || accommodation?.location || ""}
                      placeholder={draftSelection.serviceMode === "car-self-drive-day" ? "Where the car should be returned" : "Where the guest should be dropped off"}
                      className="text-base sm:text-sm"
                      onChange={(e) => setDraftSelection((current) => current ? {
                        ...current,
                        serviceReturnLocation: e.target.value,
                      } : current)}
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label>{draftSelection.serviceMode === "car-chauffeur-hourly" ? "Pickup time" : "Preferred start time"}</Label>
                    <Input
                      type="time"
                      value={draftSelection.serviceStartTime || ""}
                      className="text-base sm:text-sm"
                      onChange={(e) => setDraftSelection((current) => current ? {
                        ...current,
                        serviceStartTime: e.target.value,
                      } : current)}
                    />
                  </div>
                </div>
              ) : null}

              {configuringService.category === "cooks" ? (
                <>
                  <div className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">
                    {draftSelection.serviceMode === "cook-inclusive"
                      ? `This setup keeps ${configuringService.ingredientsIncluded ? "ingredients" : "meal ingredients"}${configuringService.shoppingIncluded ? " and shopping" : ""} inside the chef package.`
                      : "This option keeps the chef fee separate so you can handle ingredients and shopping your own way."}
                  </div>
                  <div className="space-y-2">
                    <Label>Service location</Label>
                    <Input
                      value={draftSelection.serviceLocation || accommodation?.location || ""}
                      placeholder="Villa, apartment, or kitchen where the chef should come"
                      className="text-base sm:text-sm"
                      onChange={(e) => setDraftSelection((current) => current ? {
                        ...current,
                        serviceLocation: e.target.value,
                      } : current)}
                    />
                  </div>
                </>
              ) : null}

              {configuringService.category === "errands" ? (
                <div className="space-y-2">
                  <Label>Service location</Label>
                  <Input
                    value={draftSelection.serviceLocation || accommodation?.location || ""}
                    placeholder="Pickup, delivery, or service address"
                    className="text-base sm:text-sm"
                    onChange={(e) => setDraftSelection((current) => current ? {
                      ...current,
                      serviceLocation: e.target.value,
                    } : current)}
                  />
                </div>
              ) : null}

              {configuringErrandAddons.length > 0 ? (
                <div className="space-y-3">
                  <Label>{draftSelection.serviceMode === "errand-laundry" ? "Laundry add-ons" : "Cleaning add-ons"}</Label>
                  <div className="space-y-2">
                    {configuringErrandAddons.map((addon) => {
                      const selectedAddons = draftSelection.serviceAddonSelections || [];
                      const isChecked = selectedAddons.includes(addon.id);
                      return (
                        <label key={addon.id} className="flex items-center justify-between rounded-2xl border px-4 py-3">
                          <div>
                            <div className="font-medium text-foreground">{addon.name}</div>
                            <div className="text-sm text-muted-foreground">{formatAmount(addon.price)}</div>
                          </div>
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(checked) => setDraftSelection((current) => {
                              if (!current) return current;
                              const addonSelections = current.serviceAddonSelections || [];
                              return {
                                ...current,
                                serviceAddonSelections: checked
                                  ? [...addonSelections, addon.id]
                                  : addonSelections.filter((item) => item !== addon.id),
                              };
                            })}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {configuringService.category === "errands" && draftSelection.serviceMode === "errand-childcare" && hasHelpMamaPricing(configuringService) ? (
                <div className="space-y-4">
                  <Label>Help Mama pricing</Label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(() => {
                      const selectedAgeBandId = getHelpMamaAgeBandId(draftSelection.serviceAddonSelections, configuringService.helpMamaPricing);
                      return getHelpMamaRateOptions(configuringService.helpMamaPricing, selectedAgeBandId).map((rate) => {
                        const selectedRateId = getHelpMamaRateId(draftSelection.serviceAddonSelections);
                      return (
                        <label key={rate.id} className="flex items-start gap-3 rounded-2xl border px-4 py-3">
                          <Checkbox
                            checked={selectedRateId === rate.id}
                            onCheckedChange={() => setDraftSelection((current) => {
                              if (!current) return current;
                              const ageBands = normalizeHelpMamaPricing(configuringService.helpMamaPricing).ageBands;
                              const ageSelections = (current.serviceAddonSelections || []).filter((selection) => ageBands.some((band) => band.id === selection));
                              return {
                                ...current,
                                serviceAddonSelections: [...ageSelections, rate.id],
                                serviceHours: isHelpMamaHourlyRate(rate.id) ? current.serviceHours || 1 : null,
                              };
                            })}
                          />
                          <div>
                            <div className="font-medium text-foreground">{rate.label}</div>
                            <div className="text-sm text-muted-foreground">{formatAmount(rate.price)}/{rate.unit}</div>
                          </div>
                        </label>
                      );
                      });
                    })()}
                  </div>

                  {isHelpMamaHourlyRate(getHelpMamaRateId(draftSelection.serviceAddonSelections)) ? (
                    <div className="space-y-2">
                      <Label>Hours needed</Label>
                      <Input
                        type="number"
                        min="1"
                        value={draftSelection.serviceHours || 1}
                        className="text-base sm:text-sm"
                        onChange={(e) => setDraftSelection((current) => current ? {
                          ...current,
                          serviceHours: Math.max(1, Number(e.target.value) || 1),
                        } : current)}
                      />
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <Label>Age band</Label>
                    {normalizeHelpMamaPricing(configuringService.helpMamaPricing).ageBands.map((band) => {
                      const selectedAddons = draftSelection.serviceAddonSelections || [];
                      const checked = selectedAddons.includes(band.id);
                      return (
                        <label key={band.id} className="flex items-center justify-between rounded-2xl border px-4 py-3">
                          <div>
                            <div className="font-medium text-foreground">{band.label}</div>
                          </div>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(nextChecked) => setDraftSelection((current) => {
                              if (!current) return current;
                              const addonSelections = current.serviceAddonSelections || [];
                              return {
                                ...current,
                                serviceAddonSelections: nextChecked
                                  ? [...addonSelections, band.id]
                                  : addonSelections.filter((item) => item !== band.id),
                              };
                            })}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  rows={4}
                  placeholder={
                    configuringService.category === "cars"
                      ? "Add flight timing, route notes, child seats, luggage needs, or driver instructions."
                      : configuringService.category === "cooks"
                        ? "Add cuisine style, dietary needs, preferred meals, and any ingredient or shopping preferences."
                        : configuringService.category === "errands"
                          ? (draftSelection.serviceMode === "errand-shopping"
                              ? "List the shopping items, quantities, brands, and delivery notes."
                              : draftSelection.serviceMode === "errand-childcare"
                                ? "Share child ages, feeding or diaper needs, clinic visit details, supervision times, allergies, and safety notes."
                              : "Add laundry, cleaning, pickup, or delivery instructions here.")
                          : "Add timing, preferences, celebration details, or special requests here."
                  }
                  value={draftSelection.serviceRequestDetails || ""}
                  className="text-base sm:text-sm"
                  onChange={(e) => setDraftSelection((current) => current ? { ...current, serviceRequestDetails: e.target.value } : current)}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => {
              setConfiguringServiceId(null);
              setDraftSelection(null);
            }}>
              Cancel
            </Button>
            <Button type="button" className="w-full sm:w-auto" onClick={saveDraftSelection}>
              Save to stay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
