// Provider Hub's home: what needs the provider now, what's coming up, how
// they're doing, and the next step to get more bookings.
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarCheck2, Check, CheckCircle2, ChevronRight, Plus, Share2, Sparkles } from "lucide-react";
import type { ProviderCategory, ProviderPaymentView } from "@shared/schema";
import { HubAvatar, HubPanel, VerificationBadge, WorkspaceIcon } from "@/components/provider-hub/hub-ui";
import { QrShareCard } from "@/components/provider-hub/qr-share-card";
import { ListingShareSheet } from "@/components/listing-share-sheet";
import { PartnerAdminThread } from "@/components/partner-admin-thread";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { HubListing } from "@/lib/provider-listings";
import { formatKenyaDateTime } from "@shared/calendar-dates";
import { countNoun, providerWorkspaces } from "@shared/provider-workspaces";
import { emptyProviderProfile, getProviderSetupSteps, type ProviderProfileView } from "@shared/provider-profile";

export type AttentionItem = {
  key: string;
  icon: typeof Check;
  title: string;
  detail?: string;
  action: string;
  href?: string;
  onClick?: () => void;
  tone: "amber" | "teal" | "sky";
};

export type UpcomingItem = {
  id: string;
  workspace: ProviderCategory;
  title: string;
  when: string;
  who: string | null;
  status: string;
  onOpen: () => void;
};

type OverviewProps = {
  firstName: string | null | undefined;
  isAdmin: boolean;
  isProvider: boolean;
  providerUserId?: string;
  openAdminThread: boolean;
  moderationNote?: string | null;
  workspaces: ProviderCategory[];
  listings: HubListing[];
  bookingCounts: Partial<Record<ProviderCategory, number>>;
  attention: AttentionItem[];
  upcoming: UpcomingItem[];
  payments?: ProviderPaymentView;
};

const toneStyles: Record<AttentionItem["tone"], string> = {
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  teal: "bg-teal-50 text-teal-800 ring-teal-200",
  sky: "bg-sky-50 text-sky-800 ring-sky-200",
};

