// What each kind of booking is called in Provider Hub, instead of the code
// stored with it ("cook-service-fee" reads as "Chef's service, guest buys food").
const serviceModeLabels: Record<string, string> = {
  "car-chauffeur-day": "With driver, by the day",
  "car-chauffeur-hourly": "With driver, by the hour",
  "car-self-drive-day": "Self-drive",
  "car-with-driver": "With driver",
  "car-rental": "Self-drive",
  "cook-service-fee": "Chef's service, guest buys the food",
  "cook-inclusive": "Chef with food included",
  "cook-custom-menu": "Custom menu",
  "errand-base": "Home help",
  "errand-shopping": "Shopping",
  "errand-laundry": "Laundry",
  "errand-house-cleaning": "House cleaning",
  "errand-childcare": "Help Mama (family care)",
  "experience-private": "Private group",
  "experience-shared": "Shared departure",
  "experience-custom-offer": "Custom offer",
};

export function getServiceModeLabel(mode: string | null | undefined): string | null {
  if (!mode) return null;
  return serviceModeLabels[mode] ?? null;
}

const reservationStatusLabels: Record<string, string> = {
  confirmed: "Booked",
  pending: "Being booked",
  blocked: "Blocked by you",
  cancelled: "Cancelled",
  completed: "Done",
  "in-progress": "In progress",
  upcoming: "Booked",
};

// "confirmed" reads as "Booked"; anything unknown is shown with a capital letter.
export function getReservationStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return reservationStatusLabels[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/-/g, " ");
}
