// Days a home help or experience provider isn't available. Guests can't book
// them, and the booking pages grey them out.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/provider-hub/field";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCalendarDateRange, todayInKenya } from "@shared/calendar-dates";
import type { ListingBlockView } from "@shared/listing-blocks";

export function DateBlocksPanel({ segment, listingId }: { segment: "errands" | "experiences"; listingId: string }) {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const queryKey = [`/api/provider/${segment}/${listingId}/blocks`];
  const { data, isLoading } = useQuery<{ blocks: ListingBlockView[] }>({ queryKey });
  const today = todayInKenya();
  const blocks = (data?.blocks ?? []).filter((block) => block.endDate >= today);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: [`/api/${segment}/${listingId}/blocked-dates`] });
  };
  const create = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/provider/${segment}/${listingId}/blocks`, { startDate, endDate: endDate || startDate, reason: reason.trim() || null }),
    onSuccess: () => {
      refresh();
      setStartDate("");
      setEndDate("");
      setReason("");
      toast({ title: "Dates blocked", description: "Guests can't book these days." });
    },
    onError: (error: Error) => toast({ title: "Couldn't block those dates", description: error.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1"), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (blockId: string) => apiRequest("DELETE", `/api/provider/${segment}/${listingId}/blocks/${blockId}`),
    onSuccess: () => {
      refresh();
      toast({ title: "Dates open again" });
    },
    onError: (error: Error) => toast({ title: "Couldn't remove", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  return (
    <Card id="availability" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarOff className="h-5 w-5 text-teal-700" />Dates you're away</CardTitle>
        <CardDescription>Block days you can't work: holidays, other jobs, family time. Guests can't book them, and bookings you already have stay as they are.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_1.4fr_auto]">
          <Field id={`block-start-${listingId}`} label="First day away">
            <Input id={`block-start-${listingId}`} type="date" min={today} value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field id={`block-end-${listingId}`} label="Last day away">
            <Input id={`block-end-${listingId}`} type="date" min={startDate || today} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </Field>
          <Field id={`block-reason-${listingId}`} label="Note for yourself (optional)">
            <Input id={`block-reason-${listingId}`} maxLength={120} placeholder="For example, family wedding" value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <Button type="button" className="rounded-full" disabled={!startDate || create.isPending} onClick={() => create.mutate()} data-testid={`button-block-dates-${listingId}`}>
            {create.isPending ? "Blocking..." : "Block days"}
          </Button>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : blocks.length ? (
          <ul className="space-y-2">
            {blocks.map((block) => (
              <li key={block.id} className="flex items-center justify-between gap-3 rounded-xl border p-3" data-testid={`date-block-${block.id}`}>
                <div className="min-w-0">
                  <div className="font-medium">{formatCalendarDateRange(block.startDate, block.endDate, "en-GB")}</div>
                  {block.reason ? <div className="truncate text-sm text-muted-foreground">{block.reason}</div> : null}
                </div>
                <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-full" disabled={remove.isPending} onClick={() => remove.mutate(block.id)}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />Open again
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No days blocked. Guests can book any day.</p>
        )}
      </CardContent>
    </Card>
  );
}
