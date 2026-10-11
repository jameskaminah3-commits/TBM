import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Link2, Share2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { formatCalendarDateRange, formatKenyaDateTime } from "@shared/calendar-dates";

type ShareState = "confirmed" | "pending" | "cancelled";
type Counts = Record<ShareState, number>;
type ShareLink = {
  code: string;
  channel: "whatsapp" | "copy" | "native" | null;
  createdAt: string;
  sharedAt: string | null;
  stoppedAt: string | null;
  visits: number;
  bookTaps: number;
  bookings: Counts;
  assisted: number;
  lastActivityAt: string | null;
};
type SharedBooking = {
  reference: string;
  bookedOn: string;
  startDate: string;
  endDate: string;
  state: ShareState;
  via: "link" | "older-link";
  linkCode: string | null;
};
type ListingShares = {
  kind: string;
  id: string;
  name: string;
  isPublic: boolean;
  path: string;
  linksShared: Record<"whatsapp" | "copy" | "native", number>;
  visits: number;
  bookTaps: number;
  bookings: Counts;
  olderLinkBookings: Counts;
  assisted: number;
  lastActivityAt: string | null;
  links: ShareLink[];
  creditedBookings: SharedBooking[];
};

const channelLabel: Record<string, string> = { whatsapp: "WhatsApp", copy: "Copied link", native: "Phone share menu" };
const stateLabel: Record<ShareState, string> = { confirmed: "Paid or deposit paid", pending: "Not paid yet", cancelled: "Cancelled" };
const shortDate = (value: string | null) => (value ? formatKenyaDateTime(value, { day: "numeric", month: "short", year: "numeric" }, "en-GB") : "");
const total = (counts: Counts) => counts.confirmed + counts.pending + counts.cancelled;

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-stone-200 bg-white/80 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function StopLinkButton({ code }: { code: string }) {
  const { toast } = useToast();
  const stop = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/provider/share-links/${code}/stop`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/shares"] });
      toast({ title: "Link stopped", description: "It still opens the listing, but new visits and bookings aren't counted." });
    },
    onError: () => toast({ title: "Couldn't stop the link", description: "Please try again.", variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="rounded-full bg-white/80" disabled={stop.isPending}>
          Stop this link
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop this link?</AlertDialogTitle>
          <AlertDialogDescription>
            People who have it can still open the listing, but their visits and bookings won't count for you from now on. Bookings already counted stay.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={() => stop.mutate()}>Stop link</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ListingRow({ listing }: { listing: ListingShares }) {
  const [open, setOpen] = useState(false);
  const linkCount = listing.links.length;
  const channels = (Object.entries(listing.linksShared) as Array<[string, number]>)
    .filter(([, count]) => count > 0)
    .map(([channel, count]) => `${channelLabel[channel]} ${count}`)
    .join(" · ");
  const olderTotal = total(listing.olderLinkBookings);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-[1.5rem] border border-stone-200/80 bg-stone-50/65 p-4 sm:p-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium">{listing.name}</div>
            <div className="text-sm text-muted-foreground">
              {linkCount} {linkCount === 1 ? "link" : "links"} shared{channels ? ` · ${channels}` : ""}
              {listing.lastActivityAt ? ` · last activity ${shortDate(listing.lastActivityAt)}` : ""}
            </div>
          </div>
          {!listing.isPublic ? <Badge variant="secondary" className="shrink-0 rounded-full">Not public</Badge> : null}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Visits" value={listing.visits} />
          <Stat label="Book taps" value={listing.bookTaps} />
          <Stat label="Bookings paid or deposit paid" value={listing.bookings.confirmed} />
          <Stat label="Not paid yet · cancelled" value={`${listing.bookings.pending} · ${listing.bookings.cancelled}`} />
        </div>
        {listing.assisted > 0 || olderTotal > 0 ? (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {listing.assisted > 0 ? (
              <li>Your links also helped with {listing.assisted} other {listing.assisted === 1 ? "booking" : "bookings"}, for other listings or after another link.</li>
            ) : null}
            {olderTotal > 0 ? (
              <li>{olderTotal} {olderTotal === 1 ? "booking" : "bookings"} from links you shared before tracking started (not verified).</li>
            ) : null}
          </ul>
        ) : null}
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="w-fit rounded-full px-3" data-testid={`button-share-details-${listing.id}`}>
            {open ? "Hide links and bookings" : "Show links and bookings"}
            <ChevronDown className={cn("ml-1 h-4 w-4 transition-transform", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="mt-3 space-y-5">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Links</h4>
          {listing.links.length ? listing.links.map((link) => (
            <div key={link.code} className="flex flex-col gap-2 rounded-2xl border border-stone-200 bg-white/80 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <div className="font-medium">
                  <Link2 className="mr-1.5 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground" />
                  {channelLabel[link.channel ?? "copy"]} · {shortDate(link.sharedAt ?? link.createdAt)}{" "}
                  <span className="whitespace-nowrap font-normal text-muted-foreground">· ends …{link.code.slice(-4)}</span>
                </div>
                <div className="text-muted-foreground">
                  {link.visits} {link.visits === 1 ? "visit" : "visits"} · {link.bookTaps} Book {link.bookTaps === 1 ? "tap" : "taps"} · {total(link.bookings)} {total(link.bookings) === 1 ? "booking" : "bookings"}
                  {link.assisted ? ` · helped with ${link.assisted}` : ""}
                </div>
              </div>
              {link.stoppedAt ? (
                <Badge variant="secondary" className="w-fit rounded-full">Stopped {shortDate(link.stoppedAt)}</Badge>
              ) : (
                <StopLinkButton code={link.code} />
              )}
            </div>
          )) : <p className="text-sm text-muted-foreground">No links yet.</p>}
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Bookings from your links</h4>
          {listing.creditedBookings.length ? (
            <ul className="space-y-2">
              {listing.creditedBookings.map((booking) => (
                <li key={`${booking.reference}-${booking.bookedOn}`} className="flex flex-col gap-1 rounded-2xl border border-stone-200 bg-white/80 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="font-medium">Booking {booking.reference}</span>
                    <span className="text-muted-foreground"> · {formatCalendarDateRange(booking.startDate, booking.endDate, "en-GB")} · booked {shortDate(booking.bookedOn)}</span>
                    {booking.via === "older-link" ? <span className="text-muted-foreground"> · older link</span> : null}
                  </div>
                  <Badge
                    variant={booking.state === "confirmed" ? "default" : "secondary"}
                    className={cn("w-fit rounded-full", booking.state === "cancelled" && "line-through")}
                  >
                    {stateLabel[booking.state]}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No bookings from these links yet.</p>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// "Your shares": what the provider's own share links brought in. Counts,
// booking references and dates only; no guest details or amounts.
export function YourShares() {
  const { data, isLoading, isError } = useQuery<{ listings: ListingShares[] }>({
    queryKey: ["/api/provider/shares"],
    staleTime: 60_000,
  });
  const listings = data?.listings ?? [];

  return (
    <Card id="provider-shares" className="border-stone-200/70 bg-white/82 shadow-[0_24px_70px_-42px_rgba(92,73,47,0.34)] scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Share2 className="h-5 w-5 text-primary" />
          Your shares
        </CardTitle>
        <CardDescription>
          Visits and bookings from links you've shared. A booking counts once it's paid or the deposit is paid. Credit lasts 30 days on the guest's device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading your shares…</p> : null}
        {isError ? <p className="text-sm text-muted-foreground">Your shares couldn't load. Please refresh the page.</p> : null}
        {!isLoading && !isError && !listings.length ? (
          <p className="text-sm text-muted-foreground">
            Use Share on any of your public listings below. Visits and bookings from those links will show here.
          </p>
        ) : null}
        {listings.map((listing) => <ListingRow key={`${listing.kind}-${listing.id}`} listing={listing} />)}
      </CardContent>
    </Card>
  );
}
