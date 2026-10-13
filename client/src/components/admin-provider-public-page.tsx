// TBM's controls for one provider's public page: check their photo before it's
// public, see whether the page is live and why not, and switch it off (TBM's
// switch wins over the provider's).
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { ProviderPageSettingsView } from "@/lib/provider-page";
import { providerPageBlockerLabels, providerPhotoChecklist, providerPhotoKinds, type ProviderPhotoKind } from "@shared/provider-public";

const kindLabels: Record<ProviderPhotoKind, string> = { logo: "Logo", work: "Their work", face: "Their face" };

const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1");

export function AdminProviderPublicPage({ providerId, onChanged }: { providerId: string; onChanged?: () => void }) {
  const { toast } = useToast();
  const queryKey = [`/api/admin/providers/${providerId}/public-page`];
  const { data: settings } = useQuery<ProviderPageSettingsView>({ queryKey });
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<ProviderPhotoKind>("face");
  const [pageNote, setPageNote] = useState("");

  const waitingUrl = settings?.photo.pendingUrl ?? settings?.photo.unreviewedUrl ?? null;
  useEffect(() => {
    setKind(settings?.photo.pendingKind ?? "face");
  }, [settings?.photo.pendingKind, waitingUrl]);

  const done = (next: ProviderPageSettingsView, title: string) => {
    queryClient.setQueryData(queryKey, next);
    void queryClient.invalidateQueries({ queryKey: ["/api/admin/provider-photos"] });
    setNote("");
    setPageNote("");
    toast({ title });
    onChanged?.();
  };
  const review = useMutation({
    mutationFn: async (decision: "approve" | "reject") => (await apiRequest("POST", `/api/admin/providers/${providerId}/photo`, { decision, note: note.trim() || null, kind })).json(),
    onSuccess: (next: ProviderPageSettingsView, decision) => done(next, decision === "approve" ? "Photo approved" : "Photo turned down"),
    onError: (error: Error) => toast({ title: "Couldn't save", description: errorText(error), variant: "destructive" }),
  });
  const block = useMutation({
    mutationFn: async (blocked: boolean) => (await apiRequest("POST", `/api/admin/providers/${providerId}/public-page`, { blocked, note: pageNote.trim() || null })).json(),
    onSuccess: (next: ProviderPageSettingsView, blocked) => done(next, blocked ? "Page switched off by TBM" : "The provider can switch their page on again"),
    onError: (error: Error) => toast({ title: "Couldn't change the page", description: errorText(error), variant: "destructive" }),
  });

  if (!settings) return <p className="text-sm text-muted-foreground">Loading the public page…</p>;
  const blockedByTbm = settings.blockers.includes("blocked-by-tbm");

  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid={`admin-public-page-${providerId}`}>
      <div className="space-y-3 rounded-xl bg-white p-3 text-sm">
        <div className="flex items-center justify-between gap-2 font-medium">
          Photo
          {settings.photo.pendingUrl || settings.photo.unreviewedUrl ? <Badge className="bg-amber-500">Check this photo</Badge> : settings.photo.approvedUrl ? <Badge className="bg-emerald-600">Approved</Badge> : <Badge variant="outline">None</Badge>}
        </div>
        {waitingUrl ? (
          <div className="space-y-2">
            <img src={waitingUrl} alt="Photo waiting for review" className="h-40 w-40 rounded-2xl border object-cover" data-testid={`img-photo-review-${providerId}`} />
            <p className="text-xs text-muted-foreground">{settings.photo.pendingUrl ? "Sent by the provider. Private until approved." : "Saved before photo checks began. Not public until approved."}</p>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-stone-700">{providerPhotoChecklist.map((item) => <li key={item}>{item}</li>)}</ul>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What the photo shows">
              {providerPhotoKinds.map((option) => (
                <button key={option} type="button" role="radio" aria-checked={kind === option} onClick={() => setKind(option)} className={cn("rounded-full border px-3 py-1 text-xs", kind === option ? "border-teal-700 bg-teal-700 text-white" : "border-stone-200 bg-white")}>
                  {kindLabels[option]}
                </button>
              ))}
            </div>
            {settings.offersHomeHelp && kind === "face" ? <p className="text-xs text-amber-800">This provider offers home help: a face is never shown publicly, even if approved. Approved, it's shown only to a guest whose home-help booking with them is confirmed.</p> : null}
          </div>
        ) : settings.photo.approvedUrl ? (
          <img src={settings.photo.approvedUrl} alt="Approved photo" className="h-24 w-24 rounded-2xl border object-cover" />
        ) : (
          <p className="text-muted-foreground">No photo. The page shows a service icon.</p>
        )}
        {waitingUrl || settings.photo.approvedUrl ? (
          <>
            <Textarea rows={2} value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="Note for the provider (needed to turn a photo down)" aria-label="Photo review note" />
            <div className="flex flex-wrap gap-2">
              {waitingUrl ? (
                <Button type="button" size="sm" className="rounded-full bg-emerald-700 hover:bg-emerald-800" disabled={review.isPending} onClick={() => review.mutate("approve")} data-testid={`button-approve-photo-${providerId}`}>Approve photo</Button>
              ) : null}
              <Button type="button" size="sm" variant="outline" className="rounded-full text-rose-700" disabled={review.isPending || !note.trim()} onClick={() => review.mutate("reject")} data-testid={`button-reject-photo-${providerId}`}>
                {waitingUrl ? "Turn down" : "Take the photo down"}
              </Button>
            </div>
          </>
        ) : null}
      </div>

      <div className="space-y-3 rounded-xl bg-white p-3 text-sm">
        <div className="flex items-center justify-between gap-2 font-medium">
          Public page
          {settings.live ? <Badge className="bg-emerald-600">Live</Badge> : <Badge variant="outline">Not live</Badge>}
        </div>
        <a href={settings.path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-primary underline-offset-4 hover:underline">
          {settings.path}<ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </a>
        <div className="text-muted-foreground">{settings.enabled ? "Switched on by the provider." : "The provider hasn't switched it on."} {settings.publicListingCount} public listing{settings.publicListingCount === 1 ? "" : "s"}.</div>
        {settings.blockers.length ? (
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-stone-700">{settings.blockers.map((blocker) => <li key={blocker}>{providerPageBlockerLabels[blocker]}</li>)}</ul>
        ) : null}
        {blockedByTbm ? (
          <>
            {settings.blockedNote ? <p className="text-xs text-muted-foreground">Note sent: {settings.blockedNote}</p> : null}
            <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={block.isPending} onClick={() => block.mutate(false)} data-testid={`button-unblock-page-${providerId}`}>Let them switch it on again</Button>
          </>
        ) : (
          <>
            <Textarea rows={2} value={pageNote} maxLength={300} onChange={(event) => setPageNote(event.target.value)} placeholder="Why (sent to the provider, optional)" aria-label="Reason for switching the page off" />
            <Button type="button" size="sm" variant="outline" className="rounded-full text-rose-700" disabled={block.isPending} onClick={() => block.mutate(true)} data-testid={`button-block-page-${providerId}`}>Switch the page off (TBM)</Button>
          </>
        )}
      </div>
    </div>
  );
}
