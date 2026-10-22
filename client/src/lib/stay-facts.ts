type StayFactsSource = {
  bedrooms?: number | null;
  maxOccupancy?: number | null;
};

const counted = (value: number | null | undefined, one: string, many: string) =>
  value && value > 0 ? `${value} ${value === 1 ? one : many}` : null;

/**
 * A home's layout in one line: "4 bedrooms · up to 8 guests". A fact the
 * listing doesn't have yet (saved as 0) is left out rather than shown as
 * "0 bedrooms"; null when there is nothing to say.
 */
export function stayFactsLine(stay: StayFactsSource): string | null {
  const guests = stay.maxOccupancy && stay.maxOccupancy > 0 ? `up to ${stay.maxOccupancy} guests` : null;
  const parts = [counted(stay.bedrooms, "bedroom", "bedrooms"), guests].filter(Boolean) as string[];
  if (!parts.length) return null;
  const line = parts.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}
