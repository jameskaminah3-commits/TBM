// "Your host" on a listing page: the provider's name, photo or logo, badges,
// languages and rating, with a link to their page. Shown only while their
// page is live; the server sends nothing otherwise.
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, Languages } from "lucide-react";
import { ProviderAvatar, ProviderBadges, ProviderRatingLine } from "@/components/provider-public-bits";
import { withShareRef } from "@/lib/marketing-attribution";
import type { PublicProviderSummary } from "@shared/provider-public";
import type { PublicListingKind } from "@shared/seo";

export function YourHost({ kind, listingId }: { kind: PublicListingKind; listingId: string }) {
  const { data: provider } = useQuery<PublicProviderSummary | null>({
    queryKey: ["/api/public/providers/by-listing", kind, listingId],
    queryFn: async () => {
      const response = await fetch(`/api/public/providers/by-listing/${kind}/${encodeURIComponent(listingId)}`);
      // Read the body either way, so the request is finished and the connection freed.
      const body = await response.json().catch(() => null) as { provider?: PublicProviderSummary } | null;
      return response.ok ? body?.provider ?? null : null;
    },
    staleTime: 60_000,
    retry: false,
  });
  if (!provider) return null;

  return (
    <section aria-labelledby="host-heading" className="rounded-2xl border border-border/70 p-5" data-testid="your-host">
      <h2 id="host-heading" className="mb-4 font-serif text-2xl font-medium">{kind === "stay" ? "Your host" : "Your provider"}</h2>
      <div className="flex items-start gap-4">
        <ProviderAvatar provider={provider} className="h-16 w-16" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="text-lg font-medium text-foreground" data-testid="text-host-name">{provider.displayName}</div>
            {provider.languages.length ? (
              <div className="flex items-center gap-1 text-sm text-muted-foreground"><Languages className="h-3.5 w-3.5" aria-hidden="true" />{provider.languages.join(", ")}</div>
            ) : null}
          </div>
          <ProviderBadges provider={provider} />
          <ProviderRatingLine rating={provider.rating} />
          <Link href={withShareRef(provider.path)} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline" data-testid="link-host-page">
            See all their services<ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <p className="text-xs text-muted-foreground">You book and pay through TBM, and TBM supports you throughout.</p>
        </div>
      </div>
    </section>
  );
}
