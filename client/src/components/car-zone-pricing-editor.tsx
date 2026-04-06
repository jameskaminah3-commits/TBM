import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CarZoneRate } from "@shared/schema";

type CarZonePricingEditorProps = {
  value: CarZoneRate[];
  onChange: (value: CarZoneRate[]) => void;
  currency?: "USD" | "KES";
  usdToKes?: number;
};

function createEmptyZone(): CarZoneRate {
  return {
    id: crypto.randomUUID(),
    name: "",
  };
}

export function CarZonePricingEditor({
  value,
  onChange,
  currency = "USD",
  usdToKes = 130,
}: CarZonePricingEditorProps) {
  const zones = value.length > 0 ? value : [];
  const toDisplay = (amount?: number) => {
    if (amount == null) return "";
    return currency === "KES" ? String(Math.round(amount * usdToKes)) : String(amount);
  };
  const toStored = (value: string) => {
    if (!value) return undefined;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return undefined;
    }
    return currency === "KES" ? Math.max(1, Math.round(numericValue / usdToKes)) : numericValue;
  };

  const updateZone = (zoneId: string, patch: Partial<CarZoneRate>) => {
    onChange(zones.map((zone) => (zone.id === zoneId ? { ...zone, ...patch } : zone)));
  };

  const removeZone = (zoneId: string) => {
    onChange(zones.filter((zone) => zone.id !== zoneId));
  };

  const addZone = () => {
    onChange([...zones, createEmptyZone()]);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
        <div className="text-sm font-medium">Zone pricing</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Add named routes or service areas so guests see polished, pre-set chauffeur and self-drive pricing instead of needing manual quotes.
        </p>
      </div>
      {zones.map((zone) => (
        <div key={zone.id} className="space-y-4 rounded-xl border border-border/70 bg-background p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Zone setup</div>
            <Button type="button" variant="outline" onClick={() => removeZone(zone.id)}>
              Remove
            </Button>
          </div>
          <Input
            placeholder="Airport transfer, Diani South, Watamu full day..."
            value={zone.name}
            onChange={(e) => updateZone(zone.id, { name: e.target.value })}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Chauffeur day</div>
              <Input
                type="number"
                min="1"
                placeholder={currency === "KES" ? "Daily price (KSh)" : "Daily price"}
                value={toDisplay(zone.dailyPrice)}
                onChange={(e) => updateZone(zone.id, {
                  dailyPrice: toStored(e.target.value),
                })}
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Chauffeur hour</div>
              <Input
                type="number"
                min="1"
                placeholder={currency === "KES" ? "Hourly price (KSh)" : "Hourly price"}
                value={toDisplay(zone.hourlyPrice)}
                onChange={(e) => updateZone(zone.id, {
                  hourlyPrice: toStored(e.target.value),
                })}
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Self-drive</div>
              <Input
                type="number"
                min="1"
                placeholder={currency === "KES" ? "Self-drive price (KSh)" : "Self-drive price"}
                value={toDisplay(zone.selfDrivePrice)}
                onChange={(e) => updateZone(zone.id, {
                  selfDrivePrice: toStored(e.target.value),
                })}
              />
            </div>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={addZone}>
        Add Zone
      </Button>
    </div>
  );
}
