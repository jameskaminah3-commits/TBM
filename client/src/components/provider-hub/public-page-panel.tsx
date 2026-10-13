// "Your public page" in Share & grow: where it is, whether it's live and why
// not, a preview, the provider's own switch (on only after a preview), and
// sharing the page with the same tracked links as listings.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Eye, Globe2, Sparkles } from "lucide-react";
import { HubPanel } from "@/components/provider-hub/hub-ui";
import { ListingShareSheet } from "@/components/listing-share-sheet";
import { BusinessCard } from "@/components/provider-hub/business-card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ProviderPageSettingsView } from "@/lib/provider-page";
import { providerPageBlockerLabels } from "@shared/provider-public";
import { spotlightExplainer } from "@shared/spotlight";

const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1");

export function PublicPagePanel({ services }: { services: string }) {
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<ProviderPageSettingsView>({ queryKey: ["/api/provider/public-page"] });
  const [previewed, setPreviewed] = useState(false);
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => (await apiRequest("PUT", "/api/provider/public-page", { enabled })).json(),
    onSuccess: (next: ProviderPageSettingsView) => {
      queryClient.setQueryData(["/api/provider/public-page"], next);
      toast({ title: next.enabled ? "Your page is switched on" : "Your page is switched off", description: next.enabled && !next.live ? "It goes live once everything below is ready." : undefined });
    },
    onError: (error: Error) => toast({ title: "Couldn't change your page", description: errorText(error), variant: "destructive" }),
  });
  const spotlight = useMutation({
    mutationFn: async (allowed: boolean) => (await apiRequest("PUT", "/api/provider/public-page", { spotlight: allowed })).json(),
    onSuccess: (next: ProviderPageSettingsView) => {
      queryClient.setQueryData(["/api/provider/public-page"], next);
      toast({ title: next.spotlightAllowed ? "TBM can feature your page" : "TBM won't feature your page" });
    },
    onError: (error: Error) => toast({ title: "Couldn't save your choice", description: errorText(error), variant: "destructive" }),
  });

  if (isLoading || !settings) {
    return <HubPanel title="Your public page"><p className="text-sm text-muted-foreground">Loading…</p></HubPanel>;
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const otherBlockers = settings.blockers.filter((blocker) => blocker !== "switched-off");
  const canPreview = !settings.blockers.includes("suspended") && !settings.blockers.includes("not-provider");

  return (
    <HubPanel
      id="public-page"
      tone="accent"
      title="Your public page"
      description="One link for all your services, with your photo or logo, your reviews and TBM's booking support. It never shows your phone number or email."
    >
      <div className="space-y-4" data-testid="public-page-panel">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {settings.live ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-800 ring-1 ring-emerald-200" data-testid="text-page-live"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Live</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1 font-medium text-stone-700" data-testid="text-page-not-live"><Globe2 className="h-4 w-4" aria-hidden="true" />Not live</span>
          )}
          <span className="break-all text-stone-600">{origin}{settings.path}</span>
        </div>

        {otherBlockers.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700" data-testid="list-page-blockers">
            {otherBlockers.map((blocker) => <li key={blocker}>{providerPageBlockerLabels[blocker]}</li>)}
            {settings.blockedNote ? <li>TBM's note: {settings.blockedNote}</li> : null}
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canPreview ? (
            <Button asChild variant="outline" className="rounded-full">
              <a href={settings.path} target="_blank" rel="noreferrer" onClick={() => setPreviewed(true)} data-testid="link-preview-page">
                <Eye className="mr-2 h-4 w-4" aria-hidden="true" />{settings.live ? "Open your page" : "Preview your page"}
              </a>
            </Button>
          ) : null}
          {settings.enabled ? (
            <Button type="button" variant="ghost" className="rounded-full" disabled={toggle.isPending} onClick={() => toggle.mutate(false)} data-testid="button-page-off">
              Switch my page off
            </Button>
          ) : (
            <Button
              type="button"
              className="rounded-full"
              disabled={toggle.isPending || !previewed || !canPreview || settings.blockers.includes("blocked-by-tbm")}
              onClick={() => toggle.mutate(true)}
              data-testid="button-page-on"
            >
              Switch my page on
            </Button>
          )}
          <BusinessCard settings={settings} />
          {settings.live ? (
            <ListingShareSheet
              kind="provider"
              id={settings.code}
              name={settings.displayName}
              pagePath={settings.path}
              services={services}
              isPublic
              source="provider"
              triggerLabel="Share your page"
              size="default"
              triggerClassName="border-[#1f7a4d] bg-[#1f7a4d] text-white hover:bg-[#19663f] hover:text-white"
            />
          ) : null}
        </div>
        {!settings.enabled && !previewed && canPreview ? (
          <p className="text-xs text-muted-foreground">Preview your page first, then switch it on. You can switch it off at any time.</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Guests reach you through TBM. Visits, Book taps, "Ask TBM" taps and bookings from your page link show in Your shares below.
        </p>
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-amber-200/70 bg-amber-50/60 p-3" data-testid="spotlight-choice">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5 text-sm font-medium text-stone-900"><Sparkles className="h-4 w-4 text-amber-600" aria-hidden="true" />Let TBM feature my page in its Spotlight</div>
            <p className="text-xs leading-5 text-stone-600">{spotlightExplainer}</p>
          </div>
          <Switch
            checked={settings.spotlightAllowed}
            disabled={spotlight.isPending}
            onCheckedChange={(checked) => spotlight.mutate(checked)}
            aria-label="Let TBM feature my page in its Spotlight"
            data-testid="switch-spotlight"
          />
        </div>
      </div>
    </HubPanel>
  );
}
