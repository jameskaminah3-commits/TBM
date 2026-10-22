// What a car added to a stay costs. One rule for the checkout page and the
// server, so the trip total a guest is shown is the amount they're asked to pay.
// (The checkout once priced a car with a driver at the self-drive rate.)

export type StayCarRates = {
  pricePerDay?: number | null;
  priceWithDriver: number;
  priceWithDriverHourly?: number | null;
};

export type StayCarChoice = {
  serviceMode?: string | null;
  units?: number | null;
  serviceHours?: number | null;
};

export const MIN_CHAUFFEUR_HOURS = 3;

/** The day rate for a mode: self-drive when chosen and offered, otherwise with a driver. */
export function stayCarDailyRate(car: StayCarRates, serviceMode?: string | null) {
  return serviceMode === "car-self-drive-day" && car.pricePerDay ? car.pricePerDay : car.priceWithDriver;
}

/** The car's total for the stay, and the days or hours it is charged for. `days` = the stay's chargeable days. */
export function stayCarAddonPrice(car: StayCarRates, choice: StayCarChoice, days: number) {
  const units = Math.max(1, choice.units || days);
  if (choice.serviceMode === "car-chauffeur-hourly") {
    const hours = Math.max(MIN_CHAUFFEUR_HOURS, choice.serviceHours || units || MIN_CHAUFFEUR_HOURS);
    return { total: hours * (car.priceWithDriverHourly || 0), units: hours, hours };
  }
  return { total: units * stayCarDailyRate(car, choice.serviceMode), units, hours: null };
}
