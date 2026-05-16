import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { HelpMamaPricing } from "@shared/schema";
import { DEFAULT_HELP_MAMA_AGE_BANDS, normalizeHelpMamaPricing } from "@shared/errand-pricing";

type HelpMamaPricingEditorProps = {
  value?: HelpMamaPricing | null;
  onChange: (value: HelpMamaPricing) => void;
};

export function HelpMamaPricingEditor({ value, onChange }: HelpMamaPricingEditorProps) {
  const pricing = normalizeHelpMamaPricing(value);

  const update = (patch: Partial<HelpMamaPricing>) => {
    onChange(normalizeHelpMamaPricing({ ...pricing, ...patch }));
  };

  const updateAgeBand = (
    id: string,
    field: "label" | "hourlyDaytimePrice" | "hourlyEveningPrice" | "overnightPrice" | "fullDayPrice",
    nextValue: string,
  ) => {
    update({
      ageBands: pricing.ageBands.map((band) => (
        band.id === id
          ? { ...band, [field]: field === "label" ? nextValue : Math.max(0, Number(nextValue) || 0) }
          : band
      )),
    });
  };

  return (
    <div className="space-y-4 rounded-lg border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label className="text-base">Help Mama Pricing</Label>
          <p className="mt-1 text-sm text-muted-foreground">
            Only use this for family care errands. Other errands can leave it off.
          </p>
        </div>
        <Checkbox checked={pricing.enabled} onCheckedChange={(checked) => update({ enabled: Boolean(checked) })} />
      </div>

      {pricing.enabled ? (
        <div className="space-y-5">
          <div className="space-y-3">
            <div>
              <Label>Age pricing</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                Set each age band's hourly daytime, hourly evening, overnight, and full-day prices in USD.
              </p>
            </div>
            {pricing.ageBands.map((band) => (
              <div key={band.id} className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <div className="space-y-2">
                  <Label>Age</Label>
                  <Input value={band.label} onChange={(event) => updateAgeBand(band.id, "label", event.target.value)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label>Hourly daytime</Label>
                    <Input type="number" min="0" value={band.hourlyDaytimePrice} onChange={(event) => updateAgeBand(band.id, "hourlyDaytimePrice", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Hourly evening</Label>
                    <Input type="number" min="0" value={band.hourlyEveningPrice} onChange={(event) => updateAgeBand(band.id, "hourlyEveningPrice", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Overnight</Label>
                    <Input type="number" min="0" value={band.overnightPrice} onChange={(event) => updateAgeBand(band.id, "overnightPrice", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Full day</Label>
                    <Input type="number" min="0" value={band.fullDayPrice} onChange={(event) => updateAgeBand(band.id, "fullDayPrice", event.target.value)} />
                  </div>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => update({ ageBands: DEFAULT_HELP_MAMA_AGE_BANDS.map((band) => ({ ...band })) })}
            >
              Reset age bands
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
