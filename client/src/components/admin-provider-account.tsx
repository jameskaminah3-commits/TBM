// TBM's view of one provider's business profile, payout details and
// verification. Payout details are shown in full only here, to admins, so
// they can be checked before a payout.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BadgeCheck, ChevronDown, Landmark, ShieldCheck, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { formatKenyaDateTime } from "@shared/calendar-dates";
import type { ProviderProfileView, VerificationStatus } from "@shared/provider-profile";
import { AdminProviderPublicPage } from "@/components/admin-provider-public-page";

const verificationLabels: Record<VerificationStatus, string> = {
  "not-started": "Not verified",
  "in-review": "Asked to be verified",
  verified: "Verified",
};

const when = (value: string | null) => (value ? formatKenyaDateTime(value, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }, "en-GB") : "");

export function AdminProviderAccount({ providerId, defaultOpen = false }: { providerId: string; defaultOpen?: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [note, setNote] = useState("");
  const queryKey = [`/api/admin/providers/${providerId}/profile`];
  const { data, isLoading } = useQuery<{ profile: ProviderProfileView }>({ queryKey, enabled: open });
  const profile = data?.profile;

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
  };
  const confirmPayout = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/providers/${providerId}/payout-details/confirm`, {}),
    onSuccess: () => {
      refresh();
      toast({ title: "Payout details confirmed", description: "The provider has been told." });
    },
    onError: (error: Error) => toast({ title: "Couldn't confirm", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const setVerification = useMutation({
    mutationFn: async (status: VerificationStatus) => apiRequest("POST", `/api/admin/providers/${providerId}/verification`, { status, note }),
    onSuccess: () => {
      refresh();
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/provider-accounts"] });
      toast({ title: "Verification updated" });
    },
    onError: (error: Error) => toast({ title: "Couldn't update", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-2xl border border-stone-200 bg-stone-50/60" id={`provider-account-${providerId}`}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium" data-testid={`button-provider-account-${providerId}`}>
          <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-muted-foreground" />Business, payouts, verification and public page</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t border-stone-200 px-4 py-4">
        {isLoading || !profile ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl bg-white p-3 text-sm">
                <div className="mb-1 font-medium">Business</div>
                <div>{profile.businessName || <span className="text-muted-foreground">No business name</span>}</div>
                {profile.bio ? <p className="mt-1 text-muted-foreground">{profile.bio}</p> : null}
                <div className="mt-2 text-xs text-muted-foreground">
                  {[profile.languages.join(", "), profile.serviceAreas.join(", ")].filter(Boolean).join(" · ") || "No languages or areas yet"}
                </div>
              </div>
              <div className="rounded-xl bg-white p-3 text-sm" data-testid={`admin-payout-${providerId}`}>
                <div className="mb-1 flex items-center justify-between gap-2 font-medium">
                  Payout details
                  {profile.payoutDetailsStatus === "confirmed" ? (
                    <Badge className="bg-emerald-600"><BadgeCheck className="mr-1 h-3.5 w-3.5" />Confirmed</Badge>
                  ) : profile.payoutDetailsStatus === "unconfirmed" ? (
                    <Badge className="bg-amber-500">Check and confirm</Badge>
                  ) : (
                    <Badge variant="outline">None yet</Badge>
                  )}
                </div>
                {profile.payoutMethod === "mpesa" ? (
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5"><Smartphone className="h-4 w-4" />M-Pesa {profile.mpesaNumber}</div>
                    <div className="text-muted-foreground">Registered to {profile.mpesaName}</div>
                  </div>
                ) : profile.payoutMethod === "bank" ? (
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5"><Landmark className="h-4 w-4" />{profile.bankName}{profile.bankBranch ? `, ${profile.bankBranch}` : ""}</div>
                    <div>{profile.bankAccountNumber}</div>
                    <div className="text-muted-foreground">Account name {profile.bankAccountName}</div>
                  </div>
                ) : (
                  <div className="text-muted-foreground">The provider hasn't added payout details.</div>
                )}
                {profile.payoutDetailsUpdatedAt ? <div className="mt-2 text-xs text-muted-foreground">Changed {when(profile.payoutDetailsUpdatedAt)}</div> : null}
                {profile.payoutDetailsStatus === "unconfirmed" ? (
                  <Button type="button" size="sm" className="mt-3 rounded-full" disabled={confirmPayout.isPending} onClick={() => confirmPayout.mutate()} data-testid={`button-confirm-payout-${providerId}`}>
                    Confirm these details
                  </Button>
                ) : null}
              </div>
              <div className="rounded-xl bg-white p-3 text-sm">
                <div className="mb-1 font-medium">Verification</div>
                <div>{verificationLabels[profile.verificationStatus]}{profile.verifiedAt ? ` on ${when(profile.verifiedAt)}` : ""}</div>
                {profile.verificationNote ? <div className="mt-1 text-muted-foreground">Note: {profile.verificationNote}</div> : null}
              </div>
            </div>
            <div className="space-y-2">
              <Textarea rows={2} value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="Note for the provider (optional), for example what's still missing" aria-label="Verification note" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" className="rounded-full bg-emerald-700 hover:bg-emerald-800" disabled={setVerification.isPending || profile.verificationStatus === "verified"} onClick={() => setVerification.mutate("verified")} data-testid={`button-verify-${providerId}`}>
                  Mark verified
                </Button>
                <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={setVerification.isPending} onClick={() => setVerification.mutate("in-review")}>
                  Keep in review{note.trim() ? " and send note" : ""}
                </Button>
                {profile.verificationStatus === "verified" ? (
                  <Button type="button" size="sm" variant="ghost" className="rounded-full text-rose-700" disabled={setVerification.isPending} onClick={() => setVerification.mutate("not-started")}>
                    Remove verification
                  </Button>
                ) : null}
              </div>
            </div>
            <AdminProviderPublicPage providerId={providerId} />
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
