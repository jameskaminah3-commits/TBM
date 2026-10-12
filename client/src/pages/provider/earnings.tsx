import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, CalendarCheck2, CircleDollarSign, Clock3, HandCoins, Landmark, Smartphone, Wallet } from "lucide-react";
import type { ProviderPaymentView } from "@shared/schema";
import { ProviderLayout } from "@/components/provider-layout";
import { HubPageHeader, HubPanel } from "@/components/provider-hub/hub-ui";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { formatKenyaDateTime } from "@shared/calendar-dates";
import { describePayoutDestination, type ProviderProfileView } from "@shared/provider-profile";

const statusStyle: Record<string, { label: string; className: string }> = {
  pending: { label: "Being prepared", className: "bg-stone-100 text-stone-700 ring-stone-200" },
  approved: { label: "Approved, paying soon", className: "bg-sky-50 text-sky-800 ring-sky-200" },
  paid: { label: "Paid", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  cancelled: { label: "Cancelled", className: "bg-rose-50 text-rose-800 ring-rose-200" },
};

const shortDate = (value: string | null | undefined) =>
  value ? formatKenyaDateTime(value, { day: "numeric", month: "short", year: "numeric" }, "en-GB") : null;

export function formatRateLabel(serviceFeePercents: number[]) {
  if (!serviceFeePercents.length) return null;
  const low = Math.min(...serviceFeePercents);
  const high = Math.max(...serviceFeePercents);
  return low === high ? `${low}%` : `${low}–${high}%`;
}

function Stat({ icon: Icon, label, value, note, tone }: { icon: typeof Wallet; label: string; value: string; note?: string; tone: string }) {
  return (
    <div className={cn("rounded-[1.5rem] border p-4 sm:p-5", tone)}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-stone-950 tabular-nums sm:text-3xl">{value}</div>
      {note ? <div className="mt-1 text-sm text-stone-600">{note}</div> : null}
    </div>
  );
}

export default function ProviderEarnings() {
  const { isAdmin } = useAuth();
  const { formatAmount } = useCurrency();
  const { data, isLoading } = useQuery<ProviderPaymentView>({ queryKey: ["/api/provider/payments"], enabled: !isAdmin });
  const { data: profileData } = useQuery<{ profile: ProviderProfileView }>({ queryKey: ["/api/provider/profile"] });
  const profile = profileData?.profile;
  const destination = profile ? describePayoutDestination(profile) : null;
  const payouts = [...(data?.payouts ?? [])].sort((a, b) => (b.dueAt ?? b.createdAt).localeCompare(a.dueAt ?? a.createdAt));
  const onTheWay = (data?.totalPendingPayouts ?? 0) + (data?.totalApprovedPayouts ?? 0);
  const rate = formatRateLabel(data?.serviceFeePercents ?? []);
  const awaitingRate = data?.awaitingRateCount ?? 0;
  const agreedUnpaid = Math.max(0, (data?.unpaidPayoutCount ?? 0) - awaitingRate);

  return (
    <ProviderLayout title="Earnings">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <HubPageHeader
          eyebrow="Earnings"
          title="What you've earned"
          description="TBM collects each guest's payment, then pays you after the job, less the rate you agreed with TBM."
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat icon={Clock3} label="On the way" value={formatAmount(onTheWay)} note={`${agreedUnpaid} payout${agreedUnpaid === 1 ? "" : "s"} not paid yet`} tone="border-amber-200 bg-amber-50/70 text-amber-900" />
          <Stat icon={HandCoins} label="Paid to you" value={formatAmount(data?.totalPaidOut ?? 0)} note={`${data?.paidPayoutCount ?? 0} payout${(data?.paidPayoutCount ?? 0) === 1 ? "" : "s"}`} tone="border-emerald-200 bg-emerald-50/70 text-emerald-900" />
          <Stat icon={CircleDollarSign} label="Your TBM rate" value={rate ?? "Not set yet"} note={rate ? "Taken from each job's value" : "TBM agrees it with you before your first payout"} tone="border-stone-200 bg-white text-stone-700" />
        </div>

        {awaitingRate > 0 ? (
          <div className="flex items-start gap-3 rounded-[1.5rem] border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-950" data-testid="notice-awaiting-rate">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              {awaitingRate === 1 ? "1 job" : `${awaitingRate} jobs`} worth {formatAmount(data?.awaitingRateValue ?? 0)} {awaitingRate === 1 ? "is" : "are"} waiting for your agreed rate.
              {" "}TBM agrees its rate with you before your first payout. Then you'll see exactly what you receive for each job.
            </p>
          </div>
        ) : null}

        <HubPanel
          title="Where payouts go"
          action={<Button asChild variant="outline" size="sm" className="rounded-full"><Link href="/provider/profile#payout">{destination ? "Change" : "Add details"}</Link></Button>}
        >
          {destination ? (
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-50 ring-1 ring-stone-200">
                {profile?.payoutMethod === "bank" ? <Landmark className="h-5 w-5" /> : <Smartphone className="h-5 w-5 text-emerald-700" />}
              </span>
              <div>
                <div className="font-medium">{destination}</div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  {profile?.payoutDetailsStatus === "confirmed" ? <><BadgeCheck className="h-4 w-4 text-emerald-700" /> Confirmed by TBM</> : "Waiting for TBM to confirm"}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-stone-700">Add your M-Pesa or bank details so payouts reach you without delay.</p>
          )}
        </HubPanel>

        <HubPanel title="Payouts" description="One for each job. Amounts are what you receive.">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading payouts…</p>
          ) : !payouts.length ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Wallet className="h-8 w-8 text-stone-400" aria-hidden="true" />
              <p className="text-sm text-stone-700">No payouts yet. They appear here once a guest's booking is paid.</p>
            </div>
          ) : (
            <ul className="divide-y divide-stone-200">
              {payouts.map((payout) => {
                const style = statusStyle[payout.status] ?? statusStyle.pending;
                const when = payout.status === "paid" ? shortDate(payout.paidAt) : shortDate(payout.dueAt);
                return (
                  <li key={payout.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`payout-${payout.id}`}>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-stone-950">{payout.serviceName}</div>
                      <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><CalendarCheck2 className="h-3.5 w-3.5" />{when ? (payout.status === "paid" ? `Paid ${when}` : `Due ${when}`) : "Date to be set"}</span>
                        <span>Ref {payout.bookingId.slice(0, 8).toUpperCase()}</span>
                        {payout.serviceValue ? (
                          <span>Job value {formatAmount(payout.serviceValue)}{payout.commissionPercent === null ? "" : ` · rate ${payout.commissionPercent}%`}</span>
                        ) : null}
                        {payout.status === "paid" && payout.paymentReference ? <span>Payment ref {payout.paymentReference}</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
                      {payout.payoutAmount === null ? (
                        <span className="text-sm font-medium text-amber-900">Rate to be agreed</span>
                      ) : (
                        <span className="text-lg font-semibold tabular-nums text-stone-950">{formatAmount(payout.payoutAmount)}</span>
                      )}
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold ring-1", style.className)}>{style.label}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </HubPanel>
      </div>
    </ProviderLayout>
  );
}
