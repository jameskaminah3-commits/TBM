import { Link } from "wouter";
import { Lightbulb, MessageCircle, QrCode, Share2, Store, Users } from "lucide-react";
import { ProviderLayout } from "@/components/provider-layout";
import { HubPageHeader, HubPanel, WorkspaceIcon } from "@/components/provider-hub/hub-ui";
import { QrShareCard } from "@/components/provider-hub/qr-share-card";
import { ListingShareSheet } from "@/components/listing-share-sheet";
import { YourShares } from "@/components/your-shares";
import { Button } from "@/components/ui/button";
import { useProviderHub } from "@/hooks/use-provider-hub";
import { toHubListings } from "@/lib/provider-listings";
import { providerWorkspaces } from "@shared/provider-workspaces";

// Ideas that work for each kind of service. Honest and specific: no promises
// of bookings, just where guests already are.
const ideas = [
  { icon: MessageCircle, title: "Your WhatsApp status", body: "Post one listing a week with a photo. Past guests and friends see it, and the link books straight through TBM." },
  { icon: Users, title: "Groups where people ask", body: "When someone in a Facebook or WhatsApp group asks for a villa, a driver or a chef at the Coast, reply with your link." },
  { icon: QrCode, title: "Where guests already are", body: "Print the QR card for the front door, the car's back seat or your menu, so the next guest can book you directly." },
  { icon: Store, title: "Your bio and catalogue", body: "Add your link to your Instagram bio and WhatsApp Business catalogue. One link, with photos, prices and secure payment." },
];

export default function ProviderShare() {
  const hub = useProviderHub();
  const listings = toHubListings(hub.listings, hub.workspaces);
  const live = listings.filter((listing) => listing.isPublic);
  const waiting = listings.filter((listing) => !listing.isPublic);

  return (
    <ProviderLayout title="Share & grow">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <HubPageHeader
          eyebrow="Share & grow"
          title="Bring your own guests"
          description="Share your listings anywhere. Guests see your photos and prices, pay securely through TBM, and every visit and booking from your links is counted for you."
        />

        <HubPanel tone="accent" title="Your listings, ready to share" description="WhatsApp in two taps, a copied link, or a printed QR card.">
          {hub.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading your listings…</p>
          ) : !listings.length ? (
            <div className="space-y-3 text-sm text-stone-700">
              <p>Add your first listing to get a link you can share.</p>
              {hub.workspaces.length ? (
                <Button asChild className="rounded-full">
                  <Link href={providerWorkspaces[hub.workspaces[0]].addHref}>{providerWorkspaces[hub.workspaces[0]].addLabel}</Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {live.map((listing) => (
                <div key={`${listing.kind}-${listing.id}`} className="flex min-w-0 gap-3 rounded-2xl border border-stone-200 bg-white p-3" data-testid={`share-row-${listing.kind}-${listing.id}`}>
                  {listing.imageUrl ? (
                    <img src={listing.imageUrl} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <WorkspaceIcon workspace={listing.workspace} className="h-20 w-20 rounded-xl" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-stone-950">{listing.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{providerWorkspaces[listing.workspace].label}{listing.location ? ` · ${listing.location}` : ""}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ListingShareSheet
                        kind={listing.kind}
                        id={listing.id}
                        name={listing.name}
                        description={listing.description}
                        {...listing.share}
                        isPublic
                        source="provider"
                        triggerClassName="border-[#1f7a4d] bg-[#1f7a4d] text-white hover:bg-[#19663f] hover:text-white"
                      />
                      <QrShareCard kind={listing.kind} id={listing.id} name={listing.name} isPublic />
                    </div>
                  </div>
                </div>
              ))}
              {waiting.map((listing) => (
                <div key={`${listing.kind}-${listing.id}`} className="flex items-center gap-3 rounded-2xl border border-dashed border-stone-300 bg-white/60 p-3">
                  <WorkspaceIcon workspace={listing.workspace} className="h-12 w-12 rounded-xl opacity-70" />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-stone-700">{listing.name}</div>
                    <div className="text-xs text-muted-foreground">Shareable once TBM has checked and published it.</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </HubPanel>

        <YourShares />

        <HubPanel title="Ideas that work" description="Where your next guests already are.">
          <div className="grid gap-3 sm:grid-cols-2">
            {ideas.map((idea) => (
              <div key={idea.title} className="flex gap-3 rounded-2xl bg-stone-50/80 p-4">
                <idea.icon className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
                <div>
                  <div className="font-medium text-stone-900">{idea.title}</div>
                  <p className="mt-1 text-sm leading-6 text-stone-600">{idea.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-stone-200 bg-white p-3 text-sm text-stone-600">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            A booking counts for you when the guest books within 30 days of opening your link on the same device, and TBM has received its full payment or its required deposit. Shares are for your information: they don't change your earnings.
          </div>
        </HubPanel>

        <div className="flex items-center justify-center gap-2 pb-2 text-xs text-muted-foreground">
          <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
          Your links name no account: guests only see the listing.
        </div>
      </div>
    </ProviderLayout>
  );
}
