import { useState, useMemo, useEffect } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Baby, CheckCircle2, Car, ChefHat, ShoppingBag, Compass, ChevronDown, MapPin, MessageCircle, Minus, Plus, Sparkles } from "lucide-react";
import { AskZainaLink } from "@/components/ask-zaina-link";
import { openZaina } from "@/lib/zaina";
import { DateRangePicker, describeTripRange } from "@/components/date-range-picker";
import { StayRefundNote } from "@/components/stay-refund-note";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  StayWithRooms,
  Car as CarType,
  Cook as CookType,
  Errand as ErrandType,
  Experience as ExperienceType,
  MarketingAttributionPayload,
  MarketingPromoPreviewResult,
  StayServiceSelection,
} from "@shared/schema";
import { insertBookingSchema } from "@shared/schema";
import { bookingDepositPercent, calculateBookingDepositAmount } from "@shared/booking-payments";
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
import { HotelRoomPicker } from "@/components/hotel-room-picker";
import {
  describeHotelStay,
  getRoomsNeeded,
  isBookableRoomType,
  isHotelStay,
  quoteHotelRooms,
  sortRoomRates,
} from "@shared/hotel-rooms";

type StayAvailability = {
  blockedRanges: Array<{
    id: string;
    source: "booking" | "manual" | "sold-out";
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

type RankedAddonService = {
  service: AddonService;
  score: number;
  reasons: string[];
};

type TripExtraKey = "pickup" | "chef" | "shopping" | "nanny" | "home" | "dayOut";

type TripExtraGroup = {
  key: TripExtraKey;
  title: string;
  description: string;
  icon: typeof Car;
  homeOnly: boolean;
  items: ConciergeService[];
};

// What guests ask TBM to arrange, in their words. A stay's page can ask for
// any of these with ?add=pickup,chef and checkout opens with them first.
const tripExtraGroupDefs: Array<Omit<TripExtraGroup, "items">> = [
  { key: "pickup", title: "Airport or SGR pickup, or a car", description: "A driver for your arrival, by the hour or the day, or a car to drive yourself.", icon: Car, homeOnly: false },
  { key: "chef", title: "A private chef", description: "Cooks at your stay, with or without the shopping.", icon: ChefHat, homeOnly: true },
  { key: "shopping", title: "Shopping before you arrive", description: "Groceries and essentials waiting when you get there.", icon: ShoppingBag, homeOnly: true },
  { key: "nanny", title: "A nanny", description: "Help with the children, by the hour, the night or the day.", icon: Baby, homeOnly: true },
  { key: "home", title: "Cleaning and laundry", description: "A clean during your stay, or laundry picked up and brought back.", icon: Sparkles, homeOnly: true },
  { key: "dayOut", title: "A day out", description: "Tours and days out along the Coast, booked with your stay.", icon: Compass, homeOnly: false },
];

function preferredExperienceMode(service: ExperienceConciergeService, guests: number) {
  if (guests <= 3 && service.privateEnabled) return "experience-private";
  if (service.sharedEnabled) return "experience-shared";
  if (service.privateEnabled) return "experience-private";
  if (service.customQuoteEnabled) return "experience-custom-offer";
  return null;
}

/** The booking mode an extra starts in, for the group it is added from. */
function suggestedModeFor(groupKey: TripExtraKey, service: ConciergeService, guests: number) {
  if (service.category === "cars") return service.priceWithDriverHourly ? "car-chauffeur-hourly" : "car-chauffeur-day";
  if (service.category === "cooks") return "cook-service-fee";
  if (service.category === "experiences") return preferredExperienceMode(service, guests) ?? undefined;
  if (groupKey === "shopping") return "errand-shopping";
  if (groupKey === "nanny") return "errand-childcare";
  return service.houseCleaningEnabled ? "errand-house-cleaning" : "errand-laundry";
}

/** The group a chosen extra shows in: the one it was added from. */
function groupForSelection(selection: StayServiceSelection): TripExtraKey {
  if (selection.category === "cars") return "pickup";
  if (selection.category === "cooks") return "chef";
  if (selection.category === "experiences") return "dayOut";
  if (selection.serviceMode === "errand-shopping") return "shopping";
  if (selection.serviceMode === "errand-childcare") return "nanny";
  return "home";
}

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

  const { data: accommodation } = useQuery<StayWithRooms>({
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
      // A hotel room and meal plan chosen on the hotel's page.
      roomTypeId: new URLSearchParams(search).get("room") || null,
      mealPlan: (new URLSearchParams(search).get("plan") || null) as BookingFormValues["mealPlan"],
      roomCount: null,
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
  const offersHomeServices = !isHotelStay(accommodation);
  const availableConciergeServices = useMemo(
    () => conciergeServices.filter((service) => !unavailableConciergeServiceIds.has(service.id)
      // Chefs and home errands are for entire places: at a hotel, meals come with its meal plan.
      && (offersHomeServices || service.category === "cars" || service.category === "experiences")),
    [conciergeServices, offersHomeServices, unavailableConciergeServiceIds],
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

  // A hotel: the room, meal plan and number of rooms, priced as the server prices them.
  const isHotel = isHotelStay(accommodation);
  const hotelRoomTypes = useMemo(
    () => (accommodation?.roomTypes ?? []).filter(isBookableRoomType).map((roomType) => ({ ...roomType, rates: sortRoomRates(roomType.rates) })),
    [accommodation?.roomTypes],
  );
  const roomTypeIdValue = useWatch({ control: form.control, name: "roomTypeId" });
  const mealPlanValue = useWatch({ control: form.control, name: "mealPlan" });
  const roomCountValue = useWatch({ control: form.control, name: "roomCount" });
  const selectedRoomType = useMemo(
    () => hotelRoomTypes.find((roomType) => roomType.id === roomTypeIdValue) ?? null,
    [hotelRoomTypes, roomTypeIdValue],
  );
  const { data: roomAvailability } = useQuery<{ rooms: Array<{ roomTypeId: string; roomsLeft: number }> }>({
    queryKey: ["/api/stays", id, "rooms", checkInValue, checkOutValue],
    enabled: Boolean(id && isHotel && checkInValue && checkOutValue && checkOutValue >= checkInValue),
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const params = new URLSearchParams({ checkIn: checkInValue, checkOut: checkOutValue });
      const response = await fetch(`/api/stays/${id}/rooms?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch room availability");
      return response.json();
    },
  });
  const hotelRoomsLeft = useMemo(
    () => (roomAvailability ? new Map(roomAvailability.rooms.map((room) => [room.roomTypeId, room.roomsLeft])) : undefined),
    [roomAvailability],
  );
  const hotelQuote = useMemo(() => {
    if (!isHotel || !selectedRoomType) return null;
    return quoteHotelRooms({
      roomType: selectedRoomType,
      mealPlan: mealPlanValue,
      rooms: roomCountValue ?? 1,
      guests: Number(guestsValue) || 0,
      nights: Math.max(1, nights),
    });
  }, [guestsValue, isHotel, mealPlanValue, nights, roomCountValue, selectedRoomType]);

  // Start on the room chosen on the hotel's page (or its first room and plan),
  // with enough rooms for the guests.
  useEffect(() => {
    if (!isHotel || hotelRoomTypes.length === 0) return;
    const roomType = selectedRoomType ?? hotelRoomTypes[0];
    if (!selectedRoomType) {
      form.setValue("roomTypeId", roomType.id);
    }
    if (!roomType.rates.some((rate) => rate.mealPlan === form.getValues("mealPlan"))) {
      form.setValue("mealPlan", roomType.rates[0]?.mealPlan ?? null);
    }
  }, [form, hotelRoomTypes, isHotel, selectedRoomType]);

  useEffect(() => {
    if (!isHotel || !selectedRoomType) return;
    const guests = Math.max(1, Number(guestsValue) || 1);
    const current = form.getValues("roomCount") ?? 0;
    const next = Math.max(1, Math.min(Math.max(current, getRoomsNeeded(guests, selectedRoomType.maxGuests)), guests, selectedRoomType.roomCount));
    if (next !== current) {
      form.setValue("roomCount", next);
    }
  }, [form, guestsValue, isHotel, selectedRoomType]);

  const accommodationTotal = useMemo(
    () => (isHotel
      ? (hotelQuote?.ok && nights > 0 ? hotelQuote.snapshot.accommodationTotal : 0)
      : (accommodation?.price || 0) * nights),
    [accommodation?.price, hotelQuote, isHotel, nights],
  );
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
  // ─── The trip plan: extras grouped the way guests ask for them ───
  const requestedExtras = useMemo(
    () => new Set((new URLSearchParams(search).get("add") || "").split(",").map((value) => value.trim()).filter(Boolean)),
    [search],
  );
  const [openExtraGroups, setOpenExtraGroups] = useState<Partial<Record<TripExtraKey, boolean>>>({});
  const [showBarDetails, setShowBarDetails] = useState(false);
  const addonScores = useMemo(
    () => new Map(rankedAddonServices.map(({ service, score }) => [service.id, score])),
    [rankedAddonServices],
  );
  const tripExtraGroups = useMemo<TripExtraGroup[]>(() => {
    const byScore = (items: ConciergeService[]) =>
      [...items].sort((left, right) => (addonScores.get(right.id) ?? 0) - (addonScores.get(left.id) ?? 0));
    const errands = availableConciergeServices.filter((service): service is ErrandAddonService => service.category === "errands");
    const itemsFor: Record<TripExtraKey, ConciergeService[]> = {
      pickup: availableConciergeServices.filter((service) => service.category === "cars"),
      // A chef who can't cook for this many guests is left out (see the ranking).
      chef: availableConciergeServices.filter((service) => service.category === "cooks" && addonScores.has(service.id)),
      shopping: errands.filter((service) => service.shoppingEnabled),
      nanny: errands.filter((service) => supportsChildcareErrand(service)),
      home: errands.filter((service) => service.houseCleaningEnabled || service.laundryEnabled),
      dayOut: availableConciergeServices.filter((service) => service.category === "experiences"
        && service.maxGuests >= guestsValue && preferredExperienceMode(service, guestsValue) !== null),
    };
    return tripExtraGroupDefs
      .filter((group) => offersHomeServices || !group.homeOnly)
      .map((group) => ({ ...group, items: byScore(itemsFor[group.key]) }))
      .sort((left, right) => Number(requestedExtras.has(right.key)) - Number(requestedExtras.has(left.key)));
  }, [addonScores, availableConciergeServices, guestsValue, offersHomeServices, requestedExtras]);

  const extraName = (service: ConciergeService) => (service.category === "experiences" ? service.title : getServiceTitle(service));

  const extraPriceLabel = (groupKey: TripExtraKey, service: ConciergeService): string => {
    if (service.category === "cars") {
      if (service.priceWithDriverHourly) return `${formatAmount(service.priceWithDriverHourly)} an hour with a driver`;
      if (service.priceWithDriver) return `${formatAmount(service.priceWithDriver)} a day with a driver`;
      return `${formatAmount(service.pricePerDay ?? 0)} a day, self-drive`;
    }
    if (service.category === "cooks") {
      return `${formatAmount(getCookServiceFee(service))} a day for up to ${getCookMinimumGuests(service)} guests`;
    }
    if (service.category === "experiences") {
      const mode = preferredExperienceMode(service, guestsValue);
      if (mode === "experience-custom-offer") return "Priced for your group";
      const price = mode === "experience-shared" ? service.sharedPricePerPerson || service.price : service.privatePricePerPerson || service.price;
      return `${formatAmount(price)} a person`;
    }
    if (groupKey === "nanny" && hasHelpMamaPricing(service)) {
      const cheapest = getHelpMamaRateOptions(service.helpMamaPricing)
        .reduce<ReturnType<typeof getHelpMamaRateOptions>[number] | null>((best, option) => (!best || option.price < best.price ? option : best), null);
      if (cheapest) return `From ${formatAmount(cheapest.price)} ${cheapest.unit === "hour" ? "an hour" : `a ${cheapest.unit}`}`;
    }
    if (groupKey === "shopping") return `${formatAmount(service.basePrice)} a trip, plus the shopping`;
    if (groupKey === "home") {
      return service.houseCleaningEnabled
        ? `${formatAmount(service.basePrice)} a visit for a studio or 1-bedroom`
        : `${formatAmount(service.basePrice)} a pickup`;
    }
    return `From ${formatAmount(service.basePrice)}`;
  };

  const extraDetail = (service: ConciergeService): string => {
    if (service.category === "cars") return [service.seats ? `${service.seats} seats` : null, service.transmission || null].filter(Boolean).join(" · ");
    if (service.category === "cooks") return service.speciality || service.location || "";
    if (service.category === "experiences") {
      return [service.durationHours ? `${service.durationHours} hours` : null, service.experienceLocation || service.location || null].filter(Boolean).join(" · ");
    }
    return service.location || "";
  };

  const extraTotal = (service: ConciergeService): number => {
    if (service.category === "experiences") {
      const selection = getExistingSelection(service.id);
      if (selection?.serviceMode === "experience-custom-offer") return 0;
      const price = selection?.serviceMode === "experience-shared" ? service.sharedPricePerPerson || service.price : service.privatePricePerPerson || service.price;
      return price * (selection?.guests || guestsValue);
    }
    return calculateServiceTotal(service, nights);
  };

  const dueToday = calculateBookingDepositAmount(discountedTotalPrice);
  const tripDatesLine = checkInValue && checkOutValue ? describeTripRange(checkInValue, checkOutValue) : "Add your dates";

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
    if (isHotel) {
      if (!hotelQuote || !hotelQuote.ok) {
        toast({
          title: "Choose your room",
          description: hotelQuote && !hotelQuote.ok ? hotelQuote.error : "Choose a room and a meal plan for your stay.",
          variant: "destructive",
        });
        return false;
      }
      const left = data.roomTypeId ? hotelRoomsLeft?.get(data.roomTypeId) : undefined;
      if (left !== undefined && left < hotelQuote.snapshot.rooms) {
        toast({
          title: "Not enough rooms",
          description: left === 0
            ? `${hotelQuote.snapshot.roomTypeName} is fully booked for those dates. Please choose another room or other dates.`
            : `Only ${left} ${hotelQuote.snapshot.roomTypeName} room${left === 1 ? " is" : "s are"} left for those dates.`,
          variant: "destructive",
        });
        return false;
      }
    }

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
      roomTypeId: typeof payload.roomTypeId === "string" ? payload.roomTypeId : form.getValues("roomTypeId"),
      mealPlan: typeof payload.mealPlan === "string" ? payload.mealPlan : form.getValues("mealPlan"),
      roomCount: typeof payload.roomCount === "number" ? payload.roomCount : form.getValues("roomCount"),
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

  const priceLines = (
    <div className="space-y-2.5 text-sm" data-testid="list-trip-price-lines">
      <div className="flex justify-between gap-3">
        <span className="break-words text-muted-foreground">
          {isHotel && hotelQuote?.ok
            ? describeHotelStay(hotelQuote.snapshot)
            : nights > 0 ? `${accommodation.title}, ${nights} night${nights === 1 ? "" : "s"}` : accommodation.title}
        </span>
        <span className="shrink-0"><CurrencyAmount amountUsd={accommodationTotal} /></span>
      </div>
      {selectedSummaryServices.map((service) => {
        const isTailored = getExistingSelection(service.id)?.serviceMode === "experience-custom-offer";
        return (
          <div key={service.id} className="flex justify-between gap-3">
            <span className="break-words text-muted-foreground">{extraName(service)}</span>
            <span className="shrink-0">{isTailored ? "Quoted later" : <CurrencyAmount amountUsd={extraTotal(service)} />}</span>
          </div>
        );
      })}
      {promoPreview ? (
        <div className="flex justify-between gap-3 text-emerald-700">
          <span className="break-words">{promoPreview.bundleLabel || promoPreview.promoName}</span>
          <span className="shrink-0">-<CurrencyAmount amountUsd={promoSavings} /></span>
        </div>
      ) : null}
    </div>
  );

  const totals = (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-lg font-semibold">
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
      {nights > 0 && discountedTotalPrice > 0 ? (
        <div className="flex items-baseline justify-between gap-3 rounded-xl bg-primary/8 px-3 py-2 text-sm" data-testid="text-due-today">
          <span className="font-medium text-foreground">Pay today to lock your dates ({bookingDepositPercent}%)</span>
          <span className="shrink-0 font-semibold"><CurrencyAmount amountUsd={dueToday} /></span>
        </div>
      ) : null}
      {hasCustomQuoteAddon ? (
        <p className="text-xs leading-5 text-muted-foreground">Tailored experiences are quoted by our team and paid separately.</p>
      ) : null}
    </div>
  );

  return (
    <div className="app-shell min-h-screen pb-44 pt-6 sm:pt-8 lg:pb-12">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <header className="mb-6 flex items-center gap-4">
          <img
            src={accommodation.imageUrl || accommodation.galleryUrls?.[0] || ""}
            alt=""
            className="h-16 w-16 shrink-0 rounded-2xl bg-muted object-cover sm:h-20 sm:w-20"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Your trip</p>
            <h1 className="mt-1 truncate font-serif text-2xl font-semibold leading-tight text-foreground sm:text-3xl">{accommodation.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{accommodation.location}</span>
              {isHotel
                ? <span>{hotelRoomTypes.length} room type{hotelRoomTypes.length === 1 ? "" : "s"}</span>
                : <span>{accommodation.bedrooms} bedroom{accommodation.bedrooms === 1 ? "" : "s"} · up to {accommodation.maxOccupancy} guests</span>}
            </p>
          </div>
        </header>

        <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
          <div className="min-w-0">
            <Form {...form}>
              <form id="stay-booking-form" onSubmit={form.handleSubmit(submitBooking)} className="space-y-6">
                {/* 1. Dates, guests and (for a hotel) the room */}
                <Card className="surface-soft-card min-w-0 overflow-hidden border">
                  <div className="border-b border-border/60 px-5 py-4 sm:px-6">
                    <h2 className="text-lg font-semibold text-foreground sm:text-xl">1. Your stay</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {isHotel ? "Your dates, guests, room and meal plan. Prices are per room, per night." : "Your dates and how many of you are coming."}
                    </p>
                  </div>
                  <div className="grid gap-5 px-5 py-5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] sm:px-6">
                    <FormField
                      control={form.control}
                      name="checkOut"
                      render={() => (
                        <FormItem>
                          <FormLabel>Dates</FormLabel>
                          <FormControl>
                            <DateRangePicker
                              checkIn={checkInValue || ""}
                              checkOut={checkOutValue || ""}
                              bookedRanges={availability?.blockedRanges}
                              onChange={(next) => {
                                form.setValue("checkIn", next.checkIn, { shouldDirty: true, shouldValidate: true });
                                form.setValue("checkOut", next.checkOut, { shouldDirty: true, shouldValidate: true });
                              }}
                              data-testid="input-booking-dates"
                            />
                          </FormControl>
                          {form.formState.errors.checkIn ? (
                            <p className="text-sm font-medium text-destructive">{form.formState.errors.checkIn.message}</p>
                          ) : null}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="guests"
                      render={({ field }) => {
                        const guests = Number(field.value) || 1;
                        const maxGuests = Math.max(1, accommodation.maxOccupancy || 1);
                        return (
                          <FormItem>
                            <FormLabel>Guests</FormLabel>
                            <div className="flex items-center gap-3">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-11 w-11 rounded-full"
                                aria-label="One guest fewer"
                                disabled={guests <= 1}
                                onClick={() => field.onChange(Math.max(1, guests - 1))}
                              >
                                <Minus className="h-4 w-4" />
                              </Button>
                              <span className="min-w-[2ch] text-center text-lg font-semibold tabular-nums" aria-live="polite" data-testid="input-booking-guests">
                                {guests}
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-11 w-11 rounded-full"
                                aria-label="One guest more"
                                disabled={guests >= maxGuests}
                                onClick={() => field.onChange(Math.min(maxGuests, guests + 1))}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                              <span className="text-sm text-muted-foreground">Up to {maxGuests}</span>
                            </div>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                  </div>
                  {isHotel ? (
                    <div className="border-t border-border/60 px-5 py-5 sm:px-6">
                      {hotelRoomTypes.length > 0 ? (
                        <HotelRoomPicker
                          roomTypes={hotelRoomTypes}
                          roomsLeft={hotelRoomsLeft}
                          roomTypeId={roomTypeIdValue}
                          mealPlan={mealPlanValue}
                          roomCount={roomCountValue ?? 1}
                          quote={hotelQuote}
                          nights={nights}
                          onChange={(next) => {
                            if (next.roomTypeId !== undefined) form.setValue("roomTypeId", next.roomTypeId, { shouldDirty: true });
                            if (next.mealPlan !== undefined) form.setValue("mealPlan", next.mealPlan as BookingFormValues["mealPlan"], { shouldDirty: true });
                            if (next.roomCount !== undefined) form.setValue("roomCount", next.roomCount, { shouldDirty: true });
                          }}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground">This hotel has no rooms to book right now.</p>
                      )}
                    </div>
                  ) : null}
                </Card>

                {/* 2. Extras, in one booking and one payment */}
                <Card className="surface-soft-card min-w-0 overflow-hidden border">
                  <div className="border-b border-border/60 px-5 py-4 sm:px-6">
                    <h2 className="text-lg font-semibold text-foreground sm:text-xl">2. Add to your trip</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Optional. Whatever you add comes in this one booking and one payment.</p>
                  </div>
                  <div className="space-y-3 px-5 py-5 sm:px-6">
                    {tripExtraGroups.map((group) => {
                      const GroupIcon = group.icon;
                      const requested = requestedExtras.has(group.key);
                      const items = group.items.filter((service) => {
                        const selection = getExistingSelection(service.id);
                        return !selection || groupForSelection(selection) === group.key;
                      });
                      if (items.length === 0 && !requested) return null;
                      const chosen = items.filter((service) => selectedServices.includes(service.id));
                      const showAll = Boolean(openExtraGroups[group.key]);
                      const visible = showAll ? items : Array.from(new Set([...chosen, ...items.slice(0, 2)]));
                      return (
                        <section
                          key={group.key}
                          className={`rounded-2xl border p-4 ${requested ? "border-primary/40 bg-primary/5" : "border-border/70 bg-background/60"}`}
                          aria-labelledby={`extra-${group.key}`}
                          data-testid={`extra-group-${group.key}`}
                        >
                          <div className="flex items-start gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                              <GroupIcon className="h-5 w-5" />
                            </span>
                            <div className="min-w-0">
                              <h3 id={`extra-${group.key}`} className="font-semibold text-foreground">{group.title}</h3>
                              <p className="text-sm leading-6 text-muted-foreground">{group.description}</p>
                              {requested ? <p className="mt-1 text-xs font-medium text-primary">You asked to add this.</p> : null}
                            </div>
                          </div>

                          {items.length > 0 ? (
                            <ul className="mt-3 divide-y divide-border/60">
                              {visible.map((service) => {
                                const isChosen = selectedServices.includes(service.id);
                                const selection = getExistingSelection(service.id);
                                const detail = extraDetail(service);
                                return (
                                  <li key={service.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" data-testid={`extra-${group.key}-${service.id}`}>
                                    <div className="min-w-0 flex-1">
                                      <div className="font-medium text-foreground">{extraName(service)}</div>
                                      <div className="text-sm text-muted-foreground">
                                        {extraPriceLabel(group.key, service)}{detail ? ` · ${detail}` : ""}
                                      </div>
                                      {isChosen && selection ? (
                                        <div className="mt-1 text-sm font-medium text-primary">
                                          Added: {getServiceModeLabel(selection.serviceMode)}
                                          {selection.serviceMode === "experience-custom-offer" ? null : <> · <CurrencyAmount amountUsd={extraTotal(service)} /></>}
                                        </div>
                                      ) : null}
                                    </div>
                                    {isChosen ? (
                                      <div className="flex gap-2">
                                        <Button type="button" variant="outline" size="sm" className="min-h-10 rounded-full" onClick={() => openSelectionDialog(service.id)}>
                                          Edit
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" className="min-h-10 rounded-full" onClick={() => removeSelectedService(service.id)}>
                                          Remove
                                        </Button>
                                      </div>
                                    ) : (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="min-h-10 rounded-full px-4"
                                        onClick={() => openSelectionDialog(service.id, suggestedModeFor(group.key, service, guestsValue))}
                                        data-testid={`button-add-extra-${service.id}`}
                                      >
                                        <Plus className="mr-1 h-4 w-4" />
                                        Add
                                      </Button>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className="mt-3 text-sm text-muted-foreground">
                              Nothing is listed for this yet. Ask Zaina and our team will arrange it for your trip.
                            </p>
                          )}

                          {items.length > 2 ? (
                            <button
                              type="button"
                              className="mt-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
                              aria-expanded={showAll}
                              onClick={() => setOpenExtraGroups((current) => ({ ...current, [group.key]: !showAll }))}
                            >
                              {showAll ? "Show fewer" : `See all ${items.length}`}
                            </button>
                          ) : null}
                        </section>
                      );
                    })}
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
                      onClick={() => openZaina(`For my stay at ${accommodation.title}, could you also arrange: `)}
                    >
                      <MessageCircle className="h-4 w-4" />
                      Something else in mind? Ask Zaina to arrange it
                    </button>
                  </div>
                </Card>

                {/* 3. Who's booking */}
                <Card className="surface-soft-card min-w-0 overflow-hidden border">
                  <div className="border-b border-border/60 px-5 py-4 sm:px-6">
                    <h2 className="text-lg font-semibold text-foreground sm:text-xl">3. Your details</h2>
                    <p className="mt-1 text-sm text-muted-foreground">So we can confirm the booking and arrange your arrival.</p>
                  </div>
                  <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6">
                    <FormField
                      control={form.control}
                      name="guestName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full name</FormLabel>
                          <FormControl>
                            <Input placeholder="As on your ID" autoComplete="name" {...field} className="text-base sm:text-sm" data-testid="input-guest-name" />
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
                          <FormLabel>WhatsApp number (optional)</FormLabel>
                          <FormControl>
                            <Input type="tel" autoComplete="tel" placeholder="+254 712 345 678" {...field} className="text-base sm:text-sm" data-testid="input-guest-phone" />
                          </FormControl>
                          <p className="text-xs text-muted-foreground">We confirm bookings and arrival details on WhatsApp.</p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </Card>
              </form>
            </Form>
          </div>

          {/* The trip's summary: pinned beside the form on a laptop, after it on a phone. */}
          <aside className="min-w-0 lg:sticky lg:top-24" aria-labelledby="trip-summary-heading">
            <Card className="surface-soft-card min-w-0 overflow-hidden border" id="trip-summary">
              <div className="border-b border-border/60 px-5 py-4">
                <h2 id="trip-summary-heading" className="text-lg font-semibold text-foreground">Trip summary</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tripDatesLine} · {guestsValue} guest{guestsValue === 1 ? "" : "s"}
                </p>
              </div>
              <div className="space-y-4 px-5 py-4">
                {priceLines}
                <div className="border-t border-border/60 pt-4">{totals}</div>
              </div>

              <div className="space-y-3 border-t border-border/60 px-5 py-4">
                <Button
                  type="submit"
                  form="stay-booking-form"
                  size="lg"
                  className="hidden min-h-12 w-full lg:inline-flex"
                  disabled={createBookingMutation.isPending}
                  data-testid="button-complete-booking"
                >
                  Book this trip
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  Next, you pay the deposit in My Bookings by M-Pesa or card. That locks your dates; the rest is paid later.
                </p>
                <StayRefundNote checkIn={checkInValue} className="text-xs leading-5" />
              </div>

              <Collapsible className="border-t border-border/60">
                <CollapsibleTrigger asChild>
                  <button type="button" className="flex w-full items-center justify-between px-5 py-3 text-left text-sm font-medium text-foreground">
                    Have a promo code?
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="px-5 pb-4">
                  <Label htmlFor="stay-promo-code" className="sr-only">Promo code</Label>
                  <Input
                    id="stay-promo-code"
                    value={promoCode}
                    onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
                    placeholder="e.g. APRIL-BUNDLE"
                    className="text-base sm:text-sm"
                  />
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {promoPreviewQuery.isFetching
                      ? "Checking the code…"
                      : promoPreview
                        ? `${promoPreview.promoName} is applied.`
                        : promoRejectionReason || "Some offers apply on their own when your trip qualifies."}
                  </p>
                </CollapsibleContent>
              </Collapsible>

              <div className="border-t border-border/60 px-5 py-4 text-sm text-muted-foreground">
                <ul className="space-y-2">
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Pay by M-Pesa or card</li>
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Zaina answers any time; our team Monday to Saturday, 8am to 8pm</li>
                </ul>
                <AskZainaLink listingName={accommodation.title} className="mt-3" />
              </div>
            </Card>
          </aside>
        </div>
      </div>

      {/* Phones: the trip's total and what's due today stay in reach, above the tab bar. */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t border-border/70 bg-background/95 px-4 py-3 shadow-[0_-18px_40px_rgba(15,23,42,0.16)] backdrop-blur lg:hidden">
        <div className="mx-auto w-full max-w-6xl">
          {showBarDetails ? (
            <div className="mb-3 max-h-[45vh] space-y-3 overflow-y-auto border-b border-border/60 pb-3" id="trip-bar-details">
              <p className="text-sm font-medium text-foreground">{tripDatesLine}</p>
              {priceLines}
              {totals}
            </div>
          ) : null}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold text-foreground">
                {nights > 0 ? <CurrencyAmount amountUsd={discountedTotalPrice} /> : <>From <CurrencyAmount amountUsd={accommodation.price} /></>}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {nights > 0 && discountedTotalPrice > 0
                  ? <>Pay <span className="font-semibold text-foreground">{formatAmount(dueToday)}</span> today · {nights} night{nights === 1 ? "" : "s"}{selectedSummaryServices.length ? ` + ${selectedSummaryServices.length} extra${selectedSummaryServices.length === 1 ? "" : "s"}` : ""}</>
                  : "Add your dates to see the total"}
              </div>
              <button
                type="button"
                className="mt-0.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
                aria-expanded={showBarDetails}
                aria-controls="trip-bar-details"
                onClick={() => setShowBarDetails((value) => !value)}
              >
                {showBarDetails ? "Hide details" : "Details"}
              </button>
            </div>
            <Button
              type="submit"
              form="stay-booking-form"
              className="min-h-12 shrink-0 rounded-full px-6"
              disabled={createBookingMutation.isPending}
              data-testid="button-complete-booking-mobile"
            >
              Book
            </Button>
          </div>
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
              {configuringService ? `Add ${"model" in configuringService ? configuringService.model : "title" in configuringService ? configuringService.title : "serviceName" in configuringService ? configuringService.serviceName : "service"} to your trip` : "Add to your trip"}
            </DialogTitle>
            <DialogDescription>
              Set the details and it's added to this booking.
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
              Add to my trip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
