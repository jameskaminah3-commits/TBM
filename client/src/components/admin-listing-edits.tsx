import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ListingEdit, ListingEditKind } from "@shared/schema";

type ListingEditView = ListingEdit & { editorName: string };

const kindLabel: Record<ListingEditKind, string> = {
  stay: "Stay",
  car: "Car",
  cook: "Chef",
  errand: "Errand",
  experience: "Experience",
};

const editPath: Record<ListingEditKind, string> = {
  stay: "stays",
  car: "cars",
  cook: "cooks",
  errand: "errands",
  experience: "experiences",
};

function fieldLabel(field: string) {
  const words = field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/Url(s?)\b/, "photo$1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Listing prices are stored in US dollars.
function describeValue(value: unknown, field: string): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "number" && /price|rate|fee|amount/i.test(field)) return `USD ${value.toLocaleString("en-US")}`;
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return "updated details";
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Providers' edits go live straight away; the team checks them here afterwards.
export function AdminListingEdits() {
  const { toast } = useToast();
  const { data: edits = [] } = useQuery<ListingEditView[]>({ queryKey: ["/api/admin/listing-edits"] });

  const markReviewed = useMutation({
    mutationFn: async (ids: string[]) => apiRequest("POST", "/api/admin/listing-edits/review", { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/listing-edits"] }),
    onError: (error: Error) => toast({ title: "Could not mark as reviewed", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  if (!edits.length) {
    return null;
  }

  return (
    <Card className="border-amber-200 bg-white shadow-sm" data-testid="admin-listing-edits">
      <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-lg">Provider edits to review ({edits.length})</CardTitle>
          <CardDescription>Providers' changes are already live. Check them, then mark them reviewed.</CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={markReviewed.isPending}
          onClick={() => markReviewed.mutate(edits.map((edit) => edit.id))}
        >
          Mark all reviewed
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {edits.map((edit) => {
          const kind = edit.listingKind as ListingEditKind;
          return (
            <div key={edit.id} className="rounded-xl border border-stone-200 p-3 sm:p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{edit.listingTitle}</span>
                    <Badge variant="outline">{kindLabel[kind] ?? edit.listingKind}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{edit.editorName} · {formatWhen(edit.createdAt)}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/admin/${editPath[kind] ?? "listings"}/${edit.listingId}/edit`}>Open listing</Link>
                  </Button>
                  <Button type="button" size="sm" disabled={markReviewed.isPending} onClick={() => markReviewed.mutate([edit.id])}>
                    Mark reviewed
                  </Button>
                </div>
              </div>
              <dl className="mt-3 grid gap-1.5 text-sm">
                {Object.entries(edit.changes).map(([field, change]) => (
                  <div key={field} className="grid gap-0.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
                    <dt className="text-muted-foreground">{fieldLabel(field)}</dt>
                    <dd className="min-w-0 break-words">
                      <span className="text-muted-foreground line-through decoration-stone-300">{describeValue(change.before, field)}</span>
                      {" → "}
                      <span className="text-foreground">{describeValue(change.after, field)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
