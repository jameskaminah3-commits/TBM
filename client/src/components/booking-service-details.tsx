import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Car, ChefHat, Compass, ShoppingBag } from "lucide-react";
import type { Booking, Car as CarType, Cook, Errand, Experience, StayServiceSelection } from "@shared/schema";

type ServiceItem = CarType | Cook | Errand | Experience;

type BookingServiceDetailsProps = {
  booking: Booking;
  getServiceById: (id: string) => ServiceItem | null | undefined;
  formatAmount: (amountUsd: number) => string;
  formatTime: (timeString?: string | null) => string | null;
  hideRequestDetails?: boolean;
};

type NormalizedSelection = StayServiceSelection & {
  serviceId: string;
  category: "cars" | "cooks" | "errands" | "experiences";
};

function getServiceName(service: ServiceItem | null | undefined) {
  if (!service) return "Service";
  if ("model" in service) return service.model;
  if ("speciality" in service) return service.title;
  if ("experienceType" in service) return service.title;
  return service.serviceName;
}

function getServiceIcon(category: NormalizedSelection["category"]) {
  switch (category) {
    case "cars":
      return <Car className="h-4 w-4" />;
    case "cooks":
      return <ChefHat className="h-4 w-4" />;
    case "experiences":
      return <Compass className="h-4 w-4" />;
    default:
      return <ShoppingBag className="h-4 w-4" />;
  }
}

function getModeLabel(mode?: string | null) {
  switch (mode) {
    case "car-chauffeur-hourly":
      return "Hourly chauffeur";
    case "car-chauffeur-day":
      return "Chauffeur day support";
    case "car-self-drive-day":
      return "Self-drive day support";
    case "cook-service-fee":
      return "Chef service fee";
    case "cook-inclusive":
      return "Ingredients + shopping inclusive";
    case "cook-custom-menu":
      return "Custom menu request";
    case "errand-shopping":
      return "Shopping support";
    case "errand-laundry":
      return "Laundry support";
    case "errand-house-cleaning":
      return "House cleaning";
    case "errand-childcare":
      return "Help Mama support";
    case "errand-base":
      return "Base support";
    case "experience-private":
      return "Private experience";
    case "experience-shared":
      return "Shared departure";
    case "experience-custom-offer":
      return "Tailored experience";
    default:
      return "Configured service";
  }
}

function buildFallbackSelections(booking: Booking): NormalizedSelection[] {
  if (Array.isArray(booking.stayServiceSelections) && booking.stayServiceSelections.length > 0) {
    return booking.stayServiceSelections
      .filter((selection): selection is NormalizedSelection => !!selection?.serviceId && !!selection?.category);
  }

  return (booking.selectedServices || []).map((serviceId) => {
    const category: NormalizedSelection["category"] =
      booking.serviceMode?.startsWith("car-") ? "cars" :
      booking.serviceMode?.startsWith("cook-") ? "cooks" :
      booking.serviceMode?.startsWith("experience-") ? "experiences" :
      "errands";

    return {
      serviceId,
      category,
      serviceMode: booking.serviceMode,
      units: null,
      guests: booking.guests,
      serviceHours: booking.serviceHours,
      serviceLocation: booking.serviceLocation,
      servicePickupLocation: booking.servicePickupLocation,
      serviceReturnLocation: booking.serviceReturnLocation,
      serviceStartTime: booking.serviceStartTime,
      serviceEndTime: booking.serviceEndTime,
      serviceBudgetAmount: booking.serviceBudgetAmount,
      serviceLaundryWeightKg: booking.serviceLaundryWeightKg,
      serviceAddonSelections: booking.serviceAddonSelections || [],
      serviceDepartureId: booking.serviceDepartureId,
      serviceRequestDetails: booking.serviceRequestDetails,
    };
  });
}

export function BookingServiceDetails({
  booking,
  getServiceById,
  formatAmount,
  formatTime,
  hideRequestDetails = false,
}: BookingServiceDetailsProps) {
  const selections = buildFallbackSelections(booking);

  if (!selections.length) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Service Setup</div>
      <div className="space-y-3">
        {selections.map((selection, index) => {
          const service = getServiceById(selection.serviceId);
          const addonNames = selection.category === "errands" && service && "serviceName" in service
            ? (selection.serviceMode === "errand-laundry"
                ? (service.laundryAddons || []).filter((addon) => (selection.serviceAddonSelections || []).includes(addon.id)).map((addon) => addon.name)
                : selection.serviceMode === "errand-house-cleaning"
                  ? (service.houseCleaningAddons || []).filter((addon) => (selection.serviceAddonSelections || []).includes(addon.id)).map((addon) => addon.name)
                  : [])
            : [];

          const metaBadges = [
            getModeLabel(selection.serviceMode),
            selection.category === "cars" && selection.serviceMode === "car-chauffeur-hourly" && selection.serviceHours
              ? `${selection.serviceHours} hour${selection.serviceHours === 1 ? "" : "s"}`
              : null,
            selection.category === "cars" && selection.serviceMode !== "car-chauffeur-hourly" && selection.units
              ? `${selection.units} day${selection.units === 1 ? "" : "s"}`
              : null,
            selection.category === "cooks" && selection.units
              ? `${selection.units} session${selection.units === 1 ? "" : "s"}`
              : null,
            selection.category === "experiences" && selection.guests
              ? `${selection.guests} guest${selection.guests === 1 ? "" : "s"}`
              : null,
          ].filter(Boolean);

          const detailLines = [
            selection.category === "cars" && selection.servicePickupLocation ? `Pickup: ${selection.servicePickupLocation}` : null,
            selection.category === "cars" && selection.serviceReturnLocation ? `${selection.serviceMode === "car-self-drive-day" ? "Return" : "Drop-off"}: ${selection.serviceReturnLocation}` : null,
            selection.category === "cars" && selection.serviceStartTime ? `Start time: ${formatTime(selection.serviceStartTime) || selection.serviceStartTime}` : null,
            selection.category === "cooks" && selection.serviceLocation ? `Service location: ${selection.serviceLocation}` : null,
            selection.category === "errands" && selection.serviceLocation ? `Service location: ${selection.serviceLocation}` : null,
            selection.category === "errands" && selection.serviceMode === "errand-shopping" && selection.serviceBudgetAmount ? `Shopping budget: ${formatAmount(selection.serviceBudgetAmount)}` : null,
            selection.category === "errands" && addonNames.length ? `Selected add-ons: ${addonNames.join(", ")}` : null,
            selection.category === "experiences" && selection.serviceMode === "experience-shared" ? "Shared departure selected" : null,
          ].filter(Boolean);

          return (
            <Card key={`${selection.serviceId}-${selection.serviceMode || "base"}-${index}`} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    {getServiceIcon(selection.category)}
                    <span className="break-words">{getServiceName(service)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {metaBadges.map((badge) => (
                      <Badge key={badge} variant="secondary" className="whitespace-normal text-xs">
                        {badge}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              {detailLines.length ? (
                <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {detailLines.map((line) => (
                    <div key={line} className="break-words">{line}</div>
                  ))}
                </div>
              ) : null}

              {!hideRequestDetails && selection.serviceRequestDetails?.trim() ? (
                <div className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
                  {selection.serviceRequestDetails.trim()}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
