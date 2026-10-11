import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Phone, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatKenyaDateTime } from "@shared/calendar-dates";

type ContactRelease = {
  id: string;
  bookingId: string;
  sharePhone: boolean;
  shareEmail: boolean;
  shareFullName: boolean;
  reason: string;
  expiresAt: string;
};

type GuestContact = {
  guestName: string;
  phone: string | null;
  email: string | null;
  expiresAt: string;
};

// TBM looks after guests. When TBM shares a guest's contact with a provider for a
// specific reason, the provider can open it here until it expires. Each opening
// is recorded.
export function SharedGuestContact({ bookingId }: { bookingId: string }) {
  const { toast } = useToast();
  const [contact, setContact] = useState<GuestContact | null>(null);
  const [loading, setLoading] = useState(false);
  const { data: releases = [] } = useQuery<ContactRelease[]>({
    queryKey: ["/api/provider/contact-releases"],
    staleTime: 60_000,
  });
  const release = releases.find((entry) => entry.bookingId === bookingId);
  if (!release) {
    return null;
  }

  const shared = [release.shareFullName ? "full name" : null, release.sharePhone ? "phone number" : null, release.shareEmail ? "email" : null]
    .filter(Boolean).join(", ").replace(/, ([^,]*)$/, " and $1");
  const open = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/provider/bookings/${bookingId}/guest-contact`, { credentials: "include", cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Couldn't open the guest's contact.");
      }
      setContact(body);
    } catch (error) {
      toast({ title: "Guest contact unavailable", description: (error as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm" data-testid={`shared-guest-contact-${bookingId}`}>
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-amber-950">TBM shared the guest's {shared} with you</p>
          <p className="text-amber-900">Reason: {release.reason}</p>
          <p className="text-xs text-amber-900/80">
            Until {formatKenyaDateTime(release.expiresAt, undefined, "en-GB")}. Use it only for this reason. TBM can see when you open it.
          </p>
        </div>
      </div>
      {contact ? (
        <div className="mt-3 space-y-1 rounded-lg bg-white/80 px-3 py-2" data-testid={`guest-contact-details-${bookingId}`}>
          <p className="font-medium">{contact.guestName}</p>
          {contact.phone ? (
            <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline">
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              {contact.phone}
            </a>
          ) : null}
          {contact.email ? <p className="break-all">{contact.email}</p> : null}
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" className="mt-3 bg-white" onClick={open} disabled={loading}>
          {loading ? "Opening..." : "Show guest contact"}
        </Button>
      )}
    </div>
  );
}
