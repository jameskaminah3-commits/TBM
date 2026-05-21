import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ErrandAddon } from "@shared/schema";

type ErrandAddonEditorProps = {
  label: string;
  description: string;
  value: ErrandAddon[];
  onChange: (addons: ErrandAddon[]) => void;
  currencyLabel?: string;
};

function createAddon(): ErrandAddon {
  return {
    id: crypto.randomUUID(),
    name: "",
    price: 0,
  };
}

export function ErrandAddonEditor({ label, description, value, onChange, currencyLabel }: ErrandAddonEditorProps) {
  const updateAddon = (id: string, patch: Partial<ErrandAddon>) => {
    onChange(value.map((addon) => addon.id === id ? { ...addon, ...patch } : addon));
  };

  const removeAddon = (id: string) => {
    onChange(value.filter((addon) => addon.id !== id));
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>

      {value.length ? value.map((addon) => (
        <div key={addon.id} className="grid gap-3 md:grid-cols-[1fr_140px_auto]">
          <Input
            placeholder="Add-on name"
            value={addon.name}
            onChange={(e) => updateAddon(addon.id, { name: e.target.value })}
          />
          <Input
            type="number"
            min="0"
            placeholder={currencyLabel ? `Price (${currencyLabel})` : "Price"}
            value={addon.price}
            onChange={(e) => updateAddon(addon.id, { price: e.target.value === "" ? 0 : Number(e.target.value) })}
          />
          <Button type="button" variant="outline" size="icon" onClick={() => removeAddon(addon.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )) : (
        <div className="text-sm text-muted-foreground">No add-ons added yet.</div>
      )}

      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, createAddon()])}>
        <Plus className="mr-2 h-4 w-4" />
        Add Add-On
      </Button>
    </div>
  );
}
