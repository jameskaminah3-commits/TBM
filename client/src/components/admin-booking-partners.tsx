import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { BookingThread } from "@/components/booking-thread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatKenyaDateTime } from "@shared/calendar-dates";
import type { GuestContactRelease, GuestContactReleaseView } from "@shared/schema";

type BookingPartner = {
  providerUserId: string;
  name: string;
  services: string[];
  contactReleases: Array<GuestContactRelease & { views: GuestContactReleaseView[] }>;
};

const hourChoices = [4, 12, 24, 48, 72];

function releaseState(release: GuestContactRelease) {
  if (release.revokedAt) return "Stopped";
  return new Date(release.expiresAt).getTime() > Date.now() ? "Active" : "Expired";
}

const when = (value: string) => formatKenyaDateTime(value, undefined, "en-GB");

// TBM's side of a booking with its partners: a conversation with each, and the
// rare, recorded release of the guest's contact to one of them.
export function AdminBookingPartners({ bookingId, hasGuestPhone }: { bookingId: string; hasGuestPhone: boolean }) {
  const { data: partners = [] } = useQuery<BookingPartner[]>({
    queryKey: [`/api/admin/bookings/${bookingId}/partners`],
  });

  if (!partners.length) {
    return null;
  }

  return (
    <div className="space-y-4" data-testid={`admin-booking-partners-${bookingId}`}>
      {partners.map((partner) => (
        <div key={partner.providerUserId} className="space-y-3 rounded-xl border p-3">
          <div className="text-sm">
            <span className="font-medium">{partner.name}</span>
            <span className="text-muted-foreground"> · {partner.services.join(", ")}</span>
          </div>
          <BookingThread
            bookingId={bookingId}
            partnerUserId={partner.providerUserId}
            title={`Messages with ${partner.name}`}
            composerPlaceholder="Write to this partner. The guest won't see it."
          />
          <GuestContactReleases bookingId={bookingId} partner={partner} hasGuestPhone={hasGuestPhone} />
        </div>
      ))}
    </div>
  );
}

function GuestContactReleases({ bookingId, partner, hasGuestPhone }: { bookingId: string; partner: BookingPartner; hasGuestPhone: boolean }) {
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [sharePhone, setSharePhone] = useState(hasGuestPhone);
  const [shareEmail, setShareEmail] = useState(false);
  const [shareFullName, setShareFullName] = useState(false);
  const [hours, setHours] = useState("24");
  const [reason, setReason] = useState("");
  const partnersKey = [`/api/admin/bookings/${bookingId}/partners`];

  const share = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/bookings/${bookingId}/contact-releases`, {
      providerUserId: partner.providerUserId,
      sharePhone,
      shareEmail,
      shareFullName,
      hours: Number(hours),
      reason,
    }),
    onSuccess: () => {
      setFormOpen(false);
      setReason("");
      queryClient.invalidateQueries({ queryKey: partnersKey });
      toast({ title: "Guest contact shared", description: `${partner.name} can open it until it expires. Each opening is recorded.` });
    },
    onError: (error: Error) => toast({ title: "Couldn't share the contact", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/admin/contact-releases/${id}/revoke`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: partnersKey });
      toast({ title: "Stopped sharing the guest's contact" });
    },
    onError: (error: Error) => toast({ title: "Couldn't stop sharing", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  return (
    <div className="space-y-2 rounded-lg bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium">
          <ShieldAlert className="h-4 w-4 text-amber-700" aria-hidden="true" />
          Guest contact
        </span>
        {!formOpen ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setFormOpen(true)} data-testid={`button-share-contact-${partner.providerUserId}`}>
            Share with this partner
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Partners get the guest's first name and initial only, and no contact details. Share more only for an emergency or a real operational need, for as short a time as works.
      </p>

      {formOpen ? (
        <div className="space-y-3 rounded-lg border bg-background p-3">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <Checkbox checked={sharePhone} disabled={!hasGuestPhone} onCheckedChange={(value) => setSharePhone(value === true)} />
              Phone{hasGuestPhone ? "" : " (none on file)"}
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={shareEmail} onCheckedChange={(value) => setShareEmail(value === true)} />
              Email
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={shareFullName} onCheckedChange={(value) => setShareFullName(value === true)} />
              Full name
            </label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`contact-hours-${partner.providerUserId}`}>For how long</Label>
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger id={`contact-hours-${partner.providerUserId}`} className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {hourChoices.map((choice) => <SelectItem key={choice} value={String(choice)}>{choice} hours</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`contact-reason-${partner.providerUserId}`}>Reason (the partner sees this)</Label>
            <Textarea
              id={`contact-reason-${partner.providerUserId}`}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. The driver can't find the guest at the airport pickup point."
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => share.mutate()} disabled={share.isPending || reason.trim().length < 10 || (!sharePhone && !shareEmail && !shareFullName)}>
              {share.isPending ? "Sharing..." : "Share contact"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {partner.contactReleases.length ? (
        <ul className="space-y-2">
          {partner.contactReleases.map((release) => {
            const state = releaseState(release);
            return (
              <li key={release.id} className="rounded-lg border bg-background px-3 py-2" data-testid={`contact-release-${release.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {[release.shareFullName ? "Full name" : null, release.sharePhone ? "Phone" : null, release.shareEmail ? "Email" : null].filter(Boolean).join(", ")} · {release.reason}
                  </span>
                  <Badge variant={state === "Active" ? "default" : "outline"}>{state}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Shared {when(release.grantedAt)} · {state === "Stopped" && release.revokedAt ? `stopped ${when(release.revokedAt)}` : `until ${when(release.expiresAt)}`} ·{" "}
                  {release.views.length
                    ? `opened ${release.views.length} time${release.views.length === 1 ? "" : "s"}, last ${when(release.views[0].viewedAt)}`
                    : "not opened yet"}
                </p>
                {state === "Active" ? (
                  <Button type="button" size="sm" variant="ghost" className="mt-1 h-7 px-2" onClick={() => revoke.mutate(release.id)} disabled={revoke.isPending}>
                    Stop sharing now
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
