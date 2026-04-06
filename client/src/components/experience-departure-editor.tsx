import { CalendarDays, Clock3, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExperienceDeparture } from "@shared/schema";

type ExperienceDepartureEditorProps = {
  value: ExperienceDeparture[];
  onChange: (departures: ExperienceDeparture[]) => void;
};

function createDeparture(): ExperienceDeparture {
  return {
    id: crypto.randomUUID(),
    date: "",
    time: "",
  };
}

export function ExperienceDepartureEditor({ value, onChange }: ExperienceDepartureEditorProps) {
  const updateDeparture = (id: string, patch: Partial<ExperienceDeparture>) => {
    onChange(value.map((departure) => departure.id === id ? { ...departure, ...patch } : departure));
  };

  const removeDeparture = (id: string) => {
    onChange(value.filter((departure) => departure.id !== id));
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <div className="text-sm font-medium">Shared Departures</div>
        <div className="text-sm text-muted-foreground">
          Add the exact fixed departure dates and times guests can join.
        </div>
      </div>

      {value.length ? value.map((departure) => (
        <div key={departure.id} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="date"
              className="pl-10"
              value={departure.date}
              onChange={(e) => updateDeparture(departure.id, { date: e.target.value })}
            />
          </div>
          <div className="relative">
            <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="time"
              className="pl-10"
              value={departure.time}
              onChange={(e) => updateDeparture(departure.id, { time: e.target.value })}
            />
          </div>
          <Button type="button" variant="outline" size="icon" onClick={() => removeDeparture(departure.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )) : (
        <div className="text-sm text-muted-foreground">No shared departures added yet.</div>
      )}

      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, createDeparture()])}>
        <Plus className="mr-2 h-4 w-4" />
        Add Departure
      </Button>
    </div>
  );
}