function SetupChecklist({ profile, hasListing, hasPublicListing, hasShared }: { profile: ProviderProfileView; hasListing: boolean; hasPublicListing: boolean; hasShared: boolean }) {
  const steps = getProviderSetupSteps({ profile, hasListing, hasPublicListing, hasShared });
  const done = steps.filter((step) => step.done).length;
  if (done === steps.length) return null;
  const next = steps.find((step) => !step.done && !step.inProgress) ?? steps.find((step) => !step.done);

  return (
    <HubPanel
      tone="accent"
      title="Get set up for bookings"
      description="Providers who finish these steps are easier for TBM to recommend, and get paid without delays."
      action={<span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-teal-800 ring-1 ring-teal-200" data-testid="text-setup-progress">{done} of {steps.length} done</span>}
    >
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-white ring-1 ring-teal-100" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Setup progress">
        <div className="h-full rounded-full bg-gradient-to-r from-teal-600 to-emerald-500 transition-all" style={{ width: `${Math.max(6, (done / steps.length) * 100)}%` }} />
      </div>
      <ol className="space-y-2">
        {steps.map((step) => (
          <li
            key={step.key}
            className={cn(
              "flex items-center gap-3 rounded-2xl border bg-white/90 p-3",
              step.key === next?.key ? "border-teal-300 shadow-sm" : "border-stone-200/80",
            )}
            data-testid={`setup-step-${step.key}`}
          >
            <span
              className={cn(
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                step.done ? "bg-emerald-600 text-white" : step.inProgress ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-500",
              )}
              aria-hidden="true"
            >
              {step.done ? <Check className="h-4 w-4" /> : steps.indexOf(step) + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm font-medium", step.done ? "text-stone-500 line-through decoration-stone-300" : "text-stone-950")}>{step.title}</div>
              {!step.done ? <div className="text-xs leading-5 text-stone-600">{step.why}</div> : null}
            </div>
            {!step.done ? (
              step.inProgress && step.key === "verification" ? (
                <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">In review</span>
              ) : (
                <Button asChild size="sm" variant={step.key === next?.key ? "default" : "outline"} className="shrink-0 rounded-full">
                  <Link href={step.href}>{step.action}</Link>
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ol>
    </HubPanel>
  );
}

export function ProviderOverview(props: OverviewProps) {
  const { formatAmount } = useCurrency();
  const { data: profileData } = useQuery<{ profile: ProviderProfileView }>({ queryKey: ["/api/provider/profile"] });
  const { data: sharesData } = useQuery<{ listings: Array<{ links: unknown[] }> }>({ queryKey: ["/api/provider/shares"], staleTime: 60_000 });
  const profile = profileData?.profile ?? emptyProviderProfile;
  const hasShared = (sharesData?.listings ?? []).some((listing) => listing.links.length > 0);
  const live = props.listings.filter((listing) => listing.isPublic);
  const today = formatKenyaDateTime(new Date(), { weekday: "long", day: "numeric", month: "long" }, "en-GB");
  const { user } = useAuth();
  // The same name the sidebar card uses, so both avatars show the same initials.
  const name = profile.businessName?.trim() || [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || props.firstName || "";
  const onTheWay = (props.payments?.totalPendingPayouts ?? 0) + (props.payments?.totalApprovedPayouts ?? 0);

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#0f3d3a] via-[#134e4a] to-[#1f5f4f] p-5 text-white shadow-[0_36px_80px_-48px_rgba(15,61,58,0.9)] sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-amber-300/15 blur-2xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <HubAvatar photoUrl={profile.photoUrl} name={name || "TBM"} className="h-14 w-14 rounded-2xl ring-2 ring-white/20" />
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-teal-100/80">{today}</div>
              <h1 className="font-serif text-3xl font-semibold leading-tight sm:text-4xl" data-testid="text-hub-greeting">
                Karibu{props.firstName ? `, ${props.firstName}` : ""}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-teal-50/90">
                {profile.businessName ? <span className="font-medium">{profile.businessName}</span> : null}
                {props.isAdmin ? null : <VerificationBadge status={profile.verificationStatus} className="bg-white/95" />}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[20rem]">
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/15">
              <div className="text-2xl font-semibold tabular-nums" data-testid="stat-attention">{props.attention.length}</div>
              <div className="text-xs text-teal-50/80">Need you</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/15">
              <div className="text-2xl font-semibold tabular-nums">{props.upcoming.length}</div>
              <div className="text-xs text-teal-50/80">Coming up</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/15">
              <div className="truncate text-2xl font-semibold tabular-nums">{live.length}</div>
              <div className="text-xs text-teal-50/80">Live listings</div>
            </div>
          </div>
        </div>
      </section>

      {props.isAdmin ? null : <SetupChecklist profile={profile} hasListing={props.listings.length > 0} hasPublicListing={live.length > 0} hasShared={hasShared} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="min-w-0 space-y-5">
          <HubPanel title="Needs your attention" description={props.attention.length ? "Answer these first. Guests are waiting on them." : undefined}>
            {props.attention.length ? (
              <ul className="space-y-2">
                {props.attention.map((item) => {
                  const body = (
                    <>
                      <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ring-1", toneStyles[item.tone])}>
                        <item.icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-stone-950">{item.title}</span>
                        {item.detail ? <span className="block truncate text-xs text-stone-600">{item.detail}</span> : null}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-teal-800">
                        {item.action}
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </span>
                    </>
                  );
                  const className = "flex w-full items-center gap-3 rounded-2xl border border-stone-200/80 bg-white p-3 text-left transition-colors hover:border-teal-300 hover:bg-teal-50/30";
                  return (
                    <li key={item.key} data-testid={`attention-${item.key}`}>
                      {item.href ? <Link href={item.href} className={className}>{body}</Link> : <button type="button" onClick={item.onClick} className={className}>{body}</button>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl bg-emerald-50/70 p-4 text-sm text-emerald-900">
                <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
                You're all caught up. New jobs and messages will show here.
              </div>
            )}
          </HubPanel>

          <HubPanel
            title="Coming up"
            action={<Button asChild variant="ghost" size="sm" className="rounded-full"><Link href="/provider/dashboard?tab=bookings">All bookings <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>}
          >
            {props.upcoming.length ? (
              <ul className="space-y-2">
                {props.upcoming.slice(0, 4).map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={item.onOpen} className="flex w-full items-center gap-3 rounded-2xl border border-stone-200/80 bg-white p-3 text-left hover:border-teal-300" data-testid={`upcoming-${item.id}`}>
                      <WorkspaceIcon workspace={item.workspace} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-stone-950">{item.title}</span>
                        <span className="block truncate text-xs text-stone-600">{[item.when, item.who].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">{item.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl bg-stone-50 p-4 text-sm text-stone-700">
                <CalendarCheck2 className="h-5 w-5 shrink-0 text-stone-500" aria-hidden="true" />
                No upcoming jobs yet. Sharing your listings is the quickest way to get the first one.
              </div>
            )}
          </HubPanel>

          <HubPanel title={props.workspaces.length === 1 ? "Your service" : "Your services"}>
            <div className="grid gap-3 sm:grid-cols-2">
              {props.workspaces.map((key) => {
                const workspace = providerWorkspaces[key];
                const rows = props.listings.filter((listing) => listing.workspace === key);
                const liveCount = rows.filter((listing) => listing.isPublic).length;
                const bookings = props.bookingCounts[key] ?? 0;
                return (
                  <div key={key} className="flex flex-col gap-3 rounded-2xl border border-stone-200/80 bg-white p-4" data-testid={`workspace-card-${key}`}>
                    <div className="flex items-center gap-3">
                      <WorkspaceIcon workspace={key} />
                      <div className="min-w-0">
                        <div className="font-medium text-stone-950">{workspace.label}</div>
                        <div className="text-xs text-stone-600">
                          {rows.length ? `${countNoun(rows.length, key)} · ${liveCount} live` : workspace.description}
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-stone-700">{bookings ? `${bookings} active ${bookings === 1 ? "booking" : "bookings"}` : "No active bookings"}</div>
                    <div className="mt-auto flex gap-2">
                      <Button asChild size="sm" className="flex-1 rounded-full">
                        <Link href={`/provider/dashboard?tab=listings&workspace=${key}`}>Manage</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline" className="rounded-full" aria-label={workspace.addLabel}>
                        <Link href={workspace.addHref}><Plus className="h-4 w-4" /></Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </HubPanel>
        </div>

        <div className="min-w-0 space-y-5">
          <HubPanel
            title="Earnings"
            action={<Button asChild variant="ghost" size="sm" className="rounded-full"><Link href="/provider/earnings">Details <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>}
          >
            <div className="grid grid-cols-2 gap-3 [&>div]:min-w-0">
              <div className="rounded-2xl bg-amber-50/70 p-3 ring-1 ring-amber-200">
                <div className="text-xs font-medium text-amber-900">On the way</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-stone-950">{formatAmount(onTheWay)}</div>
              </div>
              <div className="rounded-2xl bg-emerald-50/70 p-3 ring-1 ring-emerald-200">
                <div className="text-xs font-medium text-emerald-900">Paid to you</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-stone-950">{formatAmount(props.payments?.totalPaidOut ?? 0)}</div>
              </div>
            </div>
            {props.payments?.awaitingRateCount ? (
              <p className="mt-3 text-sm text-amber-900" data-testid="text-awaiting-rate">
                {props.payments.awaitingRateCount === 1 ? "1 job is" : `${props.payments.awaitingRateCount} jobs are`} waiting for your agreed rate. TBM agrees it with you before your first payout.
              </p>
            ) : null}
          </HubPanel>

          <HubPanel
            title="Share your listings"
            description="Your link books through TBM, and you see every visit and booking it brings."
            action={<Button asChild variant="ghost" size="sm" className="rounded-full"><Link href="/provider/share">More <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>}
          >
            {live.length ? (
              <ul className="space-y-2" data-testid="card-share-your-listings">
                {live.slice(0, 3).map((listing) => (
                  <li key={`${listing.kind}-${listing.id}`} className="flex items-center gap-3 rounded-2xl border border-stone-200/80 bg-white p-2.5">
                    {listing.imageUrl ? <img src={listing.imageUrl} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-xl object-cover" /> : <WorkspaceIcon workspace={listing.workspace} className="h-11 w-11" />}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{listing.name}</span>
                    <ListingShareSheet
                      kind={listing.kind}
                      id={listing.id}
                      name={listing.name}
                      description={listing.description}
                      {...listing.share}
                      isPublic
                      source="provider"
                      triggerClassName="shrink-0 border-[#1f7a4d] bg-white text-[#1f7a4d]"
                    />
                  </li>
                ))}
                {live[0] ? (
                  <li className="flex items-center justify-between gap-2 rounded-2xl bg-stone-50 p-3 text-xs text-stone-600">
                    <span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-amber-600" /> Print a scan-to-book card</span>
                    <QrShareCard kind={live[0].kind} id={live[0].id} name={live[0].name} isPublic triggerClassName="bg-white" />
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-sm text-stone-600">
                <Share2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                Listings can be shared once TBM has checked and published them.
              </p>
            )}
          </HubPanel>

          {props.isProvider ? (
            <HubPanel id="message-tbm" title="Message TBM" description="Questions about your account, a listing check or a payout.">
              <PartnerAdminThread
                mode="provider"
                providerUserId={props.providerUserId}
                title="Message TBM"
                description=""
                enabled={props.isProvider}
                defaultOpen={props.openAdminThread}
              />
            </HubPanel>
          ) : null}

          {props.moderationNote ? (
            <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50/70 p-4">
              <div className="font-medium text-amber-900">Note from TBM</div>
              <p className="mt-1 text-sm leading-6 text-amber-900/80">{props.moderationNote}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
