// TBM's check of the stored rating columns against eligible reviews. Public
// pages never use the stored numbers, but TBM's own screens do; old or seeded
// numbers show here first, and are recounted only when TBM chooses to.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type Difference = {
  kind: string;
  id: string;
  name: string;
  isPublic: boolean;
  stored: { rating: number; reviewCount: number };
  eligible: { rating: number; reviewCount: number };
};

const kindLabels: Record<string, string> = { stay: "Stay", car: "Car", cook: "Chef", errand: "Home help", experience: "Experience" };
const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1");
const numbers = (value: { rating: number; reviewCount: number }) => `${value.rating || "–"} · ${value.reviewCount} review${value.reviewCount === 1 ? "" : "s"}`;

export function AdminStoredRatings() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { data, isLoading } = useQuery<{ checked: number; differences: Difference[] }>({ queryKey: ["/api/admin/ratings/check"], enabled: open });
  const recount = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/ratings/recount", {})).json() as Promise<{ checked: number; updated: number }>,
    onSuccess: (result) => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/ratings/check"] });
      toast({ title: `${result.updated} listing${result.updated === 1 ? "" : "s"} recounted`, description: `${result.checked} checked.` });
    },
    onError: (error: Error) => toast({ title: "Couldn't recount", description: errorText(error), variant: "destructive" }),
  });
  const differences = data?.differences ?? [];

  return (
    <Card className="border-stone-200/80 bg-white shadow-sm" data-testid="admin-stored-ratings">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="space-y-1">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex w-full items-center justify-between gap-3 text-left" data-testid="button-stored-ratings">
              <CardTitle className="text-xl">Stored ratings</CardTitle>
              <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
          <CardDescription className="leading-6">
            Guests always see ratings worked out from eligible reviews. The numbers stored on each listing feed TBM's own screens and can be out of date or seeded. Check them here and recount when you're ready.
          </CardDescription>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            {isLoading ? <p className="text-sm text-muted-foreground">Checking…</p> : null}
            {data ? (
              <p className="text-sm text-stone-700" data-testid="text-stored-ratings-summary">
                {differences.length
                  ? `${differences.length} of ${data.checked} listings differ from their eligible reviews.`
                  : `All ${data.checked} listings match their eligible reviews.`}
              </p>
            ) : null}
            {differences.length ? (
              <>
                <ul className="max-h-80 space-y-1.5 overflow-y-auto text-sm">
                  {differences.map((difference) => (
                    <li key={`${difference.kind}:${difference.id}`} className="flex flex-col gap-0.5 rounded-lg border border-stone-200 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0">
                        <span className="font-medium">{difference.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{kindLabels[difference.kind] ?? difference.kind}{difference.isPublic ? "" : " · not public"}</span>
                      </span>
                      <span className="text-xs tabular-nums text-stone-600">Stored {numbers(difference.stored)} → eligible {numbers(difference.eligible)}</span>
                    </li>
                  ))}
                </ul>
                {confirming ? (
                  <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    <p>Recounting writes the eligible numbers into these {differences.length} listings. Seeded ratings with no eligible reviews behind them go to zero. Nothing else changes.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" className="rounded-full" disabled={recount.isPending} onClick={() => recount.mutate()} data-testid="button-confirm-recount">Recount {differences.length} listings</Button>
                      <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => setConfirming(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => setConfirming(true)} data-testid="button-recount-ratings">Recount from eligible reviews…</Button>
                )}
              </>
            ) : data ? <Badge variant="outline" className="rounded-full">Nothing to recount</Badge> : null}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
