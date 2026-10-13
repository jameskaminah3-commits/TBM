// TBM's Founding Provider list: providers in approval order, whether each is
// eligible and why not, granting the badge once and removing it permanently.
// The badge says when a provider joined, never that they're better or safer.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  FOUNDING_PROVIDER_LIMIT,
  foundingReasonLabels,
  foundingRevokeReasonLabels,
  foundingRevokeReasons,
  type FoundingIneligibleReason,
  type FoundingRevokeReason,
} from "@shared/founding-provider";

type Candidate = {
  userId: string;
  name: string;
  rank: number;
  approvedAt: string;
  approvedFrom: "application" | "account";
  eligible: boolean;
  reasons: FoundingIneligibleReason[];
  grantedAt: string | null;
  revokedAt: string | null;
  revokedReason: FoundingRevokeReason | null;
};

const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1");
const shortDate = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Row({ candidate }: { candidate: Candidate }) {
  const { toast } = useToast();
  const [reason, setReason] = useState<FoundingRevokeReason | "">("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/founding-providers"] });
  const grant = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/founding-providers/${candidate.userId}/grant`, {}),
    onSuccess: () => { refresh(); toast({ title: "Founding Provider badge granted" }); },
    onError: (error: Error) => toast({ title: "Couldn't grant it", description: errorText(error), variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/founding-providers/${candidate.userId}/revoke`, { reason }),
    onSuccess: () => { refresh(); toast({ title: "Badge removed permanently" }); },
    onError: (error: Error) => toast({ title: "Couldn't remove it", description: errorText(error), variant: "destructive" }),
  });

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm sm:flex-row sm:items-center sm:justify-between" data-testid={`founding-${candidate.userId}`}>
      <div className="min-w-0">
        <div className="font-medium">{candidate.rank ? `#${candidate.rank} ` : ""}{candidate.name}</div>
        <div className="text-xs text-muted-foreground">
          {candidate.approvedFrom === "application" ? "Approved" : "Account created"} {shortDate(candidate.approvedAt)}
          {candidate.reasons.length ? ` · ${candidate.reasons.map((reason) => foundingReasonLabels[reason]).join("; ")}` : ""}
          {candidate.revokedReason ? ` · ${foundingRevokeReasonLabels[candidate.revokedReason]}` : ""}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {candidate.grantedAt ? (
          <>
            <Badge className="rounded-full bg-amber-500">Founding Provider since {shortDate(candidate.grantedAt)}</Badge>
            <Select value={reason} onValueChange={(value) => setReason(value as FoundingRevokeReason)}>
              <SelectTrigger className="h-8 w-[210px] rounded-full text-xs" aria-label="Why remove it"><SelectValue placeholder="Remove for…" /></SelectTrigger>
              <SelectContent>{foundingRevokeReasons.map((option) => <SelectItem key={option} value={option}>{foundingRevokeReasonLabels[option]}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" size="sm" variant="ghost" className="rounded-full text-rose-700" disabled={!reason || revoke.isPending} onClick={() => revoke.mutate()}>Remove</Button>
          </>
        ) : candidate.eligible ? (
          <Button type="button" size="sm" className="rounded-full" disabled={grant.isPending} onClick={() => grant.mutate()} data-testid={`button-grant-founding-${candidate.userId}`}>Grant the badge</Button>
        ) : (
          <Badge variant="outline" className="rounded-full">Not eligible</Badge>
        )}
      </div>
    </li>
  );
}

export function AdminFoundingProviders() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<{ candidates: Candidate[] }>({ queryKey: ["/api/admin/founding-providers"], enabled: open });
  const candidates = data?.candidates ?? [];
  const granted = candidates.filter((candidate) => candidate.grantedAt).length;
  const shown = candidates.filter((candidate) => candidate.grantedAt || candidate.eligible || (candidate.rank > 0 && candidate.rank <= FOUNDING_PROVIDER_LIMIT));

  return (
    <Card className="border-stone-200/80 bg-white shadow-sm">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="space-y-1">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex w-full items-center justify-between gap-3 text-left" data-testid="button-founding-providers">
              <CardTitle className="text-xl">Founding Providers</CardTitle>
              <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
          <CardDescription className="leading-6">
            The first {FOUNDING_PROVIDER_LIMIT} providers approved, or those approved by 31 March 2027, whichever comes first; verified, with a public listing, within 60 days of approval, and in good standing. Granted once, never recalculated. It says when they joined, not that they're better or safer. A suspension or a page switched off hides it while the page is down; it's removed permanently only for fraud, safety, impersonation or a removed account.
          </CardDescription>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{granted} granted. A listing's publication date isn't recorded, so "within 60 days" uses the date the listing was created; check it before granting.</p>
            <ul className="space-y-2">{shown.map((candidate) => <Row key={candidate.userId} candidate={candidate} />)}</ul>
            {!shown.length ? <p className="text-sm text-muted-foreground">No providers in the cohort yet.</p> : null}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
